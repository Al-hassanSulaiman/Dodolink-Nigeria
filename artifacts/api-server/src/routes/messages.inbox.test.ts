import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool, storesTable, conversationsTable, messagesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const identity = vi.hoisted(() => ({ userId: "" }));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: identity.userId }),
  clerkClient: { users: { getUser: vi.fn(async () => ({
    primaryEmailAddressId: "primary",
    emailAddresses: [{ id: "primary", emailAddress: "chat-qa@example.com" }],
  })) } },
}));
vi.mock("../lib/push", () => ({ notifyTokens: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/storeSubscription", () => ({ checkAndSetQualifiedAt: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class { getObjectEntityFile = vi.fn().mockResolvedValue({}); },
  ObjectNotFoundError: class extends Error {},
}));
vi.mock("../lib/mediaLimits", () => ({ validateStoredMedia: vi.fn().mockResolvedValue({ ok: true }) }));
import router from "./messages";
import { checkAndSetQualifiedAt } from "../lib/storeSubscription";

const app = express();
app.use(express.json(), router);
const storeIds: number[] = [];
let buyer: string;
let seller: string;
let ownStore: typeof storesTable.$inferSelect;
let targetStore: typeof storesTable.$inferSelect;

async function store(ownerUserId: string) {
  const [row] = await db.insert(storesTable).values({
    ownerUserId, ownerName: "QA", name: `Chat QA ${randomUUID()}`,
    description: "Disposable chat fixture", category: "QA", location: "QA", phone: "00000000000",
  }).returning();
  storeIds.push(row.id);
  return row;
}
beforeEach(async () => {
  vi.clearAllMocks();
  buyer = `chat_buyer_${randomUUID()}`;
  seller = `chat_seller_${randomUUID()}`;
  identity.userId = buyer;
  ownStore = await store(buyer);
  await store(seller); // An older store must not replace the target store's reply identity.
  targetStore = await store(seller);
});
afterEach(async () => {
  await db.delete(storesTable).where(inArray(storesTable.id, storeIds.splice(0)));
});
afterAll(() => pool.end());

async function start(initialMessage?: string) {
  return request(app).post("/conversations/start").send({
    customerId: buyer, customerName: "Spoofed client name", storeId: targetStore.id,
    ...(initialMessage !== undefined ? { initialMessage } : {}),
  });
}
async function inbox(userId = identity.userId, includeEmpty?: boolean) {
  return request(app).get("/conversations").query({ userId, ...(includeEmpty !== undefined ? { includeEmpty } : {}) });
}
async function send(id: number, body = "Hello", mediaUrl?: string) {
  return request(app).post(`/conversations/${id}/messages`).send({
    senderId: identity.userId, senderName: "Spoofed client name", senderType: "retailer",
    body, ...(mediaUrl ? { mediaUrl } : {}),
  });
}

describe("chat drafts and store-owned sender identities", () => {
  it("opening/reopening a chat never puts an empty draft in either inbox", async () => {
    const opened = await start();
    expect(opened.status).toBe(201);
    expect(opened.body.customerName).toBe(ownStore.name);
    expect((await start()).body.id).toBe(opened.body.id);
    expect((await inbox()).body).toEqual([]);
    expect((await inbox(buyer, false)).body).toEqual([]);
    expect((await inbox(buyer, true)).body[0]).toMatchObject({
      id: opened.body.id, storeName: targetStore.name, customerName: ownStore.name,
    });
    identity.userId = seller;
    expect((await inbox()).body).toEqual([]);
    expect(checkAndSetQualifiedAt).not.toHaveBeenCalled();
  });

  it("the first sent text activates both inboxes with the owner's store name and correct unread count", async () => {
    const opened = await start();
    const sent = await send(opened.body.id);
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ senderName: ownStore.name, senderType: "customer" });
    expect((await inbox()).body[0]).toMatchObject({ id: opened.body.id, unreadCount: 0 });
    identity.userId = seller;
    expect((await inbox()).body[0]).toMatchObject({
      id: opened.body.id, customerName: ownStore.name, unreadCount: 1, lastMessage: "Hello",
    });
    expect(checkAndSetQualifiedAt).toHaveBeenCalledWith(targetStore.id);
  });

  it("whitespace is not a message and cannot activate a draft", async () => {
    const opened = await start("   ");
    expect(opened.status).toBe(201);
    expect((await send(opened.body.id, " \n ")).status).toBe(400);
    expect((await inbox()).body).toEqual([]);
    expect(checkAndSetQualifiedAt).not.toHaveBeenCalled();
  });

  it("a photo/video-only first message activates the inbox too", async () => {
    const opened = await start();
    expect((await send(opened.body.id, "", "/objects/chat-qa-fixture")).status).toBe(201);
    identity.userId = seller;
    expect((await inbox()).body[0]).toMatchObject({ id: opened.body.id, lastMessage: "📷 Media", unreadCount: 1 });
  });

  it("a real initial message is visible and unread, rather than being mistaken for a draft", async () => {
    const opened = await start("Hello initially");
    expect(opened.status).toBe(201);
    identity.userId = seller;
    expect((await inbox()).body[0]).toMatchObject({ id: opened.body.id, unreadCount: 1 });
    expect(checkAndSetQualifiedAt).toHaveBeenCalledWith(targetStore.id);
  });

  it("old conversations and message labels use the current store name after a rename", async () => {
    const opened = await start();
    await send(opened.body.id);
    await db.update(conversationsTable).set({ customerName: "old-email@example.com" }).where(eq(conversationsTable.id, opened.body.id));
    await db.update(messagesTable).set({ senderName: "old-email@example.com" }).where(eq(messagesTable.conversationId, opened.body.id));
    const renamed = `${ownStore.name} Renamed`;
    await db.update(storesTable).set({ name: renamed }).where(eq(storesTable.id, ownStore.id));
    identity.userId = seller;
    expect((await inbox()).body[0].customerName).toBe(renamed);
    const history = await request(app).get(`/conversations/${opened.body.id}/messages`);
    expect(history.status).toBe(200);
    expect(history.body[0].senderName).toBe(renamed);
    // Replies identify the actual contacted store, even when this seller owns another older one.
    const reply = await send(opened.body.id, "Reply");
    expect(reply.body).toMatchObject({ senderName: targetStore.name, senderType: "retailer" });
  });

  it("people without a store retain their account identity, never a client-spoofed name", async () => {
    await db.delete(storesTable).where(eq(storesTable.id, ownStore.id));
    const opened = await start();
    expect(opened.body.customerName).toBe("chat-qa@example.com");
    const sent = await send(opened.body.id);
    expect(sent.body.senderName).toBe("chat-qa@example.com");
  });

  it("draft access and history remain isolated to participants", async () => {
    const opened = await start();
    identity.userId = `chat_outsider_${randomUUID()}`;
    expect((await inbox(identity.userId, true)).body).toEqual([]);
    expect((await inbox(buyer, true)).status).toBe(403);
    expect((await request(app).get(`/conversations/${opened.body.id}/messages`)).status).toBe(403);
    expect((await send(opened.body.id)).status).toBe(403);
  });
});
