import type { RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db, bannedUsersTable, userBlocksTable, storesTable, deliveryAgentsTable } from "@workspace/db";

// ---- Removed (banned) people ----
const BAN_CACHE_MS = 30_000;
let banCache: { ids: Set<string>; expiresAt: number } | null = null;

export function invalidateBanCache(): void { banCache = null; }

async function bannedIds(): Promise<Set<string>> {
  if (banCache && banCache.expiresAt > Date.now()) return banCache.ids;
  const rows = await db.select({ id: bannedUsersTable.userId }).from(bannedUsersTable);
  banCache = { ids: new Set(rows.map(r => r.id)), expiresAt: Date.now() + BAN_CACHE_MS };
  return banCache.ids;
}

/** Removed people cannot use the app at all (except to delete their own account). */
export const preventBannedUsers: RequestHandler = async (req, res, next) => {
  try {
    const { userId } = getAuth(req);
    if (!userId || (req.method === "DELETE" && req.path === "/account")) { next(); return; }
    if ((await bannedIds()).has(userId)) {
      res.status(403).json({ error: "This account has been removed for breaking the Dodolink NG rules." });
      return;
    }
    next();
  } catch (err) { next(err); }
};

// ---- Blocking ----

/** SQL: the store's owner is not someone the viewer has blocked. */
export function notBlockedByViewer(viewerId: string) {
  return sql`${storesTable.ownerUserId} NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ${viewerId})`;
}

/** Everyone who is blocked by this person or has blocked this person. */
export async function blockedEitherWay(userId: string): Promise<Set<string>> {
  const rows = await db.select().from(userBlocksTable)
    .where(sql`${userBlocksTable.blockerId} = ${userId} OR ${userBlocksTable.blockedId} = ${userId}`);
  return new Set(rows.map(r => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const rows = await db.select({ id: userBlocksTable.id }).from(userBlocksTable)
    .where(sql`(${userBlocksTable.blockerId} = ${a} AND ${userBlocksTable.blockedId} = ${b})
      OR (${userBlocksTable.blockerId} = ${b} AND ${userBlocksTable.blockedId} = ${a})`).limit(1);
  return rows.length > 0;
}

/** The person behind a store id or a delivery company id. */
export async function storeOwnerId(storeId: number): Promise<string | null> {
  const [s] = await db.select({ owner: storesTable.ownerUserId }).from(storesTable).where(eq(storesTable.id, storeId));
  return s?.owner ?? null;
}
export async function deliveryCompanyUserId(agentId: number): Promise<string | null> {
  const [a] = await db.select({ u: deliveryAgentsTable.linkedUserId }).from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, agentId));
  return a?.u ?? null;
}
