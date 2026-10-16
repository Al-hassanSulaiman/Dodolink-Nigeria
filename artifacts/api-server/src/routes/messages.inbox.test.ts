import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool, storesTable, conversationsTable, messagesTable, productsTable } from "@workspace/db";
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
async function send(id: number, body = "Hello", mediaUrl?: string, context: { replyToMessageId?: number; productId?: number } = {}) {
  return request(app).post(`/conversations/${id}/messages`).send({
    senderId: identity.userId, senderName: "Spoofed client name", senderType: "retailer",
    body, ...(mediaUrl ? { mediaUrl } : {}), ...context,
  });
}

describe("persistent reply and product message context", () => {
  it("allows either participant to reply to their own or the other person's text/photo", async () => {
    const opened = await start();
    const photo = await send(opened.body.id, "", "/objects/qa-reply-photo");
    const ownReply = await send(opened.body.id, "My own photo", undefined, { replyToMessageId: photo.body.id });
    expect(ownReply.status).toBe(201);
    expect(ownReply.body.replyPreview).toMatchObject({
      id: photo.body.id, senderId: buyer, senderName: ownStore.name, mediaUrl: "/objects/qa-reply-photo",
    });
    identity.userId = seller;
    const otherReply = await send(opened.body.id, "Reply to customer", undefined, { replyToMessageId: photo.body.id });
    expect(otherReply.status).toBe(201);
    const retailerOwn = await send(opened.body.id, "Reply to myself", undefined, { replyToMessageId: otherReply.body.id });
    expect(retailerOwn.body.replyPreview.senderName).toBe(targetStore.name);
    identity.userId = buyer;
    const replyToRetailer = await send(opened.body.id, "Reply to retailer", undefined, { replyToMessageId: otherReply.body.id });
    expect(replyToRetailer.body.replyPreview.senderName).toBe(targetStore.name);
    const history = await request(app).get(`/conversations/${opened.body.id}/messages`);
    expect(history.body.find((m: { id: number }) => m.id === ownReply.body.id).replyPreview.mediaUrl).toBe("/objects/qa-reply-photo");
  });

  it("can attach a new photo as a reply and preserves its quoted text", async () => {
    const opened = await start();
    const original = await send(opened.body.id, "Show me a picture");
    const reply = await send(opened.body.id, "", "/objects/qa-photo-response", { replyToMessageId: original.body.id });
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ mediaUrl: "/objects/qa-photo-response", replyPreview: { body: "Show me a picture" } });
  });

  it("rejects cross-conversation, missing, fractional and oversized reply IDs", async () => {
    const opened = await start();
    const [other] = await db.insert(conversationsTable).values({
      customerId: buyer, customerName: "QA", storeId: ownStore.id,
    }).returning();
    const [original] = await db.insert(messagesTable).values({
      conversationId: other.id, senderId: buyer, senderName: "QA", senderType: "customer", body: "Private",
    }).returning();
    for (const value of [original.id, 2147483647, 1.5, 2147483648]) {
      expect((await send(opened.body.id, "Invalid quote", undefined, { replyToMessageId: value })).status).toBe(400);
    }
    expect(await db.select().from(messagesTable).where(eq(messagesTable.conversationId, opened.body.id))).toHaveLength(0);
  });

  it("snapshots a real product, not supplied client data, and keeps history after deletion", async () => {
    const opened = await start();
    const [product] = await db.insert(productsTable).values({
      storeId: targetStore.id, name: "QA product", description: "QA", category: "QA",
      price: "70000", imageUrl: "/objects/qa-product-photo",
    }).returning();
    const sent = await request(app).post(`/conversations/${opened.body.id}/messages`).send({
      senderId: buyer, senderName: "Fake", senderType: "customer", body: "Is this available?",
      productId: product.id, productPreview: { name: "Forged", price: 1 },
    });
    expect(sent.status).toBe(201);
    expect(sent.body.productPreview).toMatchObject({
      id: product.id, name: "QA product", price: 70000, imageUrl: "/objects/qa-product-photo",
    });
    await db.delete(productsTable).where(eq(productsTable.id, product.id));
    const history = await request(app).get(`/conversations/${opened.body.id}/messages`);
    expect(history.body[0].productPreview.name).toBe("QA product");
  });

  it("rejects another store's product and ambiguous double context", async () => {
    const opened = await start();
    const [product] = await db.insert(productsTable).values({
      storeId: ownStore.id, name: "Other store", description: "QA", category: "QA", price: "1",
    }).returning();
    expect((await send(opened.body.id, "Wrong product", undefined, { productId: product.id })).status).toBe(400);
    const original = await send(opened.body.id);
    expect((await send(opened.body.id, "Two contexts", undefined, {
      productId: product.id, replyToMessageId: original.body.id,
    })).status).toBe(400);
  });

  it("does not allow outsiders to quote any message or product", async () => {
    const opened = await start();
    const original = await send(opened.body.id);
    identity.userId = `outsider_${randomUUID()}`;
    expect((await send(opened.body.id, "No access", undefined, { replyToMessageId: original.body.id })).status).toBe(403);
  });
});

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
