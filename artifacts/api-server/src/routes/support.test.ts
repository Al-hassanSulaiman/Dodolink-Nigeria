import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool, supportMessagesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const identity = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: identity.userId }),
  clerkClient: { users: { getUser: vi.fn() } },
}));
import router from "./support";

const app = express();
app.use(express.json(), router);
const fixtureUsers: string[] = [];
let owner: string;
let otherUser: string;

beforeEach(() => {
  owner = `support_fixture_${randomUUID()}`;
  otherUser = `support_fixture_${randomUUID()}`;
  fixtureUsers.push(owner, otherUser);
  identity.userId = owner;
});
afterEach(async () => {
  await db.delete(supportMessagesTable).where(inArray(supportMessagesTable.userId, fixtureUsers.splice(0)));
  identity.userId = null;
});
afterAll(() => pool.end());

async function reply(userId = owner, senderRole = "admin", readByUser = false) {
  const [row] = await db.insert(supportMessagesTable).values({
    userId, userName: "Support fixture", senderRole, body: "Test-only support reply", readByUser,
  }).returning();
  return row;
}
async function isRead(id: number) {
  const [row] = await db.select().from(supportMessagesTable).where(eq(supportMessagesTable.id, id));
  return row.readByUser;
}

describe("support unread state", () => {
  it("requires sign-in for reading or marking support replies", async () => {
    identity.userId = null;
    expect((await request(app).get("/support/messages")).status).toBe(401);
    expect((await request(app).post("/support/read").send({ messageIds: [1] })).status).toBe(401);
  });

  it("fetching a user's badge data does not mark replies read or disclose other users", async () => {
    const mine = await reply();
    await reply(otherUser);
    const response = await request(app).get("/support/messages");
    expect(response.status).toBe(200);
    expect(response.body.map((message: { id: number }) => message.id)).toEqual([mine.id]);
    expect(await isRead(mine.id)).toBe(false);
  });

  it("marks only displayed replies, never a later arrival, another user, or a user's own message", async () => {
    const displayed = await reply();
    const later = await reply();
    const other = await reply(otherUser);
    const outbound = await reply(owner, "user");
    const response = await request(app).post("/support/read")
      .send({ messageIds: [displayed.id, other.id, outbound.id] });
    expect(response.status).toBe(200);
    expect(await isRead(displayed.id)).toBe(true);
    expect(await isRead(later.id)).toBe(false);
    expect(await isRead(other.id)).toBe(false);
    expect(await isRead(outbound.id)).toBe(false);
  });

  it("an empty displayed list cannot clear all unread replies", async () => {
    const message = await reply();
    expect((await request(app).post("/support/read").send({ messageIds: [] })).status).toBe(200);
    expect(await isRead(message.id)).toBe(false);
  });

  it("retains mark-all behavior for existing native clients", async () => {
    const mine = await reply();
    const other = await reply(otherUser);
    expect((await request(app).post("/support/read")).status).toBe(200);
    expect(await isRead(mine.id)).toBe(true);
    expect(await isRead(other.id)).toBe(false);
  });

  it.each([[-1], [1.5], ["1"], [2147483648]])("rejects invalid message IDs: %j", async (...ids) => {
    expect((await request(app).post("/support/read").send({ messageIds: ids })).status).toBe(400);
  });
});
