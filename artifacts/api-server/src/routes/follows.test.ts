import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool, storesTable, productsTable, storeFollowsTable, accountDeletionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: auth.userId }) }));
vi.mock("../lib/accountDeletion", () => ({ ACCOUNT_DELETION_LOCK_NAMESPACE: 4243 }));
import follows from "./follows";
import feed from "./home-feed";
const app = express();
app.use(express.json(), follows, feed);
let user: string;
let ids: number[] = [];
beforeEach(() => { user = `follow_qa_${randomUUID()}`; auth.userId = user; });
afterEach(async () => {
  if (ids.length) await db.delete(storesTable).where(inArray(storesTable.id, ids));
  await db.delete(accountDeletionsTable).where(eq(accountDeletionsTable.userId, user));
  ids = [];
});
afterAll(() => pool.end());
async function store(owner = `owner_${randomUUID()}`, hiddenByAdmin = false) {
  const [s] = await db.insert(storesTable).values({
    ownerUserId: owner, ownerName: "QA", name: `QA Follow ${randomUUID()}`,
    description: "Disposable follow test", category: "QA", location: "QA", phone: "0000000000", hiddenByAdmin,
  }).returning();
  ids.push(s.id);
  return s;
}
describe("store following and personalized Home", () => {
  it("requires authentication, rejects self-follow and makes repeated follows/unfollows idempotent", async () => {
    const s = await store();
    auth.userId = null;
    expect((await request(app).put(`/stores/${s.id}/follow`)).status).toBe(401);
    expect((await request(app).get(`/stores/${s.id}/follow`)).body).toMatchObject({ isFollowing: false, followerCount: 0 });
    auth.userId = user;
    for (let i = 0; i < 2; i++) {
      expect((await request(app).put(`/stores/${s.id}/follow`).send({ userId: "forged-user" })).body)
        .toMatchObject({ isFollowing: true, followerCount: 1 });
    }
    const rows = await db.select().from(storeFollowsTable).where(eq(storeFollowsTable.storeId, s.id));
    expect(rows.map(r => r.userId)).toEqual([user]);
    for (let i = 0; i < 2; i++) {
      expect((await request(app).delete(`/stores/${s.id}/follow`)).body)
        .toMatchObject({ isFollowing: false, followerCount: 0 });
    }
    const own = await store(user);
    expect((await request(app).put(`/stores/${own.id}/follow`)).status).toBe(400);
  });
  it("keeps users isolated and rejects hidden stores and malformed identifiers", async () => {
    const s = await store();
    await request(app).put(`/stores/${s.id}/follow`);
    auth.userId = `other_${randomUUID()}`;
    expect((await request(app).get(`/stores/${s.id}/follow`)).body).toMatchObject({ isFollowing: false, followerCount: 1 });
    const hidden = await store(undefined, true);
    expect((await request(app).put(`/stores/${hidden.id}/follow`)).status).toBe(404);
    for (const id of ["1.5", "no", "2147483648"]) {
      expect((await request(app).put(`/stores/${id}/follow`)).status).toBe(400);
    }
  });
  it("blocks a deleting account from recreating follows and cascades deleted stores", async () => {
    const s = await store();
    await db.insert(accountDeletionsTable).values({ userId: user });
    expect((await request(app).put(`/stores/${s.id}/follow`)).status).toBe(403);
    await db.delete(accountDeletionsTable).where(eq(accountDeletionsTable.userId, user));
    await request(app).put(`/stores/${s.id}/follow`);
    await db.delete(storesTable).where(eq(storesTable.id, s.id));
    expect(await db.select().from(storeFollowsTable).where(eq(storeFollowsTable.storeId, s.id))).toHaveLength(0);
  });
  it("prioritizes followed inventory, mixes discovery, paginates beyond six, rotates and never exposes hidden inventory", async () => {
    const a = await store(); const b = await store(); const discovery = await store(); const hidden = await store(undefined, true);
    await db.insert(storeFollowsTable).values([{ userId: user, storeId: a.id }, { userId: user, storeId: b.id }]);
    for (const s of [a, b, discovery, hidden]) {
      await db.insert(productsTable).values(Array.from({ length: 12 }, (_, i) => ({
        storeId: s.id, name: `QA ${i}`, description: "QA", category: "QA", price: 100,
      })));
    }
    const first = await request(app).get("/home/products?seed=one&limit=20");
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.body.items).toHaveLength(20);
    expect(first.body.items.filter((p: { isFollowing: boolean }) => p.isFollowing)).toHaveLength(16);
    expect(first.body.items.some((p: { storeId: number }) => p.storeId === hidden.id)).toBe(false);
    expect(new Set(first.body.items.slice(0, 2).map((p: { storeId: number }) => p.storeId)).size).toBe(2);
    const second = await request(app).get(`/home/products?seed=one&limit=20&offset=${first.body.nextOffset}`);
    const firstIds = new Set(first.body.items.map((p: { id: number }) => p.id));
    expect(second.body.items.every((p: { id: number }) => !firstIds.has(p.id))).toBe(true);
    expect((await request(app).get("/home/products?seed=one&limit=20")).body).toEqual(first.body);
    expect((await request(app).get("/home/products?seed=two&limit=20")).body.items.map((p: { id: number }) => p.id))
      .not.toEqual(first.body.items.map((p: { id: number }) => p.id));
    auth.userId = null;
    const guest = await request(app).get("/home/products?seed=one&limit=20");
    expect(guest.body.items.every((p: { isFollowing: boolean }) => !p.isFollowing)).toBe(true);
    expect(guest.body.items.length).toBeGreaterThan(6);
  });
  it("loads more than five circles without private payment fields and validates pagination", async () => {
    for (let i = 0; i < 8; i++) {
      const s = await store();
      await db.insert(storeFollowsTable).values({ userId: user, storeId: s.id });
    }
    const response = await request(app).get("/home/stores?seed=circles&limit=6");
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBe(6);
    expect(response.body.nextOffset).toBe(6);
    expect(Object.keys(response.body.items[0]).sort()).toEqual(["followerCount", "id", "imageUrl", "isFollowing", "name"]);
    expect((await request(app).get("/home/stores?seed=circles&limit=6&offset=6")).body.items.length).toBeGreaterThan(0);
    for (const query of ["limit=100", "offset=-1", "offset=0.5", "limit=NaN"]) {
      expect((await request(app).get(`/home/products?${query}`)).status).toBe(400);
    }
  });
});
