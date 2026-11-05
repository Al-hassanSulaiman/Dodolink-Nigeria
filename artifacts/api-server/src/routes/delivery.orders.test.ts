import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool, deliveryAgentsTable, deliveryOrdersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const identity = vi.hoisted(() => ({ userId: "" }));
const paystack = vi.hoisted(() => ({
  paystackInitialize: vi.fn(async (_e: string, _a: number, reference: string) => ({ authorization_url: "https://checkout.test/pay", reference })),
  paystackVerify: vi.fn(),
  paystackRefund: vi.fn(async () => ({ status: "pending" })),
  paystackCreateRecipient: vi.fn(async () => ({ recipient_code: "RCP_test" })),
  paystackInitiateTransfer: vi.fn(async () => ({ status: "otp", transfer_code: "TRF_test" })),
  paystackFinalizeTransfer: vi.fn(async (_c: string, otp: string) => {
    if (otp === "000000") throw new Error("Invalid OTP");
    return { status: "success" };
  }),
  paystackResendTransferOtp: vi.fn(async () => undefined),
  paystackResolveAccount: vi.fn(async () => ({ account_name: "X" })),
  paystackListBanks: vi.fn(async () => []),
}));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: identity.userId || null }),
  clerkClient: { users: {
    getUser: vi.fn(async () => ({
      firstName: "Ada", lastName: "Buyer", username: null,
      primaryEmailAddressId: "p", emailAddresses: [{ id: "p", emailAddress: "buyer@example.com" }],
    })),
    getUserList: vi.fn(async () => ({ data: [] })),
  } },
}));
vi.mock("../lib/push", () => ({ notifyTokens: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/paystack", () => paystack);
import deliveryRouter from "./delivery";
import ordersRouter from "./deliveryOrders";
import { deliveryAdminRouter } from "./deliveryAdmin";
import { markDeliveryOrderPaid } from "../lib/deliveryOrders";
import { quote, coversRoute, deliveryCode, estimatePaystackFeeKobo } from "../lib/deliveryMoney";

const app = express();
app.use(express.json(), deliveryRouter, ordersRouter, deliveryAdminRouter);
const agentIds: number[] = [];
let customer: string;
let company: string;
let agentId: number;
let convId: number;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.DELIVERY_PAYMENTS_ENABLED = "true";
  process.env.PAYSTACK_SECRET_KEY = "sk_test_unit";
  customer = `ord_customer_${randomUUID()}`;
  company = `ord_company_${randomUUID()}`;
  const [row] = await db.insert(deliveryAgentsTable).values({
    name: `QA Logistics ${randomUUID().slice(0, 6)}`, phone: "08000000000", deliveryType: "both",
    homeState: "Kano", coveredStates: ["Kaduna"], linkedUserId: company,
    bankName: "Test Bank", bankCode: "058", bankAccountNumber: "0123456789", bankAccountName: "QA LTD",
  }).returning();
  agentId = row.id;
  agentIds.push(row.id);
  identity.userId = customer;
  convId = (await request(app).post("/delivery/conversations/start").send({ agentId })).body.id;
});
afterEach(async () => {
  delete process.env.DELIVERY_PAYMENTS_ENABLED;
  if (agentIds.length) {
    await db.delete(deliveryOrdersTable).where(inArray(deliveryOrdersTable.agentId, agentIds));
    await db.delete(deliveryAgentsTable).where(inArray(deliveryAgentsTable.id, agentIds.splice(0)));
  }
});
afterAll(() => pool.end());

const asCompany = () => { identity.userId = company; };
const asCustomer = () => { identity.userId = customer; };

async function createOrder(amountNaira = 10_000, pickup = "Kano", drop = "Kaduna") {
  asCompany();
  return request(app).post(`/delivery/conversations/${convId}/orders`).send({ amountNaira, pickupState: pickup, dropState: drop, description: "2 boxes" });
}
async function paidOrder() {
  const created = await createOrder();
  asCustomer();
  const pay = await request(app).post(`/delivery/orders/${created.body.id}/pay`);
  await markDeliveryOrderPaid({ reference: pay.body.reference, amountKobo: 1_000_000, feesKobo: 25_000 });
  return { id: created.body.id as number, reference: pay.body.reference as string };
}

describe("money rules", () => {
  it("takes 10% and all Paystack fees out of the company's share", () => {
    const q = quote(1_000_000, 25_000); // N10,000 job, N250 real Paystack fee
    expect(q.platformFeeKobo).toBe(100_000);
    expect(q.transferFeeKobo).toBe(2_500);
    expect(q.agentAmountKobo).toBe(1_000_000 - 100_000 - 25_000 - 2_500);
    expect(estimatePaystackFeeKobo(100_000)).toBe(1_500); // under N2,500: no flat fee
    expect(estimatePaystackFeeKobo(1_000_000)).toBe(25_000); // 1.5% + N100
    expect(estimatePaystackFeeKobo(900_000_000)).toBe(200_000); // capped at N2,000
  });
  it("matches routes to delivery type and states", () => {
    const base = { homeState: "Kano", coveredStates: ["Kaduna"], nationwide: false };
    expect(coversRoute({ ...base, deliveryType: "intrastate" }, "Kano", "Kano")).toBe(true);
    expect(coversRoute({ ...base, deliveryType: "intrastate" }, "Kano", "Kaduna")).toBe(false);
    expect(coversRoute({ ...base, deliveryType: "interstate" }, "Kano", "Kaduna")).toBe(true);
    expect(coversRoute({ ...base, deliveryType: "interstate" }, "Lagos", "Abia")).toBe(false);
    expect(coversRoute({ ...base, deliveryType: "interstate", nationwide: true }, "Lagos", "Abia")).toBe(true);
    expect(coversRoute({ ...base, deliveryType: "both" }, "Kano", "Kano")).toBe(true);
  });
  it("derives a stable 4-digit code", () => {
    expect(deliveryCode(5, "del_5_abc")).toMatch(/^\d{4}$/);
    expect(deliveryCode(5, "del_5_abc")).toBe(deliveryCode(5, "del_5_abc"));
  });
});

describe("delivery request, payment, code, rating", () => {
  it("is switched off until DELIVERY_PAYMENTS_ENABLED=true", async () => {
    process.env.DELIVERY_PAYMENTS_ENABLED = "false";
    expect((await createOrder()).status).toBe(403);
  });

  it("only the company can request; price and route are checked", async () => {
    asCustomer();
    expect((await request(app).post(`/delivery/conversations/${convId}/orders`).send({ amountNaira: 5000, pickupState: "Kano", dropState: "Kaduna" })).status).toBe(404);
    expect((await createOrder(100)).status).toBe(400);
    expect((await createOrder(10_000, "Lagos", "Abia")).status).toBe(400);
    const ok = await createOrder(10_000);
    expect(ok.status).toBe(201);
    // The company sees what it will receive; the customer never sees that breakdown.
    expect(ok.body.breakdown.platformFeeKobo).toBe(100_000);
    asCustomer();
    const seen = await request(app).get(`/delivery/orders/${ok.body.id}`);
    expect(seen.body.breakdown).toBeNull();
    expect(seen.body.code).toBeNull();
  });

  it("runs the full journey: pay, code, delivery, rating once", async () => {
    const { id, reference } = await paidOrder();
    expect(reference).toMatch(new RegExp(`^del_${id}_`));
    expect(paystack.paystackInitialize.mock.calls[0][3]).toMatchObject({ type: "delivery", orderId: id });

    asCustomer();
    const view = await request(app).get(`/delivery/orders/${id}`);
    expect(view.body.status).toBe("paid");
    const code: string = view.body.code;
    expect(code).toMatch(/^\d{4}$/);
    // The company's version never shows the code.
    asCompany();
    expect((await request(app).get(`/delivery/orders/${id}`)).body.code).toBeNull();

    const wrong = await request(app).post(`/delivery/orders/${id}/deliver`).send({ code: code === "0000" ? "1111" : "0000" });
    expect(wrong.status).toBe(400);
    const right = await request(app).post(`/delivery/orders/${id}/deliver`).send({ code });
    expect(right.status).toBe(200);
    expect(right.body.status).toBe("delivered");

    asCustomer();
    expect((await request(app).post(`/delivery/orders/${id}/rate`).send({ stars: 7 })).status).toBe(400);
    expect((await request(app).post(`/delivery/orders/${id}/rate`).send({ stars: 5, comment: "Fast" })).status).toBe(201);
    expect((await request(app).post(`/delivery/orders/${id}/rate`).send({ stars: 1 })).status).toBe(409);
    const list = await request(app).get("/delivery/agents");
    expect(list.body.find((a: { id: number }) => a.id === agentId)).toMatchObject({ ratingAverage: 5, ratingCount: 1 });
  });

  it("locks the code after five wrong tries", async () => {
    const { id } = await paidOrder();
    asCompany();
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post(`/delivery/orders/${id}/deliver`).send({ code: "abcd" })).status).toBe(400);
    }
    expect((await request(app).post(`/delivery/orders/${id}/deliver`).send({ code: "abcd" })).status).toBe(423);
  });

  it("payment is recorded once, with the real fee, and a wrong amount is flagged", async () => {
    const created = await createOrder();
    asCustomer();
    const pay = await request(app).post(`/delivery/orders/${created.body.id}/pay`);
    expect(await markDeliveryOrderPaid({ reference: pay.body.reference, amountKobo: 1_000_000, feesKobo: 30_000 })).toBe("paid");
    expect(await markDeliveryOrderPaid({ reference: pay.body.reference, amountKobo: 1_000_000, feesKobo: 30_000 })).toBe("already");
    const [row] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, created.body.id));
    expect(row).toMatchObject({ status: "paid", paystackFeeKobo: 30_000, agentAmountKobo: 1_000_000 - 100_000 - 30_000 - 2_500 });

    const second = await createOrder(20_000);
    asCustomer();
    const pay2 = await request(app).post(`/delivery/orders/${second.body.id}/pay`);
    expect(await markDeliveryOrderPaid({ reference: pay2.body.reference, amountKobo: 1, feesKobo: 0 })).toBe("mismatch");
    expect((await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, second.body.id)))[0].status).toBe("review");
    expect(await markDeliveryOrderPaid({ reference: "del_unknown", amountKobo: 1, feesKobo: 0 })).toBe("unknown");
  });

  it("outsiders cannot see or act on a job", async () => {
    const { id } = await paidOrder();
    identity.userId = `outsider_${randomUUID()}`;
    expect((await request(app).get(`/delivery/orders/${id}`)).status).toBe(404);
    expect((await request(app).post(`/delivery/orders/${id}/confirm`)).status).toBe(404);
    expect((await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "not my job at all" })).status).toBe(404);
  });
});

describe("payout with OTP", () => {
  it("starts the transfer, waits for the OTP, and refuses a second start", async () => {
    const { id } = await paidOrder();
    asCustomer();
    expect((await request(app).post(`/delivery/orders/${id}/confirm`)).status).toBe(200);

    const start = await request(app).post(`/admin/delivery-orders/${id}/payout`);
    expect(start.status).toBe(200);
    expect(start.body.payoutStatus).toBe("awaiting_otp");
    expect(paystack.paystackInitiateTransfer).toHaveBeenCalledTimes(1);
    expect(paystack.paystackInitiateTransfer.mock.calls[0][0]).toBe(1_000_000 - 100_000 - 25_000 - 2_500);
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(409);
    expect(paystack.paystackInitiateTransfer).toHaveBeenCalledTimes(1);

    expect((await request(app).post(`/admin/delivery-orders/${id}/payout/otp`).send({ otp: "abc" })).status).toBe(400);
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout/otp`).send({ otp: "000000" })).status).toBe(400);
    const done = await request(app).post(`/admin/delivery-orders/${id}/payout/otp`).send({ otp: "123456" });
    expect(done.body.payoutStatus).toBe("paid");
  });

  it("does not pay out an undelivered or disputed job", async () => {
    const { id } = await paidOrder();
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(409);
    asCustomer();
    expect((await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "short" })).status).toBe(400);
    expect((await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "Goods never arrived at all" })).status).toBe(201);
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(409);
    expect(paystack.paystackInitiateTransfer).not.toHaveBeenCalled();
  });

  it("an unclear Paystack answer leaves the payout blocked until an admin records the truth", async () => {
    const { id } = await paidOrder();
    asCustomer();
    await request(app).post(`/delivery/orders/${id}/confirm`);
    paystack.paystackInitiateTransfer.mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(502);
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(409);
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout/mark`).send({ outcome: "failed" })).body.payoutStatus).toBe("failed");
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(200);
  });

  it("a clear Paystack rejection allows a retry", async () => {
    const { id } = await paidOrder();
    asCustomer();
    await request(app).post(`/delivery/orders/${id}/confirm`);
    paystack.paystackInitiateTransfer.mockRejectedValueOnce(new Error("Insufficient balance"));
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(502);
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(200);
  });
});

describe("disputes", () => {
  async function disputed() {
    const { id } = await paidOrder();
    asCompany();
    expect((await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "Customer is not answering the phone" })).status).toBe(201);
    return id;
  }

  it("a full refund goes back through Paystack and ends the job", async () => {
    const id = await disputed();
    const res = await request(app).post(`/admin/delivery-orders/${id}/resolve`).send({ action: "refund_customer", note: "Not delivered" });
    expect(res.body.status).toBe("refunded");
    expect(paystack.paystackRefund).toHaveBeenCalledWith(expect.stringMatching(/^del_/), undefined);
    const [row] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
    expect(row).toMatchObject({ status: "refunded", payoutStatus: "none", refundedKobo: 1_000_000 });
  });

  it("a split refunds part, and pays the company on what is left", async () => {
    const id = await disputed();
    expect((await request(app).post(`/admin/delivery-orders/${id}/resolve`).send({ action: "split", refundNaira: 20_000 })).status).toBe(400);
    const res = await request(app).post(`/admin/delivery-orders/${id}/resolve`).send({ action: "split", refundNaira: 4_000 });
    expect(res.body.status).toBe("delivered");
    expect(paystack.paystackRefund).toHaveBeenCalledWith(expect.any(String), 400_000);
    const start = await request(app).post(`/admin/delivery-orders/${id}/payout`);
    expect(start.status).toBe(200);
    // Remaining N6,000: 10% = N600, real fee N250, transfer fee N25.
    expect(paystack.paystackInitiateTransfer.mock.calls[0][0]).toBe(600_000 - 60_000 - 25_000 - 2_500);
  });

  it("paying the company releases the payout; a refused refund changes nothing", async () => {
    const id = await disputed();
    paystack.paystackRefund.mockRejectedValueOnce(new Error("Refund not allowed"));
    expect((await request(app).post(`/admin/delivery-orders/${id}/resolve`).send({ action: "refund_customer" })).status).toBe(502);
    expect((await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id)))[0].status).toBe("disputed");
    expect((await request(app).post(`/admin/delivery-orders/${id}/resolve`).send({ action: "pay_agent" })).body.status).toBe("delivered");
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(200);
  });
});

describe("admin: support chat on a disputed job, and deleting a company", () => {
  it("opens the chat only after a problem is reported, and support messages reach both sides", async () => {
    asCustomer();
    await request(app).post(`/delivery/conversations/${convId}/messages`).send({ body: "Where are my goods?" });
    const { id } = await paidOrder();
    // No problem reported yet: support cannot read this chat.
    expect((await request(app).get(`/admin/delivery-orders/${id}/chat`)).status).toBe(404);
    expect((await request(app).post(`/admin/delivery-orders/${id}/message`).send({ body: "hello" })).status).toBe(404);

    asCustomer();
    expect((await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "Goods never arrived at all" })).status).toBe(201);
    const chat = await request(app).get(`/admin/delivery-orders/${id}/chat`);
    expect(chat.status).toBe(200);
    expect(chat.body.messages.map((m: { body: string }) => m.body)).toContain("Where are my goods?");

    expect((await request(app).post(`/admin/delivery-orders/${id}/message`).send({ body: "  " })).status).toBe(400);
    expect((await request(app).post(`/admin/delivery-orders/${id}/message`).send({ body: "We are looking into it." })).status).toBe(201);
    asCustomer();
    const thread = await request(app).get(`/delivery/conversations/${convId}/messages`);
    const last = thread.body.messages.at(-1);
    expect(last).toMatchObject({ body: "We are looking into it.", senderType: "support", senderName: "DodoLink Support", mine: false });
    asCompany();
    expect((await request(app).get(`/delivery/conversations/${convId}/messages`)).body.messages.at(-1).senderType).toBe("support");
  });

  it("deletes a company with no jobs, and refuses one that has jobs", async () => {
    await paidOrder();
    const refused = await request(app).delete(`/admin/delivery-agents/${agentId}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Active off/);

    const [empty] = await db.insert(deliveryAgentsTable).values({
      name: "Empty Co", phone: "08000000001", deliveryType: "intrastate", homeState: "Lagos",
    }).returning();
    expect((await request(app).delete(`/admin/delivery-agents/${empty.id}`)).body).toEqual({ deleted: true });
    expect(await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, empty.id))).toHaveLength(0);
    expect((await request(app).delete(`/admin/delivery-agents/${empty.id}`)).status).toBe(404);
  });
});
