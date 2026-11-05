import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db, pool, deliveryAgentsTable, userBlocksTable, contentReportsTable, bannedUsersTable, storesTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const identity = vi.hoisted(() => ({ userId: "" }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: identity.userId || null }),
  clerkClient: { users: {
    getUser: vi.fn(async (id: string) => ({
      firstName: null, lastName: null, username: id, primaryEmailAddressId: "p",
      emailAddresses: [{ id: "p", emailAddress: `${id}@example.com` }],
    })),
    getUserList: vi.fn(async () => ({ data: [] })),
  } },
}));
vi.mock("../lib/push", () => ({ notifyTokens: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/chatMedia", () => ({ checkChatMedia: vi.fn(async () => ({ ok: true })) }));
import deliveryRouter from "./delivery";
import blocksRouter from "./blocks";
import contentReportsRouter from "./contentReports";
import ugcGuardsRouter from "./ugcGuards";
import { deliveryAdminRouter } from "./deliveryAdmin";
import { preventBannedUsers } from "../lib/ugcSafety";

const app = express();
app.use(express.json(), preventBannedUsers, ugcGuardsRouter, blocksRouter, contentReportsRouter, deliveryRouter, deliveryAdminRouter);

const users: string[] = [];
const agents: number[] = [];
let me: string;
let other: string;
let agentId: number;

beforeEach(async () => {
  me = `ugc_me_${randomUUID()}`;
  other = `ugc_other_${randomUUID()}`;
  users.push(me, other);
  const [a] = await db.insert(deliveryAgentsTable).values({
    name: `Safe Logistics ${randomUUID().slice(0, 6)}`, phone: "08000000000", deliveryType: "both",
    homeState: "Kano", coveredStates: ["Kaduna"], linkedUserId: other,
  }).returning();
  agentId = a.id;
  agents.push(a.id);
  identity.userId = me;
});
afterEach(async () => {
  await db.delete(userBlocksTable).where(inArray(userBlocksTable.blockerId, users));
  await db.delete(contentReportsTable).where(inArray(contentReportsTable.reporterId, users));
  await db.delete(bannedUsersTable).where(inArray(bannedUsersTable.userId, users));
  if (agents.length) await db.delete(deliveryAgentsTable).where(inArray(deliveryAgentsTable.id, agents.splice(0)));
  users.length = 0;
});
afterAll(() => pool.end());

describe("blocking", () => {
  it("blocks, lists and unblocks a person, and tells the team once", async () => {
    expect((await request(app).post("/blocks").send({ userId: me })).status).toBe(400);
    expect((await request(app).post("/blocks").send({ userId: other })).status).toBe(201);
    await request(app).post("/blocks").send({ userId: other });
    const list = await request(app).get("/blocks");
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ userId: other, name: other });
    const reports = await db.select().from(contentReportsTable).where(eq(contentReportsTable.reporterId, me));
    expect(reports.filter(r => r.kind === "block")).toHaveLength(1);
    await request(app).delete(`/blocks/${other}`);
    expect((await request(app).get("/blocks")).body).toHaveLength(0);
  });

  it("stops either side starting or continuing a delivery chat", async () => {
    const started = await request(app).post("/delivery/conversations/start").send({ agentId });
    expect(started.status).toBeLessThan(300);
    await request(app).post(`/delivery/conversations/${started.body.id}/messages`).send({ body: "Hello" });
    await request(app).post("/blocks").send({ userId: other });
    const send = await request(app).post(`/delivery/conversations/${started.body.id}/messages`).send({ body: "Again" });
    expect(send.status).toBe(403);
    expect((await request(app).post("/delivery/conversations/start").send({ agentId })).status).toBe(403);
    // The company cannot write to the person who blocked them either.
    identity.userId = other;
    expect((await request(app).post(`/delivery/conversations/${started.body.id}/messages`).send({ body: "Hi" })).status).toBe(403);
    // The chat is gone from the blocker's inbox.
    identity.userId = me;
    expect((await request(app).get("/delivery/conversations")).body).toHaveLength(0);
  });

  it("refuses clearly objectionable text", async () => {
    const started = await request(app).post("/delivery/conversations/start").send({ agentId });
    const res = await request(app).post(`/delivery/conversations/${started.body.id}/messages`).send({ body: "free porn" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not allowed/i);
  });
});

describe("reporting and removing", () => {
  it("reports a person, and an admin removes them: they are locked out", async () => {
    expect((await request(app).post("/content-reports").send({ kind: "user", targetId: me, reason: "I am myself" })).status).toBe(400);
    const made = await request(app).post("/content-reports").send({ kind: "user", targetId: other, reason: "Sends abusive messages" });
    expect(made.status).toBe(201);
    expect((await request(app).post("/content-reports").send({ kind: "user", targetId: other, reason: "Sends abusive messages" })).body.status).toBe("already_reported");
    expect((await request(app).post("/content-reports").send({ kind: "store", targetId: "999999999", reason: "Fake store" })).status).toBe(404);

    const done = await request(app).post(`/admin/content-reports/${made.body.id}/resolve`).send({ action: "ban", note: "Abuse" });
    expect(done.body).toMatchObject({ status: "resolved", action: "banned" });
    identity.userId = other;
    const blocked = await request(app).get("/blocks");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/removed/i);
  });

  it("dismissing a report changes nothing else", async () => {
    const made = await request(app).post("/content-reports").send({ kind: "user", targetId: other, reason: "Rude to me" });
    const done = await request(app).post(`/admin/content-reports/${made.body.id}/resolve`).send({ action: "dismiss" });
    expect(done.body.action).toBe("dismissed");
    expect((await db.select().from(bannedUsersTable).where(eq(bannedUsersTable.userId, other)))).toHaveLength(0);
  });
});
