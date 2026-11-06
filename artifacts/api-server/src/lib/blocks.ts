import { sql, type SQL } from "drizzle-orm";
import { db, storesTable, userBlocksTable } from "@workspace/db";

/**
 * SQL condition: the store's owner is not blocked by `userId` and has not
 * blocked `userId`. With no signed-in user nothing is hidden.
 */
export function notBlockedOwnerFilter(userId: string | null | undefined): SQL {
  if (!userId) return sql`true`;
  return sql`NOT EXISTS (
    SELECT 1 FROM ${userBlocksTable} b
    WHERE (b.blocker_id = ${userId} AND b.blocked_id = ${storesTable.ownerUserId})
       OR (b.blocked_id = ${userId} AND b.blocker_id = ${storesTable.ownerUserId})
  )`;
}

/** True when either person has blocked the other. */
export async function eitherBlocked(a: string, b: string): Promise<boolean> {
  const r = await db.execute(sql`SELECT 1 FROM ${userBlocksTable}
    WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a}) LIMIT 1`);
  return r.rows.length > 0;
}

/** Ids of everyone the user blocked or who blocked the user. */
export async function blockedWith(userId: string): Promise<Set<string>> {
  const r = await db.execute(sql`SELECT blocker_id, blocked_id FROM ${userBlocksTable}
    WHERE blocker_id = ${userId} OR blocked_id = ${userId}`);
  const out = new Set<string>();
  for (const row of r.rows as { blocker_id: string; blocked_id: string }[]) {
    out.add(row.blocker_id === userId ? row.blocked_id : row.blocker_id);
  }
  return out;
}

/** True when the other person in this store chat is blocked by, or has blocked, `userId`. */
export async function conversationBlocked(
  conversation: { customerId: string; storeId: number },
  userId: string,
): Promise<boolean> {
  let other: string | null | undefined = conversation.customerId;
  if (conversation.customerId === userId) {
    const [st] = await db.select({ owner: storesTable.ownerUserId }).from(storesTable)
      .where(sql`${storesTable.id} = ${conversation.storeId}`);
    other = st?.owner;
  }
  return !!other && (await eitherBlocked(userId, other));
}
