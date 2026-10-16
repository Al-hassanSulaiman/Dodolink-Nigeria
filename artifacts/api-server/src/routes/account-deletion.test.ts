import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeAll, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { db, pool } from "@workspace/db";
import { storeFollowsTable } from "@workspace/db";
import { accountDeletionsTable, mediaUploadsTable, storesTable, productsTable, conversationsTable, messagesTable, reviewsTable, pushTokensTable, supportMessagesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  userId: null as string | null,
  getUser: vi.fn(), deleteUser: vi.fn(), sendMail: vi.fn(),
  deleteFile: vi.fn(), getFile: vi.fn(), getPolicy: vi.fn(),
  getUpload: vi.fn(), normalize: vi.fn(),
}));
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: mocks.userId }),
  clerkClient: { users: { getUser: mocks.getUser, deleteUser: mocks.deleteUser } },
}));
vi.mock("../lib/deletionMail", () => ({ sendDeletionConfirmation: mocks.sendMail }));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = mocks.getFile;
    getObjectEntityUploadURL = mocks.getUpload;
    normalizeObjectEntityPath = mocks.normalize;
  },
  ObjectNotFoundError: class extends Error {},
}));
vi.mock("../lib/objectAcl", () => ({ getObjectAclPolicy: mocks.getPolicy }));
import deletionRouter from "./delete-account";
import storageRouter from "./storage";
import { initializeAccountDeletion, preventDeletedAccountWrites, completeAccountDeletion, storedMediaPath } from "../lib/accountDeletion";

const app = express();
app.use(express.json());
app.use(preventDeletedAccountWrites, deletionRouter, storageRouter);
app.post("/private-write", (_req, res) => res.json({ ok: true }));
const fixtureUsers: string[] = [];
const fixtureStores: number[] = [];

function identity() {
  const id = `deletion_fixture_${randomUUID()}`;
  fixtureUsers.push(id);
  mocks.userId = id;
  mocks.getUser.mockResolvedValue({ primaryEmailAddressId: "email_fixture", emailAddresses: [{ id: "email_fixture", emailAddress: "deletion-test@example.com" }] });
  mocks.deleteUser.mockResolvedValue({});
  mocks.sendMail.mockResolvedValue(undefined);
  mocks.getFile.mockResolvedValue({ delete: mocks.deleteFile });
  mocks.deleteFile.mockResolvedValue(undefined);
  mocks.getPolicy.mockResolvedValue(undefined);
  return id;
}

async function store(ownerUserId: string, imageUrl: string | null = null) {
  const [row] = await db.insert(storesTable).values({
    ownerUserId, ownerName: "Deletion fixture", name: `Deletion fixture ${randomUUID()}`,
    description: "Test-only data", category: "Test", location: "Test", phone: "0000000000", imageUrl,
    autoPayEnabled: true, paystackAuthCode: "fixture-not-a-real-authorization",
  }).returning();
  fixtureStores.push(row.id);
  return row;
}

beforeAll(initializeAccountDeletion);
afterAll(() => pool.end());
afterEach(async () => {
  if (fixtureStores.length) await db.delete(storesTable).where(inArray(storesTable.id, fixtureStores.splice(0)));
  if (fixtureUsers.length) {
    const ids = fixtureUsers.splice(0);
    await db.delete(conversationsTable).where(inArray(conversationsTable.customerId, ids));
    await db.delete(reviewsTable).where(inArray(reviewsTable.reviewerId, ids));
    await db.delete(pushTokensTable).where(inArray(pushTokensTable.userId, ids));
    await db.delete(supportMessagesTable).where(inArray(supportMessagesTable.userId, ids));
    await db.delete(mediaUploadsTable).where(inArray(mediaUploadsTable.userId, ids));
    await db.delete(accountDeletionsTable).where(inArray(accountDeletionsTable.userId, ids));
  }
  mocks.userId = null;
  vi.clearAllMocks();
});

describe("authenticated account deletion", () => {
  it("removes the deleted person's copied quote from a surviving legacy thread without deleting another person's reply", async () => {
    const deletedUser = identity();
    const currentOwner = `deletion_fixture_owner_${randomUUID()}`;
    const customer = `deletion_fixture_customer_${randomUUID()}`;
    fixtureUsers.push(currentOwner, customer);
    const currentStore = await store(currentOwner);
    const [thread] = await db.insert(conversationsTable).values({
      customerId: customer, customerName: "Customer", storeId: currentStore.id,
    }).returning();
    const [original] = await db.insert(messagesTable).values({
      conversationId: thread.id, senderId: deletedUser, senderName: "Former owner",
      senderType: "retailer", body: "Private original",
    }).returning();
    const [reply] = await db.insert(messagesTable).values({
      conversationId: thread.id, senderId: customer, senderName: "Customer",
      senderType: "customer", body: "Keep my own response",
      replyToMessageId: original.id,
      replyPreview: {
        id: original.id, senderId: deletedUser, senderName: "Former owner",
        body: "Private original", mediaUrl: null,
      },
    }).returning();
    const response = await request(app).delete("/account").send({ confirmation: "DELETE" });
    expect(response.status).toBe(200);
    const [remaining] = await db.select().from(messagesTable).where(eq(messagesTable.id, reply.id));
    expect(remaining).toMatchObject({
      body: "Keep my own response", replyToMessageId: null, replyPreview: null,
    });
    expect(await db.select().from(messagesTable).where(eq(messagesTable.id, original.id))).toHaveLength(0);
  });

  it("requires authentication and explicit confirmation", async () => {
    mocks.userId = null;
    expect((await request(app).delete("/account").send({ confirmation: "DELETE" })).status).toBe(401);
    identity();
    expect((await request(app).delete("/account").send({ confirmation: "yes" })).status).toBe(400);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes only the authenticated user's data and recalculates other stores' ratings", async () => {
    const userId = identity();
    const otherUserId = `deletion_fixture_other_${randomUUID()}`;
    fixtureUsers.push(otherUserId);
    const own = await store(userId);
    const other = await store(otherUserId);
    const otherFollower = `follow_fixture_${randomUUID()}`;
    await db.insert(storeFollowsTable).values([
      { userId, storeId: other.id },
      { userId: otherFollower, storeId: other.id },
    ]);
    await db.insert(productsTable).values({ storeId: own.id, name: "Fixture product", description: "Fixture", price: 10, category: "Test" });
    const [chat] = await db.insert(conversationsTable).values({ customerId: userId, customerName: "Fixture", storeId: other.id }).returning();
    await db.insert(messagesTable).values({ conversationId: chat.id, senderId: userId, senderName: "Fixture", senderType: "customer", body: "Fixture" });
    await db.insert(reviewsTable).values([
      { storeId: other.id, reviewerId: userId, reviewerName: "Fixture", rating: 5, comment: "Fixture" },
      { storeId: other.id, reviewerId: otherUserId, reviewerName: "Other fixture", rating: 3, comment: "Fixture" },
    ]);
    await db.insert(pushTokensTable).values({ userId, token: `fixture-${randomUUID()}` });
    await db.insert(supportMessagesTable).values({ userId, userName: "Fixture", senderRole: "user", body: "Fixture" });
    const response = await request(app).delete("/account").send({ confirmation: "DELETE", userId: otherUserId });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("deleted");
    expect(mocks.deleteUser).toHaveBeenCalledWith(userId);
    expect(await db.select().from(storeFollowsTable).where(eq(storeFollowsTable.userId, userId))).toHaveLength(0);
    expect(await db.select().from(storeFollowsTable).where(eq(storeFollowsTable.userId, otherFollower))).toHaveLength(1);
    expect(await db.select().from(storesTable).where(eq(storesTable.id, own.id))).toHaveLength(0);
    const [remaining] = await db.select().from(storesTable).where(eq(storesTable.id, other.id));
    expect(remaining.totalReviews).toBe(1);
    expect(remaining.avgRating).toBe(3);
    expect(await db.select().from(conversationsTable).where(eq(conversationsTable.id, chat.id))).toHaveLength(0);
    expect(await db.select().from(pushTokensTable).where(eq(pushTokensTable.userId, userId))).toHaveLength(0);
    expect(await db.select().from(supportMessagesTable).where(eq(supportMessagesTable.userId, userId))).toHaveLength(0);
    expect((await request(app).post("/private-write").send({})).status).toBe(403);
    expect(mocks.sendMail).toHaveBeenCalledOnce();
  });

  it("durably retries identity-provider failures instead of claiming completion", async () => {
    const userId = identity();
    const own = await store(userId);
    mocks.deleteUser.mockRejectedValueOnce(new Error("Provider unavailable"));
    const response = await request(app).delete("/account").send({ confirmation: "DELETE" });
    expect(response.status).toBe(202);
    expect(response.body.status).toBe("pending");
    expect(await db.select().from(storesTable).where(eq(storesTable.id, own.id))).toHaveLength(0);
    expect((await request(app).post("/private-write")).status).toBe(403);
    expect(await completeAccountDeletion(userId)).toBe(true);
  });

  it("safely deletes registered uploads but never deletes unverified legacy media", async () => {
    const userId = identity();
    const path = `/objects/uploads/${randomUUID()}`;
    await store(userId, `https://example.com/api/storage${path}`);
    await db.insert(mediaUploadsTable).values({ path, userId, createdAt: new Date(Date.now() - 20 * 60000) });
    expect(await completeAfterRequest()).toBe("deleted");
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
    const legacyUser = identity();
    await store(legacyUser, `/objects/uploads/${randomUUID()}`);
    expect(await completeAfterRequest()).toBe("pending");
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
    expect(mocks.deleteUser).toHaveBeenCalledWith(legacyUser);
  });

  it("does not accept bucket traversal or arbitrary file namespaces", () => {
    expect(storedMediaPath("/objects/../../private")).toBeNull();
    expect(storedMediaPath("/objects/secret-key")).toBeNull();
  });
  it("preserves other uploaders' files and excludes incoming chat media", async () => {
    const userId = identity();
    const otherUserId = `deletion_fixture_other_${randomUUID()}`;
    fixtureUsers.push(otherUserId);
    const sharedPath = `/objects/uploads/${randomUUID()}`;
    const own = await store(userId, sharedPath);
    await db.insert(mediaUploadsTable).values({ path: sharedPath, userId: otherUserId, createdAt: new Date(Date.now() - 20 * 60000) });
    const [chat] = await db.insert(conversationsTable).values({ customerId: otherUserId, customerName: "Fixture", storeId: own.id }).returning();
    await db.insert(messagesTable).values({
      conversationId: chat.id, senderId: otherUserId, senderName: "Other fixture", senderType: "customer", body: "",
      mediaUrl: `/objects/uploads/${randomUUID()}`, mediaType: "image",
    });
    expect(await completeAfterRequest()).toBe("deleted");
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(await db.select().from(mediaUploadsTable).where(eq(mediaUploadsTable.path, sharedPath))).toHaveLength(1);
  });
  it("does not issue an upload link if deletion starts while signing is in flight", async () => {
    const userId = identity();
    const path = `/objects/uploads/${randomUUID()}`;
    mocks.normalize.mockReturnValue(path);
    mocks.getUpload.mockImplementationOnce(async () => {
      await db.insert(accountDeletionsTable).values({ userId });
      return "https://storage.example.com/fixture-upload";
    });
    const response = await request(app).post("/storage/uploads/request-url")
      .send({ name: "fixture.png", size: 100, contentType: "image/png" });
    expect(response.status).toBe(403);
    expect(response.body.uploadURL).toBeUndefined();
    expect(await db.select().from(mediaUploadsTable).where(eq(mediaUploadsTable.path, path))).toHaveLength(0);
  });
});

async function completeAfterRequest() {
  const response = await request(app).delete("/account").send({ confirmation: "DELETE" });
  expect([200, 202]).toContain(response.status);
  return response.body.status;
}
