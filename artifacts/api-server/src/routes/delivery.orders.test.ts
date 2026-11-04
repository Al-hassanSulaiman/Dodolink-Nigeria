import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db, pool, deliveryAgentsTable, deliveryOrdersTable, deliveryDisputesTable, deliverySettingsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const identity = vi.hoisted(() => ({ userId: "" }));
const paystack = vi.hoisted(() => ({
  paystackInitialize: vi.fn(), paystackVerify: vi.fn(), paystackRefund: vi.fn(),
  paystackCreateRecipient: vi.fn(), paystackTransfer: vi.fn(), paystackVerifyTransfer: vi.fn(),
  paystackFinalizeTransfer: vi.fn(), paystackResendTransferOtp: vi.fn(),
  paystackListBanks: vi.fn(), paystackResolveAccount: vi.fn(),
}));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: identity.userId || null }),
  clerkClient: { users: {
    getUser: vi.fn(async () => ({ firstName: "Ada", lastName: "Buyer", username: null,
      primaryEmailAddressId: "e1", emailAddresses: [{ id: "e1", emailAddress: "ada@example.com" }] })),
    getUserList: vi.fn(async () => ({ data: [] })),
  } },
}));
vi.mock("../lib/push", () => ({ notifyTokens: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/paystack", () => paystack);
import delivery from "./delivery";
import deliveryOrders from "./deliveryOrders";
import { deliveryAdminRouter } from "./deliveryAdmin";
import { breakdown } from "../lib/deliveryMoney";
import { agentCoversJob } from "../lib/nigerianStates";
import { applyPayment, applyTransferEvent } from "../lib/deliveryOrders";

const app = express();
app.use(express.json(), delivery, deliveryOrders, deliveryAdminRouter);
const agentIds: number[] = [];
let customer: string;
let company: string;
let agentRow: typeof deliveryAgentsTable.$inferSelect;
let convId: number;

beforeEach(async () => {
  Object.values(paystack).forEach(f => f.mockReset());
  paystack.paystackVerifyTransfer.mockResolvedValue(null);
  customer = `ord_customer_${randomUUID()}`;
  company = `ord_company_${randomUUID()}`;
  const [row] = await db.insert(deliveryAgentsTable).values({
    name: `QA Logistics ${randomUUID().slice(0, 6)}`, phone: "08000000000", linkedUserId: company,
    deliveryType: "intrastate", homeState: "Kano", bankName: "Test Bank", bankCode: "058",
    bankAccountNumber: "0123456789", bankAccountName: "QA LOGISTICS",
  }).returning();
  agentRow = row;
  agentIds.push(row.id);
  identity.userId = customer;
  const started = await request(app).post("/delivery/conversations/start").send({ agentId: row.id });
  convId = started.body.id;
});
afterEach(async () => {
  if (agentIds.length) {
    await db.delete(deliveryOrdersTable).where(inArray(deliveryOrdersTable.agentId, agentIds));
    await db.delete(deliveryAgentsTable).where(inArray(deliveryAgentsTable.id, agentIds.splice(0)));
  }
  await db.delete(deliverySettingsTable);
});
afterAll(() => pool.end());

const as = (userId: string) => { identity.userId = userId; };
async function createOrder(over: Record<string, unknown> = {}) {
  as(company);
  return request(app).post("/delivery/orders").send({
    conversationId: convId, amountNaira: 10000, pickupState: "Kano", dropState: "Kano", ...over,
  });
}
async function paidOrder() {
  const created = await createOrder();
  as(customer);
  paystack.paystackInitialize.mockResolvedValue({ authorization_url: "https://pay.test/x", reference: "r" });
  const pay = await request(app).post(`/delivery/orders/${created.body.id}/pay`);
  paystack.paystackVerify.mockResolvedValue({ status: "success", amount: 1_000_000, currency: "NGN", fees: 25_000, reference: pay.body.reference });
  await request(app).post(`/delivery/orders/${created.body.id}/verify`);
  return { id: created.body.id as number, reference: pay.body.reference as string };
}
async function thread(userId: string) {
  as(userId);
  return (await request(app).get(`/delivery/conversations/${convId}/messages`)).body;
}

describe("money and coverage rules", () => {
  it("keeps 10%, takes Paystack fees from the company, and never goes negative", () => {
    const b = breakdown(1_000_000);
    expect(b.platformFeeKobo).toBe(100_000);
    expect(b.companyReceivesKobo).toBe(1_000_000 - 100_000 - b.paystackFeeKobo - b.transferFeeKobo);
    expect(breakdown(1_000_000, { actualChargeFeeKobo: 25_000 }).paystackFeeKobo).toBe(25_000);
    const split = breakdown(1_000_000, { refundKobo: 400_000 });
    expect(split.platformFeeKobo).toBe(60_000);
    expect(breakdown(1_000_000, { refundKobo: 1_000_000 }).companyReceivesKobo).toBe(0);
  });

  it("matches routes to delivery type", () => {
    const intra = { deliveryType: "intrastate", homeState: "Kano", coveredStates: [], nationwide: false };
    expect(agentCoversJob(intra, "Kano", "Kano")).toBe(true);
    expect(agentCoversJob(intra, "Kano", "Kaduna")).toBe(false);
    const inter = { deliveryType: "interstate", homeState: null, coveredStates: ["Kaduna"], nationwide: false };
    expect(agentCoversJob(inter, "Kano", "Kaduna")).toBe(true);
    expect(agentCoversJob(inter, "Kano", "Lagos")).toBe(false);
    expect(agentCoversJob(inter, "Kaduna", "Kaduna")).toBe(false);
    const both = { deliveryType: "both", homeState: "Kano", coveredStates: [], nationwide: true };
    expect(agentCoversJob(both, "Kano", "Kano")).toBe(true);
    expect(agentCoversJob(both, "Lagos", "Abia")).toBe(true);
  });
});

describe("delivery request", () => {
  it("only the company can request; validates price, route and payout account", async () => {
    as(customer);
    expect((await request(app).post("/delivery/orders").send({ conversationId: convId, amountNaira: 5000, pickupState: "Kano", dropState: "Kano" })).status).toBe(403);
    expect((await createOrder({ amountNaira: 10 })).status).toBe(400);
    expect((await createOrder({ amountNaira: 12.5 })).status).toBe(400);
    expect((await createOrder({ dropState: "Lagos" })).status).toBe(400);
    expect((await createOrder({ pickupState: "Atlantis" })).status).toBe(400);
    await db.update(deliveryAgentsTable).set({ bankCode: null }).where(eq(deliveryAgentsTable.id, agentRow.id));
    expect((await createOrder()).status).toBe(400);
    await db.update(deliveryAgentsTable).set({ bankCode: "058" }).where(eq(deliveryAgentsTable.id, agentRow.id));
    const ok = await createOrder();
    expect(ok.status).toBe(201);
  });

  it("customer sees price only; company sees the fee breakdown; neither sees the other's secrets", async () => {
    await createOrder();
    const c = await thread(customer);
    expect(c.orders).toHaveLength(1);
    expect(c.orders[0].amountKobo).toBe(1_000_000);
    expect(JSON.stringify(c.orders[0])).not.toMatch(/breakdown|platformFee|payoutStatus/);
    expect(c.messages.at(-1).body).toMatch(/Delivery request/);
    const a = await thread(company);
    expect(a.orders[0].breakdown.companyReceivesKobo).toBeGreaterThan(0);
    expect(a.orders[0].breakdown.companyReceivesKobo).toBeLessThan(900_000);
    expect(a.orders[0].deliveryCode ?? null).toBeNull();
  });
});

describe("paying, the delivery code, rating", () => {
  it("full journey: pay -> code -> delivered -> payout queued -> rated once", async () => {
    const { id } = await paidOrder();
    const [paid] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
    expect(paid).toMatchObject({ status: "paid", paystackFeeKobo: 25_000 });

    const c = await thread(customer);
    const code = c.orders[0].deliveryCode as string;
    expect(code).toMatch(/^\d{4}$/);
    const a = await thread(company);
    expect(a.orders[0].deliveryCode ?? null).toBeNull();
    expect(a.orders[0].breakdown.paystackFeeKobo).toBe(25_000);

    as(company);
    const wrong = await request(app).post(`/delivery/orders/${id}/deliver`).send({ code: code === "0000" ? "1111" : "0000" });
    expect(wrong.status).toBe(400);
    as(customer);
    expect((await request(app).post(`/delivery/orders/${id}/deliver`).send({ code })).status).toBe(404);
    as(company);
    expect((await request(app).post(`/delivery/orders/${id}/deliver`).send({ code })).status).toBe(200);
    const [done] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
    expect(done).toMatchObject({ status: "delivered", payoutStatus: "queued" });

    as(customer);
    expect((await request(app).post(`/delivery/orders/${id}/rate`).send({ stars: 6 })).status).toBe(400);
    expect((await request(app).post(`/delivery/orders/${id}/rate`).send({ stars: 4, comment: "Quick" })).status).toBe(201);
    expect((await request(app).post(`/delivery/orders/${id}/rate`).send({ stars: 5 })).status).toBe(409);
    const list = (await request(app).get("/delivery/agents")).body.find((x: { id: number }) => x.id === agentRow.id);
    expect(list).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
  });

  it("locks the code after too many wrong tries, and the customer can still confirm", async () => {
    const { id } = await paidOrder();
    as(company);
    for (let i = 0; i < 5; i++) await request(app).post(`/delivery/orders/${id}/deliver`).send({ code: "abcd" });
    expect((await request(app).post(`/delivery/orders/${id}/deliver`).send({ code: "0000" })).status).toBe(423);
    as(customer);
    expect((await request(app).post(`/delivery/orders/${id}/confirm`)).status).toBe(200);
  });

  it("a payment is applied once; a second payment for the same job is refunded; wrong amounts are ignored", async () => {
    const { id, reference } = await paidOrder();
    expect(await applyPayment(reference)).toBe("already");
    paystack.paystackVerify.mockResolvedValue({ status: "success", amount: 1_000_000, currency: "NGN", reference: `del_${id}_zzz` });
    paystack.paystackRefund.mockResolvedValue(undefined);
    expect(await applyPayment(`del_${id}_zzz`)).toBe("refunded");
    expect(paystack.paystackRefund).toHaveBeenCalledWith(`del_${id}_zzz`);

    const second = await createOrder();
    paystack.paystackVerify.mockResolvedValue({ status: "success", amount: 5, currency: "NGN", reference: `del_${second.body.id}_a` });
    expect(await applyPayment(`del_${second.body.id}_a`)).toBe("mismatch");
    expect(await applyPayment("dodolink_sub_123")).toBe("ignored");
  });

  it("cannot pay a cancelled request", async () => {
    const created = await createOrder();
    as(customer);
    expect((await request(app).post(`/delivery/orders/${created.body.id}/cancel`)).status).toBe(200);
    expect((await request(app).post(`/delivery/orders/${created.body.id}/pay`)).status).toBe(409);
  });
});

describe("payouts (OTP stays on by default)", () => {
  async function deliveredOrder() {
    const { id } = await paidOrder();
    as(customer);
    await request(app).post(`/delivery/orders/${id}/confirm`);
    return id;
  }

  it("defaults to manual OTP mode and does not pay on its own", async () => {
    const id = await deliveredOrder();
    expect((await request(app).get("/admin/delivery-settings")).body).toEqual({ payoutMode: "manual_otp", payoutsPaused: false });
    const [row] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
    expect(row.payoutStatus).toBe("queued");
    expect(paystack.paystackTransfer).not.toHaveBeenCalled();
  });

  it("admin starts the payout, Paystack asks for the OTP, admin enters it", async () => {
    const id = await deliveredOrder();
    paystack.paystackCreateRecipient.mockResolvedValue("RCP_1");
    paystack.paystackTransfer.mockResolvedValue({ status: "otp", reference: `dlvpay_${id}_1`, transfer_code: "TRF_1" });
    const start = await request(app).post(`/admin/delivery-orders/${id}/payout`);
    expect(start.body).toMatchObject({ ok: true, status: "awaiting_otp" });
    const sent = paystack.paystackTransfer.mock.calls[0];
    const b = breakdown(1_000_000, { actualChargeFeeKobo: 25_000 });
    expect(sent[0]).toBe(b.companyReceivesKobo);
    expect(sent[1]).toBe("RCP_1");
    // The same job can never start a second payout while one is waiting for its code.
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).status).toBe(409);
    expect(paystack.paystackTransfer).toHaveBeenCalledTimes(1);

    paystack.paystackFinalizeTransfer.mockRejectedValueOnce(new Error("Invalid OTP"));
    const bad = await request(app).post(`/admin/delivery-orders/${id}/otp`).send({ otp: "123456" });
    expect(bad.status).toBe(409);
    expect(bad.body.message).toBe("Invalid OTP");
    paystack.paystackFinalizeTransfer.mockResolvedValue({ status: "success", reference: `dlvpay_${id}_1` });
    expect((await request(app).post(`/admin/delivery-orders/${id}/otp`).send({ otp: "123456" })).body).toMatchObject({ ok: true, status: "paid" });
    const [row] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
    expect(row.payoutStatus).toBe("paid");
  });

  it("a failed attempt can be retried without paying twice", async () => {
    const id = await deliveredOrder();
    paystack.paystackCreateRecipient.mockResolvedValue("RCP_1");
    paystack.paystackTransfer.mockRejectedValueOnce(new Error("timeout"));
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).body.status).toBe("failed");
    // The first attempt actually went through at Paystack; the retry must adopt it, not send again.
    paystack.paystackVerifyTransfer.mockResolvedValueOnce({ status: "pending", reference: `dlvpay_${id}_1`, transfer_code: "TRF_9" });
    const retry = await request(app).post(`/admin/delivery-orders/${id}/payout`);
    expect(retry.body).toMatchObject({ ok: true, status: "sent" });
    expect(paystack.paystackTransfer).toHaveBeenCalledTimes(1);
    await applyTransferEvent("transfer.success", `dlvpay_${id}_1`);
    const [row] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
    expect(row.payoutStatus).toBe("paid");
  });

  it("the pause switch stops payouts, and automatic mode pays right after delivery", async () => {
    await request(app).put("/admin/delivery-settings").send({ payoutsPaused: true });
    const id = await deliveredOrder();
    expect((await request(app).post(`/admin/delivery-orders/${id}/payout`)).body.status).toBe("paused");
    await request(app).put("/admin/delivery-settings").send({ payoutsPaused: false, payoutMode: "automatic" });
    paystack.paystackCreateRecipient.mockResolvedValue("RCP_1");
    paystack.paystackTransfer.mockResolvedValue({ status: "pending", reference: "x", transfer_code: "T" });
    const second = await deliveredOrder();
    await vi.waitFor(async () => {
      const [row] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, second));
      expect(row.payoutStatus).toBe("sent");
    });
    expect((await request(app).put("/admin/delivery-settings").send({ payoutMode: "weird" })).status).toBe(400);
  });
});

describe("disputes", () => {
  it("holds the payout, then the admin refunds the customer", async () => {
    const { id } = await paidOrder();
    as(customer);
    expect((await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "no" })).status).toBe(400);
    expect((await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "Goods never arrived" })).status).toBe(201);
    expect((await request(app).post(`/delivery/orders/${id}/confirm`)).status).toBe(409);
    expect((await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "Goods never arrived" })).status).toBe(409);
    const list = (await request(app).get("/admin/delivery-disputes")).body;
    const dispute = list.find((d: { orderId: number }) => d.orderId === id);
    expect(dispute).toMatchObject({ status: "open", openedByRole: "customer" });

    paystack.paystackRefund.mockResolvedValue(undefined);
    const res = await request(app).post(`/admin/delivery-disputes/${dispute.id}/resolve`).send({ resolution: "refund_customer", note: "Not delivered" });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
    expect(row).toMatchObject({ status: "refunded", payoutStatus: "none", refundKobo: 1_000_000 });
    expect((await request(app).post(`/admin/delivery-disputes/${dispute.id}/resolve`).send({ resolution: "pay_company" })).status).toBe(409);
  });

  it("split refunds part and pays the company the rest; a failed refund changes nothing", async () => {
    const { id } = await paidOrder();
    as(company);
    await request(app).post(`/delivery/orders/${id}/dispute`).send({ reason: "Customer says damaged" });
    const [d] = await db.select().from(deliveryDisputesTable).where(eq(deliveryDisputesTable.orderId, id));

    paystack.paystackRefund.mockRejectedValueOnce(new Error("declined"));
    expect((await request(app).post(`/admin/delivery-disputes/${d.id}/resolve`).send({ resolution: "split", refundNaira: 4000 })).status).toBe(502);
    expect((await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id)))[0].status).toBe("disputed");

    expect((await request(app).post(`/admin/delivery-disputes/${d.id}/resolve`).send({ resolution: "split", refundNaira: 10000 })).status).toBe(400);
    paystack.paystackRefund.mockResolvedValue(undefined);
    expect((await request(app).post(`/admin/delivery-disputes/${d.id}/resolve`).send({ resolution: "split", refundNaira: 4000 })).status).toBe(200);
    expect(paystack.paystackRefund).toHaveBeenLastCalledWith(expect.stringMatching(/^del_/), 400_000);
    const [row] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
    expect(row).toMatchObject({ status: "delivered", payoutStatus: "queued", refundKobo: 400_000 });
  });

  it("outsiders cannot touch a job", async () => {
    const { id } = await paidOrder();
    as(`outsider_${randomUUID()}`);
    for (const path of ["pay", "cancel", "confirm", "dispute", "deliver", "rate"]) {
      expect((await request(app).post(`/delivery/orders/${id}/${path}`).send({ reason: "hello there", stars: 5, code: "0000" })).status).toBe(404);
    }
  });
});
