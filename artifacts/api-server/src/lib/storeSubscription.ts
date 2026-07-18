import { eq, count, gte, or, isNull, and } from "drizzle-orm";
import { db, storesTable, reviewsTable, conversationsTable, pushTokensTable } from "@workspace/db";
import { notifyTokens } from "./push";

export const ENGAGEMENT_THRESHOLD = 7;
export const GRACE_PERIOD_DAYS = 14;

/** Payments are disabled until this date. On this date they auto-enable. */
export const SUBSCRIPTION_LAUNCH_DATE = new Date("2027-01-01T00:00:00.000Z");

/** True when the subscription billing system is live. */
export function isPaymentsLive(): boolean {
  return Date.now() >= SUBSCRIPTION_LAUNCH_DATE.getTime();
}

/**
 * If a store qualified before the launch date, treat the grace period as
 * starting from the launch date so nobody gets immediately hidden on day 1.
 */
function effectiveQualifiedAt(qualifiedAt: Date): Date {
  return qualifiedAt < SUBSCRIPTION_LAUNCH_DATE ? SUBSCRIPTION_LAUNCH_DATE : qualifiedAt;
}

const QUALIFICATION_PUSH_TITLE = "Important Notice";
const QUALIFICATION_PUSH_BODY =
  "Dear Valued Retailer, your store has reached the qualifying threshold. " +
  "Starting in 14 days, a monthly subscription fee of ₦5,000 will apply. " +
  "This helps us maintain a secure, reliable marketplace for your business. " +
  "Warm regards, Al-Hassan Sulaiman — Founder & CEO, DodoLink.";

const ENGAGEMENT_WINDOW_DAYS = 30;

export async function getEngagementCount(storeId: number): Promise<number> {
  const windowStart = new Date(Date.now() - ENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [revResult] = await db
    .select({ count: count() })
    .from(reviewsTable)
    .where(and(eq(reviewsTable.storeId, storeId), gte(reviewsTable.createdAt, windowStart)));
  const [convResult] = await db
    .select({ count: count() })
    .from(conversationsTable)
    .where(and(eq(conversationsTable.storeId, storeId), gte(conversationsTable.createdAt, windowStart)));
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
  // Before launch date nothing is hidden — all stores visible
  if (!isPaymentsLive()) return or(isNull(storesTable.id), eq(storesTable.id, storesTable.id));

  const graceDeadline = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  // Adjust grace deadline to account for stores that qualified before launch
  const effectiveLaunchGraceDeadline = new Date(
    Math.max(SUBSCRIPTION_LAUNCH_DATE.getTime(), graceDeadline.getTime())
  );

  return or(
    isNull(storesTable.qualifiedAt),
    eq(storesTable.subscriptionStatus, "active"),
    and(
      eq(storesTable.subscriptionStatus, "inactive"),
      gte(storesTable.qualifiedAt, effectiveLaunchGraceDeadline)
    )
    // past_due = missed renewal → hidden immediately
  );
}

/** Returns true when a store should be hidden from public view. */
export function isStoreHidden(store: StoreVisibilityFields): boolean {
  // Before launch date nothing is hidden
  if (!isPaymentsLive()) return false;

  if (!store.qualifiedAt) return false;
  if (store.subscriptionStatus === "active") return false;
  if (store.subscriptionStatus === "past_due") return true;

  // Initial qualification (inactive): 14-day grace from effectiveQualifiedAt
  const effQualifiedAt = effectiveQualifiedAt(store.qualifiedAt);
  const graceDeadline = new Date(Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return effQualifiedAt < graceDeadline;
}

/** Returns days left in initial grace period (null if not qualified, active, or past_due). */
export function gracePeriodDaysRemaining(store: StoreVisibilityFields): number | null {
  if (!store.qualifiedAt) return null;
  if (store.subscriptionStatus === "active") return null;
  if (store.subscriptionStatus === "past_due") return null;

  // Use effectiveQualifiedAt so pre-launch retailers get 14 days from launch date
  const effQualifiedAt = effectiveQualifiedAt(store.qualifiedAt);
  const expiresAt = new Date(effQualifiedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const msLeft = expiresAt.getTime() - Date.now();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / (24 * 60 * 60 * 1000));
}
