import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db, pool, deliveryAgentsTable, deliverySubscriptionPaymentsTable, chatReportsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const identity = vi.hoisted(() => ({ userId: "" }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: identity.userId || null }),
  clerkClient: { users: {
    getUser: vi.fn(async () => ({
      firstName: "Ada", lastName: "Buyer", username: null,
      primaryEmailAddressId: "p", emailAddresses: [{ id: "p", emailAddress: "buyer.one@gmail.com" }],
    })),
    getUserList: vi.fn(async () => ({ data: [] })),
  } },
}));
vi.mock("../lib/push", () => ({ notifyTokens: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/chatMedia", () => ({
  checkChatMedia: vi.fn(async (url: string) => url.includes("bad") ? { ok: false, error: "Not allowed" } : { ok: true }),
}));
import deliveryRouter from "./delivery";
import chatReportsRouter from "./chatReports";
import { deliveryAdminRouter } from "./deliveryAdmin";
import {
  activateAgentForReference, agentIsVisible, deliveryEngagementCount, checkAndSetAgentQualified,
} from "../lib/deliverySubscription";
import { friendlyName } from "../lib/displayName";

const app = express();
app.use(express.json(), deliveryRouter, chatReportsRouter, deliveryAdminRouter);
const agentIds: number[] = [];
let customer: string;
let company: string;
let agentId: number;
let convId: number;

beforeEach(async () => {
  customer = `chat_customer_${randomUUID()}`;
  company = `chat_company_${randomUUID()}`;
  const [row] = await db.insert(deliveryAgentsTable).values({
    name: `Chat Logistics ${randomUUID().slice(0, 6)}`, phone: "08000000000", deliveryType: "both",
    homeState: "Kano", coveredStates: ["Kaduna"], linkedUserId: company,
  }).returning();
  agentId = row.id;
  agentIds.push(row.id);
  identity.userId = customer;
  convId = (await request(app).post("/delivery/conversations/start").send({ agentId })).body.id;
});
afterEach(async () => {
  if (agentIds.length) {
    await db.delete(chatReportsTable).where(inArray(chatReportsTable.reporterId, [customer, company]));
    await db.delete(deliveryAgentsTable).where(inArray(deliveryAgentsTable.id, agentIds.splice(0)));
  }
});
afterAll(() => pool.end());

const asCompany = () => { identity.userId = company; };
const asCustomer = () => { identity.userId = customer; };
const send = (body: object) => request(app).post(`/delivery/conversations/${convId}/messages`).send(body);

describe("names", () => {
  it("shows an email without its domain", () => {
    expect(friendlyName("buyer.one@gmail.com")).toBe("buyer.one");
    expect(friendlyName("Ada Stores")).toBe("Ada Stores");
  });
  it("labels a customer by email without the domain when they have no store or company", async () => {
    const sent = await send({ body: "Hello" });
    expect(sent.status).toBe(201);
    expect(sent.body.senderName).toBe("buyer.one");
  });
});

describe("delivery chat like the normal chat", () => {
  it("sends a photo with no text, and refuses a rejected file", async () => {
    const ok = await send({ mediaUrl: "/objects/uploads/good-photo" });
    expect(ok.status).toBe(201);
    expect(ok.body.mediaUrl).toBe("/objects/uploads/good-photo");
    expect((await send({ mediaUrl: "/objects/uploads/bad-file" })).status).toBe(400);
    expect((await send({})).status).toBe(400);
  });
  it("replies to a message and keeps a preview", async () => {
    const first = await send({ body: "Can you deliver to Kaduna?" });
    asCompany();
    const reply = await send({ body: "Yes", replyToMessageId: first.body.id });
    expect(reply.status).toBe(201);
    expect(reply.body.replyPreview).toMatchObject({ id: first.body.id, body: "Can you deliver to Kaduna?" });
    const thread = await request(app).get(`/delivery/conversations/${convId}/messages`);
    expect(thread.body.messages.at(-1).replyPreview.id).toBe(first.body.id);
    expect((await send({ body: "x", replyToMessageId: 999999999 })).status).toBe(400);
  });
});

describe("rating a company", () => {
  it("needs a reply first, then keeps one changeable rating per customer", async () => {
    await send({ body: "Hi" });
    const early = await request(app).post(`/delivery/agents/${agentId}/rating`).send({ stars: 5 });
    expect(early.status).toBe(403);
    asCompany();
    await send({ body: "Hello" });
    asCustomer();
    expect((await request(app).post(`/delivery/agents/${agentId}/rating`).send({ stars: 0 })).status).toBe(400);
    await request(app).post(`/delivery/agents/${agentId}/rating`).send({ stars: 5, comment: "Fast" });
    const changed = await request(app).post(`/delivery/agents/${agentId}/rating`).send({ stars: 3 });
    expect(changed.body).toMatchObject({ ratingAverage: 3, ratingCount: 1 });
    const thread = await request(app).get(`/delivery/conversations/${convId}/messages`);
    expect(thread.body.myRating.stars).toBe(3);
    expect(thread.body.canRate).toBe(true);
  });
});

describe("reports", () => {
  it("lets either side report a delivery chat, and admin reads it and resolves it", async () => {
    await send({ body: "He took my goods" });
    expect((await request(app).post("/reports").send({ kind: "delivery", conversationId: convId, reason: "no" })).status).toBe(400);
    const made = await request(app).post("/reports").send({ kind: "delivery", conversationId: convId, reason: "Company did not deliver" });
    expect(made.status).toBe(201);
    expect((await request(app).post("/reports").send({ kind: "delivery", conversationId: convId, reason: "Company did not deliver" })).body.status).toBe("already_reported");
    identity.userId = "someone_else";
    expect((await request(app).post("/reports").send({ kind: "delivery", conversationId: convId, reason: "I am a stranger" })).status).toBe(403);
    const chat = await request(app).get(`/admin/reports/${made.body.id}/chat`);
    expect(chat.body.messages[0].body).toBe("He took my goods");
    const done = await request(app).post(`/admin/reports/${made.body.id}/resolve`).send({ note: "Refunded" });
    expect(done.body.status).toBe("resolved");
  });
});

describe("delivery subscription", () => {
  const now = Date.now();
  const base = { active: true, qualifiedAt: null as Date | null, subscriptionDueAt: null as Date | null,
    subscriptionLastPaidAt: null as Date | null, subscriptionExempt: false };
  it("hides a company that never paid after the grace period, but not before", () => {
    expect(agentIsVisible(base, now)).toBe(true);
    expect(agentIsVisible({ ...base, qualifiedAt: new Date(now - 3 * 86400_000) }, now)).toBe(true);
    expect(agentIsVisible({ ...base, qualifiedAt: new Date(now - 8 * 86400_000) }, now)).toBe(false);
    expect(agentIsVisible({ ...base, qualifiedAt: new Date(now - 30 * 86400_000), subscriptionExempt: true }, now)).toBe(true);
  });
  it("shows a paid company until the month ends, then hides it", () => {
    const qualifiedAt = new Date(now - 60 * 86400_000);
    expect(agentIsVisible({ ...base, qualifiedAt, subscriptionLastPaidAt: new Date(now - 86400_000), subscriptionDueAt: new Date(now + 20 * 86400_000) }, now)).toBe(true);
    expect(agentIsVisible({ ...base, qualifiedAt, subscriptionLastPaidAt: new Date(now - 40 * 86400_000), subscriptionDueAt: new Date(now - 10 * 86400_000) }, now)).toBe(false);
  });
  it("the Delivery list hides an unpaid company past its grace period", async () => {
    await db.update(deliveryAgentsTable).set({ qualifiedAt: new Date(now - 10 * 86400_000) }).where(eq(deliveryAgentsTable.id, agentId));
    const list = await request(app).get("/delivery/agents");
    expect(list.body.some((a: { id: number }) => a.id === agentId)).toBe(false);
  });
  it("activates once per payment reference and checks the amount", async () => {
    const reference = `dodolink_dsub_${agentId}_${Date.now()}`;
    await db.insert(deliverySubscriptionPaymentsTable).values({ reference, agentId, quotedAmountKobo: 200_000 });
    expect(await activateAgentForReference({ reference, amountKobo: 100 })).toBe("amount_mismatch");
    expect(await activateAgentForReference({ reference, amountKobo: 200_000 })).toBe("activated");
    expect(await activateAgentForReference({ reference, amountKobo: 200_000 })).toBe("already_used");
    expect(await activateAgentForReference({ reference: "nope", amountKobo: 1 })).toBe("unknown_reference");
    const [row] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, agentId));
    expect(row.subscriptionDueAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
  });
  it("starts the clock once 7 different customers have chatted", async () => {
    expect(await deliveryEngagementCount(agentId)).toBe(0);
    await send({ body: "Hi" });
    expect(await deliveryEngagementCount(agentId)).toBe(1);
    await checkAndSetAgentQualified(agentId);
    const [row] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, agentId));
    expect(row.qualifiedAt).toBeNull();
  });
});
