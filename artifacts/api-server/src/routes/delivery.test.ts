import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool, deliveryAgentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const identity = vi.hoisted(() => ({ userId: "", accounts: {} as Record<string, string> }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: identity.userId || null }),
  clerkClient: { users: {
    getUser: vi.fn(async () => ({ firstName: "Ada", lastName: "Buyer", username: null })),
    getUserList: vi.fn(async ({ emailAddress }: { emailAddress: string[] }) => ({
      data: identity.accounts[emailAddress[0]] ? [{ id: identity.accounts[emailAddress[0]] }] : [],
    })),
  } },
}));
vi.mock("../lib/paystack", () => ({
  paystackResolveAccount: vi.fn(async (_n: string, code: string) => {
    if (code === "bad") throw new Error("Could not resolve account name");
    return { account_name: "MUSA LOGISTICS LTD" };
  }),
  paystackListBanks: vi.fn(async () => [{ name: "Test Bank", code: "058" }]),
}));
vi.mock("../lib/push", () => ({ notifyTokens: vi.fn().mockResolvedValue(undefined) }));
import router from "./delivery";
import { deliveryAdminRouter } from "./deliveryAdmin";
import { validateCoverage } from "../lib/nigerianStates";

const app = express();
app.use(express.json(), router, deliveryAdminRouter);
const agentIds: number[] = [];
let customer: string;
let agentUser: string;

async function agent(over: Partial<typeof deliveryAgentsTable.$inferInsert> = {}) {
  const [row] = await db.insert(deliveryAgentsTable).values({
    name: `QA Rider ${randomUUID().slice(0, 6)}`, phone: "08000000000",
    deliveryType: "intrastate", homeState: "Kano", bankAccountNumber: "0123456789",
    ...over,
  }).returning();
  agentIds.push(row.id);
  return row;
}
beforeEach(() => {
  customer = `del_customer_${randomUUID()}`;
  agentUser = `del_agent_${randomUUID()}`;
  identity.userId = customer;
  identity.accounts = {};
});
afterEach(async () => {
  if (agentIds.length) await db.delete(deliveryAgentsTable).where(inArray(deliveryAgentsTable.id, agentIds.splice(0)));
});
afterAll(() => pool.end());

describe("coverage rules", () => {
  it("requires the right states for each delivery type", () => {
    expect(validateCoverage({ deliveryType: "intrastate", homeState: null, coveredStates: [], nationwide: false })).toMatch(/home state/);
    expect(validateCoverage({ deliveryType: "intrastate", homeState: "Kano", coveredStates: [], nationwide: false })).toBeNull();
    expect(validateCoverage({ deliveryType: "interstate", homeState: null, coveredStates: [], nationwide: false })).toMatch(/Nationwide/);
    expect(validateCoverage({ deliveryType: "interstate", homeState: null, coveredStates: ["Kaduna"], nationwide: false })).toBeNull();
    expect(validateCoverage({ deliveryType: "both", homeState: "Kano", coveredStates: [], nationwide: true })).toBeNull();
    expect(validateCoverage({ deliveryType: "both", homeState: null, coveredStates: ["Kaduna"], nationwide: false })).toMatch(/home state/);
    expect(validateCoverage({ deliveryType: "interstate", homeState: null, coveredStates: ["Atlantis"], nationwide: false })).toMatch(/Unknown/);
  });
});

describe("delivery people list", () => {
  it("requires sign-in, and never returns phone or bank details", async () => {
    identity.userId = "";
    expect((await request(app).get("/delivery/agents")).status).toBe(401);
    identity.userId = customer;
    const a = await agent();
    const res = await request(app).get("/delivery/agents");
    expect(res.status).toBe(200);
    const mine = res.body.find((x: { id: number }) => x.id === a.id);
    expect(mine).toMatchObject({ name: a.name, deliveryType: "intrastate", homeState: "Kano" });
    expect(JSON.stringify(res.body)).not.toMatch(/08000000000|0123456789|bank|phone|linkedUserId/i);
  });

  it("filters by type and state, and 'both' appears under either type", async () => {
    const intra = await agent({ deliveryType: "intrastate", homeState: "Lagos" });
    const inter = await agent({ deliveryType: "interstate", homeState: null, coveredStates: ["Kaduna"] });
    const both = await agent({ deliveryType: "both", homeState: "Lagos", nationwide: true });
    const hidden = await agent({ active: false });
    const ids = async (q: string) => (await request(app).get(`/delivery/agents${q}`)).body.map((x: { id: number }) => x.id);
    const intraList = await ids("?type=intrastate");
    expect(intraList).toEqual(expect.arrayContaining([intra.id, both.id]));
    expect(intraList).not.toContain(inter.id);
    const interList = await ids("?type=interstate");
    expect(interList).toEqual(expect.arrayContaining([inter.id, both.id]));
    expect(interList).not.toContain(intra.id);
    const kaduna = await ids("?state=Kaduna");
    expect(kaduna).toEqual(expect.arrayContaining([inter.id, both.id]));
    expect(kaduna).not.toContain(intra.id);
    expect(await ids("")).not.toContain(hidden.id);
  });
});

describe("delivery chat", () => {
  it("customer and delivery person can chat; outsiders cannot read or write", async () => {
    const a = await agent({ linkedUserId: agentUser });
    const started = await request(app).post("/delivery/conversations/start").send({ agentId: a.id });
    expect(started.status).toBe(201);
    const again = await request(app).post("/delivery/conversations/start").send({ agentId: a.id });
    expect(again.body.id).toBe(started.body.id);
    const convId = started.body.id;

    // Empty drafts are not in the inbox.
    expect((await request(app).get("/delivery/conversations")).body).toHaveLength(0);
    expect((await request(app).post(`/delivery/conversations/${convId}/messages`).send({ body: "   " })).status).toBe(400);
    expect((await request(app).post(`/delivery/conversations/${convId}/messages`).send({ body: "Can you deliver to Kaduna?" })).status).toBe(201);

    const customerInbox = (await request(app).get("/delivery/conversations")).body;
    expect(customerInbox).toHaveLength(1);
    expect(customerInbox[0]).toMatchObject({ role: "customer", title: a.name, unread: 0 });

    identity.userId = agentUser;
    const agentInbox = (await request(app).get("/delivery/conversations")).body;
    expect(agentInbox[0]).toMatchObject({ role: "agent", title: "Ada Buyer", unread: 1 });
    expect((await request(app).get("/delivery/me")).body.agent.id).toBe(a.id);
    const thread = await request(app).get(`/delivery/conversations/${convId}/messages`);
    expect(thread.body.messages).toHaveLength(1);
    expect(thread.body.messages[0].mine).toBe(false);
    expect((await request(app).post(`/delivery/conversations/${convId}/messages`).send({ body: "Yes, tomorrow." })).status).toBe(201);
    await request(app).post(`/delivery/conversations/${convId}/read`);
    expect((await request(app).get("/delivery/conversations")).body[0].unread).toBe(0);

    identity.userId = customer;
    expect((await request(app).get("/delivery/conversations")).body[0].unread).toBe(1);

    identity.userId = `outsider_${randomUUID()}`;
    expect((await request(app).get(`/delivery/conversations/${convId}/messages`)).status).toBe(404);
    expect((await request(app).post(`/delivery/conversations/${convId}/messages`).send({ body: "hi" })).status).toBe(404);
    expect((await request(app).get("/delivery/me")).body.agent).toBeNull();
  });

  it("a delivery person cannot chat with himself, and inactive people cannot be started", async () => {
    const a = await agent({ linkedUserId: customer });
    expect((await request(app).post("/delivery/conversations/start").send({ agentId: a.id })).status).toBe(400);
    const off = await agent({ active: false });
    expect((await request(app).post("/delivery/conversations/start").send({ agentId: off.id })).status).toBe(404);
    expect((await request(app).post("/delivery/conversations/start").send({ agentId: "abc" })).status).toBe(400);
  });
});

describe("admin delivery companies", () => {
  const base = { name: "Musa Logistics", phone: "08011112222", deliveryType: "intrastate", homeState: "Kano" };
  let n = 0;
  const withAccount = (over: Record<string, unknown> = {}) => {
    const email = `company${++n}-${randomUUID().slice(0, 6)}@example.com`;
    identity.accounts[email] = `acct_${randomUUID()}`;
    return { ...base, accountEmail: email, ...over };
  };
  const make = async (over: Record<string, unknown> = {}) => {
    const res = await request(app).post("/admin/delivery-agents").send(withAccount(over));
    if (res.body?.id) agentIds.push(res.body.id);
    return res;
  };

  it("creates all three kinds, rejects incomplete coverage, requires a login email", async () => {
    expect((await make()).status).toBe(201);
    expect((await make({ deliveryType: "interstate", homeState: null })).status).toBe(400);
    const inter = await make({ deliveryType: "interstate", coveredStates: ["Kaduna", "Kaduna", "Abia"] });
    expect(inter.status).toBe(201);
    expect(inter.body.coveredStates).toEqual(["Kaduna", "Abia"]);
    const both = await make({ deliveryType: "both", nationwide: true });
    expect(both.body).toMatchObject({ deliveryType: "both", nationwide: true, homeState: "Kano" });
    // An intrastate company never keeps interstate coverage.
    const intra = await make({ coveredStates: ["Lagos"], nationwide: true });
    expect(intra.body).toMatchObject({ coveredStates: [], nationwide: false });

    const noEmail = await request(app).post("/admin/delivery-agents").send(base);
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error).toMatch(/email/i);
    const noAccount = await request(app).post("/admin/delivery-agents").send({ ...base, accountEmail: "nobody@example.com" });
    expect(noAccount.status).toBe(400);
    expect(noAccount.body.error).toMatch(/sign up/);
  });

  it("links by account email (case-insensitive) and refuses a second company on the same account", async () => {
    identity.accounts["rider@example.com"] = agentUser;
    const linked = await request(app).post("/admin/delivery-agents").send({ ...base, accountEmail: "Rider@Example.com" });
    expect(linked.status).toBe(201);
    agentIds.push(linked.body.id);
    expect(linked.body.linkedUserId).toBe(agentUser);
    const dupe = await request(app).post("/admin/delivery-agents").send({ ...base, accountEmail: "rider@example.com" });
    expect(dupe.status).toBe(409);
  });

  it("verifies the bank account with Paystack and stores the real account name", async () => {
    const ok = await make({ bankName: "Test Bank", bankCode: "058", bankAccountNumber: "0123456789", bankAccountName: "typed by admin" });
    expect(ok.status).toBe(201);
    expect(ok.body.bankAccountName).toBe("MUSA LOGISTICS LTD");
    expect((await make({ bankCode: "bad", bankAccountNumber: "0123456789" })).status).toBe(400);
    expect((await make({ bankCode: "058", bankAccountNumber: "123" })).status).toBe(400);
    expect((await make({ bankCode: "058" })).status).toBe(400);
    expect((await request(app).get("/admin/delivery-banks")).body).toEqual([{ name: "Test Bank", code: "058" }]);
  });

  it("edits, deactivates, and does not unlink the account when the email box is left empty", async () => {
    const a = await agent({ linkedUserId: agentUser });
    const res = await request(app).patch(`/admin/delivery-agents/${a.id}`)
      .send({ ...base, active: false, deliveryType: "both", nationwide: true });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, a.id));
    expect(row).toMatchObject({ active: false, deliveryType: "both", nationwide: true, linkedUserId: agentUser });
    expect((await request(app).patch("/admin/delivery-agents/999999").send(base)).status).toBe(404);
  });
});
