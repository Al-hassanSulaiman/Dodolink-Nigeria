import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import { db, storesTable, storeFollowsTable, accountDeletionsTable } from "@workspace/db";
import { requireUser } from "../lib/auth";
import { isStoreHidden } from "../lib/storeSubscription";
import { rateLimit } from "../lib/rateLimit";
import { ACCOUNT_DELETION_LOCK_NAMESPACE } from "../lib/accountDeletion";

const router: IRouter = Router();
const followLimit = rateLimit({ name: "store-follow", max: 60, windowMs: 60000 });
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
export default router;
