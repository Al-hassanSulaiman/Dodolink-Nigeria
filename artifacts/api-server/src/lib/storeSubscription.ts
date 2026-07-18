import { eq, count, gte, or, isNull, and } from "drizzle-orm";
import { db, storesTable, reviewsTable, conversationsTable, pushTokensTable } from "@workspace/db";
import { notifyTokens } from "./push";

export const ENGAGEMENT_THRESHOLD = 7;
export const GRACE_PERIOD_DAYS = 14;

const QUALIFICATION_PUSH_TITLE = "Important Notice";
const QUALIFICATION_PUSH_BODY =
  "Dear Valued Retailer, your store has reached the qualifying threshold. " +
  "Starting in 14 days, a monthly subscription fee of ₦5,000 will apply. " +
  "This helps us maintain a secure, reliable marketplace for your business. " +
  "Warm regards, Al-Hassan Sulaiman — Founder & CEO, DodoLink.";

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
      ownerUserId: storesTable.ownerUserId,
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

    // Send push notification to all devices registered by the store owner
    const tokens = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, store.ownerUserId));

    await notifyTokens(
      tokens.map((t) => t.token),
      QUALIFICATION_PUSH_TITLE,
      QUALIFICATION_PUSH_BODY,
      { type: "subscription_qualified", storeId }
    );
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
    // Initial grace period only (inactive = never paid): 14 days from qualifiedAt
    and(
      eq(storesTable.subscriptionStatus, "inactive"),
      gte(storesTable.qualifiedAt, graceDeadline)
    )
    // past_due = missed renewal → hidden immediately, no grace
  );
}

/** Returns true when a store should be hidden from public view. */
export function isStoreHidden(store: StoreVisibilityFields): boolean {
  if (!store.qualifiedAt) return false;
  if (store.subscriptionStatus === "active") return false;
  // Missed renewal: hidden immediately
  if (store.subscriptionStatus === "past_due") return true;
  // Initial qualification (inactive, never paid): 14-day grace from qualifiedAt
  const graceDeadline = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return store.qualifiedAt < graceDeadline;
}

/** Returns days left in initial grace period (null if not qualified, active, or past_due). */
export function gracePeriodDaysRemaining(store: StoreVisibilityFields): number | null {
  if (!store.qualifiedAt) return null;
  if (store.subscriptionStatus === "active") return null;
  // Missed renewal — no grace, already hidden
  if (store.subscriptionStatus === "past_due") return null;
  // Initial qualification only
  const expiresAt = new Date(store.qualifiedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const msLeft = expiresAt.getTime() - Date.now();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / (24 * 60 * 60 * 1000));
}
