import { eq, count, gte, or, isNull, and, ne } from "drizzle-orm";
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

type StoreVisibilityFields = {
  qualifiedAt: Date | null;
  subscriptionStatus: string;
  subscriptionDueAt: Date | null;
};

/** Drizzle OR-condition: store is publicly visible. */
export function visibleStoresFilter() {
  const graceDeadline = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return or(
    // Not yet qualified — always visible
    isNull(storesTable.qualifiedAt),
    // Actively paying — always visible
    eq(storesTable.subscriptionStatus, "active"),
    // Initial grace period (inactive, never paid): 14 days from qualifiedAt
    and(
      eq(storesTable.subscriptionStatus, "inactive"),
      gte(storesTable.qualifiedAt, graceDeadline)
    ),
    // Recurring grace period (past_due): 14 days from subscriptionDueAt
    and(
      eq(storesTable.subscriptionStatus, "past_due"),
      gte(storesTable.subscriptionDueAt, graceDeadline)
    )
  );
}

/** Returns true when a store should be hidden from public view. */
export function isStoreHidden(store: StoreVisibilityFields): boolean {
  if (!store.qualifiedAt) return false;
  if (store.subscriptionStatus === "active") return false;

  const graceDeadline = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  if (store.subscriptionStatus === "past_due") {
    // Recurring missed payment: grace runs from subscriptionDueAt
    if (!store.subscriptionDueAt) return true;
    return store.subscriptionDueAt < graceDeadline;
  }

  // Initial qualification (inactive, never paid): grace runs from qualifiedAt
  return store.qualifiedAt < graceDeadline;
}

/** Returns days left in grace period (null if not qualified or subscription is active). */
export function gracePeriodDaysRemaining(store: StoreVisibilityFields): number | null {
  if (!store.qualifiedAt || store.subscriptionStatus === "active") return null;

  let graceStartsAt: Date;

  if (store.subscriptionStatus === "past_due") {
    // Recurring missed payment: grace runs from subscriptionDueAt
    if (!store.subscriptionDueAt) return 0;
    graceStartsAt = store.subscriptionDueAt;
  } else {
    // Initial qualification (inactive, never paid): grace runs from qualifiedAt
    graceStartsAt = store.qualifiedAt;
  }

  const expiresAt = new Date(graceStartsAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const msLeft = expiresAt.getTime() - Date.now();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / (24 * 60 * 60 * 1000));
}
