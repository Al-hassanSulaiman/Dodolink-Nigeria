import { eq, count, gte, or, isNull } from "drizzle-orm";
import { db, storesTable, reviewsTable, conversationsTable } from "@workspace/db";

export const ENGAGEMENT_THRESHOLD = 7;
export const GRACE_PERIOD_DAYS = 14;

export async function getEngagementCount(storeId: number): Promise<number> {
  const [revResult] = await db
    .select({ count: count() })
    .from(reviewsTable)
    .where(eq(reviewsTable.storeId, storeId));
  const [convResult] = await db
    .select({ count: count() })
    .from(conversationsTable)
    .where(eq(conversationsTable.storeId, storeId));
  return (revResult?.count ?? 0) + (convResult?.count ?? 0);
}

/** Set qualifiedAt once when a verified store first reaches the engagement threshold. */
export async function checkAndSetQualifiedAt(storeId: number): Promise<void> {
  const [store] = await db
    .select({
      qualifiedAt: storesTable.qualifiedAt,
      verificationStatus: storesTable.verificationStatus,
    })
    .from(storesTable)
    .where(eq(storesTable.id, storeId));

  if (!store || store.qualifiedAt || store.verificationStatus !== "verified") return;

  const engagementCount = await getEngagementCount(storeId);
  if (engagementCount >= ENGAGEMENT_THRESHOLD) {
    await db
      .update(storesTable)
      .set({ qualifiedAt: new Date() })
      .where(eq(storesTable.id, storeId));
  }
}

/** Drizzle OR-condition: store is publicly visible. */
export function visibleStoresFilter() {
  const graceDeadline = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return or(
    isNull(storesTable.qualifiedAt),
    eq(storesTable.subscriptionStatus, "active"),
    gte(storesTable.qualifiedAt, graceDeadline)
  );
}

/** Returns true when a store should be hidden from public view. */
export function isStoreHidden(store: {
  qualifiedAt: Date | null;
  subscriptionStatus: string;
}): boolean {
  if (!store.qualifiedAt) return false;
  if (store.subscriptionStatus === "active") return false;
  const graceDeadline = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return store.qualifiedAt < graceDeadline;
}

/** Returns days left in grace period (null if not qualified or subscription is active). */
export function gracePeriodDaysRemaining(store: {
  qualifiedAt: Date | null;
  subscriptionStatus: string;
}): number | null {
  if (!store.qualifiedAt || store.subscriptionStatus === "active") return null;
  const expiresAt = new Date(
    store.qualifiedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );
  const msLeft = expiresAt.getTime() - Date.now();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / (24 * 60 * 60 * 1000));
}
