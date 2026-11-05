import { Router, type IRouter } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, storesTable, storeFollowsTable, accountDeletionsTable } from "@workspace/db";
import { requireUser } from "../lib/auth";
import { isStoreHidden, visibleStoresFilter } from "../lib/storeSubscription";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/rateLimit";
import { ACCOUNT_DELETION_LOCK_NAMESPACE } from "../lib/accountDeletion";

const router: IRouter = Router();
const followLimit = rateLimit({ name: "store-follow", max: 60, windowMs: 60000 });
const listLimit = rateLimit({ name: "follow-lists", max: 120, windowMs: 60000 });
async function status(storeId: number, userId: string | null) {
  const [counts] = await db.select({ count: sql<number>`count(*)::integer` })
    .from(storeFollowsTable).where(eq(storeFollowsTable.storeId, storeId));
  const own = userId ? await db.select({ id: storeFollowsTable.storeId }).from(storeFollowsTable)
    .where(and(eq(storeFollowsTable.storeId, storeId), eq(storeFollowsTable.userId, userId))) : [];
  return { storeId, followerCount: counts.count, isFollowing: own.length > 0 };
}
router.all("/stores/:storeId/follow", followLimit, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["GET", "PUT", "DELETE"].includes(req.method)) { res.sendStatus(405); return; }
  const id = Number(req.params.storeId);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) { res.status(400).json({ error: "Invalid store" }); return; }
  const userId = req.method === "GET" ? getAuth(req).userId : requireUser(req, res);
  if (req.method !== "GET" && !userId) return;
  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, id));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  if (req.method !== "DELETE" && isStoreHidden(store) && userId !== store.ownerUserId) {
    res.status(404).json({ error: "Store not found" }); return;
  }
  if (req.method === "PUT" && store.ownerUserId === userId) {
    res.status(400).json({ error: "You cannot follow your own store" }); return;
  }
  if (req.method !== "GET") {
    const allowed = await db.transaction(async tx => {
      // Serialize with account deletion: a follow must not reappear after cleanup.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ACCOUNT_DELETION_LOCK_NAMESPACE}, hashtext(${userId!}))`);
      const [deleting] = await tx.select({ id: accountDeletionsTable.userId })
        .from(accountDeletionsTable).where(eq(accountDeletionsTable.userId, userId!));
      if (deleting) return false;
      if (req.method === "PUT") {
        await tx.insert(storeFollowsTable).values({ userId: userId!, storeId: id }).onConflictDoNothing();
      } else {
        await tx.delete(storeFollowsTable).where(and(eq(storeFollowsTable.userId, userId!), eq(storeFollowsTable.storeId, id)));
      }
      return true;
    });
    if (!allowed) { res.status(403).json({ error: "Account deletion is in progress" }); return; }
  }
  res.json(await status(id, userId ?? null));
});

// ---------------------------------------------------------------------------
// Instagram-style lists: who follows a store, and which stores a user follows.
// Read-only and additive. Signed-in users only. Never exposes email addresses
// or account IDs: a follower is shown by store name (if they own one) or by the
// name on their account.
// ---------------------------------------------------------------------------
function pageParams(req: { query: Record<string, unknown> }) {
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? "30"), 10) || 30));
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
  return { limit, offset };
}

type PublicProfile = { name: string; imageUrl: string | null; storeId: number | null };

async function publicProfiles(userIds: string[]): Promise<Map<string, PublicProfile>> {
  const profiles = new Map<string, PublicProfile>();
  if (userIds.length === 0) return profiles;
  const owned = await db.select({
    id: storesTable.id, ownerUserId: storesTable.ownerUserId, name: storesTable.name, imageUrl: storesTable.imageUrl,
  }).from(storesTable).where(and(inArray(storesTable.ownerUserId, userIds), visibleStoresFilter())).orderBy(storesTable.id);
  for (const store of owned) {
    if (!profiles.has(store.ownerUserId)) {
      profiles.set(store.ownerUserId, { name: store.name, imageUrl: store.imageUrl ?? null, storeId: store.id });
    }
  }
  const remaining = userIds.filter(id => !profiles.has(id));
  if (remaining.length > 0) {
    try {
      const users = await clerkClient.users.getUserList({ userId: remaining, limit: remaining.length });
      for (const user of users.data) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || "Dodolink user";
        profiles.set(user.id, { name, imageUrl: user.imageUrl || null, storeId: null });
      }
    } catch (err) {
      logger.warn({ err }, "Could not load follower names from Clerk");
    }
  }
  for (const id of userIds) {
    if (!profiles.has(id)) profiles.set(id, { name: "Dodolink user", imageUrl: null, storeId: null });
  }
  return profiles;
}

async function followedStores(userId: string, limit: number, offset: number) {
  const where = and(eq(storeFollowsTable.userId, userId), visibleStoresFilter(userId));
  const [{ count }] = await db.select({ count: sql<number>`count(*)::integer` })
    .from(storeFollowsTable).innerJoin(storesTable, eq(storesTable.id, storeFollowsTable.storeId)).where(where);
  const rows = await db.select({
    id: storesTable.id, name: storesTable.name, category: storesTable.category,
    imageUrl: storesTable.imageUrl, verificationStatus: storesTable.verificationStatus,
  }).from(storeFollowsTable).innerJoin(storesTable, eq(storesTable.id, storeFollowsTable.storeId))
    .where(where).orderBy(desc(storeFollowsTable.createdAt), desc(storesTable.id)).limit(limit).offset(offset);
  return { total: count, items: rows, nextOffset: offset + rows.length < count ? offset + rows.length : null };
}

function parseStoreId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 && id <= 2147483647 ? id : null;
}

router.get("/stores/:storeId/followers", listLimit, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = parseStoreId(String(req.params.storeId));
  if (id === null) { res.status(400).json({ error: "Invalid store" }); return; }
  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, id));
  if (!store || (isStoreHidden(store) && store.ownerUserId !== userId)) { res.status(404).json({ error: "Store not found" }); return; }
  const { limit, offset } = pageParams(req);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::integer` })
    .from(storeFollowsTable).where(eq(storeFollowsTable.storeId, id));
  const rows = await db.select({ userId: storeFollowsTable.userId }).from(storeFollowsTable)
    .where(eq(storeFollowsTable.storeId, id)).orderBy(desc(storeFollowsTable.createdAt), storeFollowsTable.userId)
    .limit(limit).offset(offset);
  const profiles = await publicProfiles(rows.map(row => row.userId));
  const items = rows.map(row => profiles.get(row.userId)!);
  res.json({ total: count, items, nextOffset: offset + rows.length < count ? offset + rows.length : null });
});

router.get("/stores/:storeId/following", listLimit, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = parseStoreId(String(req.params.storeId));
  if (id === null) { res.status(400).json({ error: "Invalid store" }); return; }
  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, id));
  if (!store || (isStoreHidden(store) && store.ownerUserId !== userId)) { res.status(404).json({ error: "Store not found" }); return; }
  const { limit, offset } = pageParams(req);
  res.json(await followedStores(store.ownerUserId, limit, offset));
});

router.get("/me/following", listLimit, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  const userId = requireUser(req, res);
  if (!userId) return;
  const { limit, offset } = pageParams(req);
  res.json(await followedStores(userId, limit, offset));
});
export default router;
