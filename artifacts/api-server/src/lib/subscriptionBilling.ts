import { and, eq, isNull, lte } from "drizzle-orm";
import { db, storesTable, subscriptionPaymentsTable, pushTokensTable } from "@workspace/db";
import { paystackChargeAuthorization } from "./paystack";
import { getEngagementCount, getSubscriptionAmountKobo, isPaymentsLive } from "./storeSubscription";
import { notifyTokens } from "./push";
import { logger } from "./logger";

export const SUBSCRIPTION_DAYS = 30;

export type WebhookActivationResult =
  | "activated"
  | "already_used"
  | "amount_mismatch"
  | "unknown_reference";

/**
 * Activate a store's subscription from a verified Paystack transaction,
 * consuming the stored price quote atomically. Used by the webhook, where the
 * quote row is the source of truth for which store the payment belongs to.
 * Idempotent: an already-consumed reference is a no-op.
 */
export async function activateFromWebhook(params: {
  reference: string;
  amountKobo: number;
  currency?: string;
  authCode?: string | null;
  customerCode?: string | null;
}): Promise<WebhookActivationResult> {
  const { reference, amountKobo, currency, authCode, customerCode } = params;
  if (currency && currency !== "NGN") return "amount_mismatch";

  const now = new Date();
  const dueAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(subscriptionPaymentsTable)
      .where(eq(subscriptionPaymentsTable.reference, reference));
    if (!quote) return "unknown_reference" as const;
    if (amountKobo < quote.quotedAmountKobo) return "amount_mismatch" as const;

    // Atomic single-use consume — if /verify already handled this payment,
    // nothing happens here.
    const consumed = await tx
      .update(subscriptionPaymentsTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(subscriptionPaymentsTable.reference, reference),
          isNull(subscriptionPaymentsTable.consumedAt),
        ),
      )
      .returning();
    if (consumed.length === 0) return "already_used" as const;

    await tx
      .update(storesTable)
      .set({
        subscriptionStatus: "active",
        subscriptionLastPaidAt: now,
        subscriptionDueAt: dueAt,
        ...(authCode ? { paystackAuthCode: authCode } : {}),
        ...(customerCode ? { paystackCustomerCode: customerCode } : {}),
      })
      .where(eq(storesTable.id, quote.storeId));

    return "activated" as const;
  });
}

const AUTO_CHARGE_FAILED_TITLE = "Subscription Renewal Failed";
const AUTO_CHARGE_FAILED_BODY =
  "Dear Valued Retailer, we could not charge your saved card for this month's subscription. " +
  "Please open My Store → Subscription and renew manually to keep your store visible.";

/**
 * Charge saved cards for stores with auto-pay enabled whose subscription is
 * due within the next 24 hours (or already overdue).
 *
 * Idempotency: each billing period gets a deterministic reference
 * (`dodolink_auto_<storeId>_<dueAtMillis>`). A unique-constraint insert into
 * subscription_payments BEFORE calling Paystack guarantees that a crashed or
 * concurrent run can never charge the same period twice.
 */
export async function autoChargeDueSubscriptions(): Promise<void> {
  if (!isPaymentsLive()) return;

  const windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const stores = await db
    .select()
    .from(storesTable)
    .where(
      and(
        eq(storesTable.subscriptionStatus, "active"),
        eq(storesTable.autoPayEnabled, true),
        lte(storesTable.subscriptionDueAt, windowEnd),
      ),
    );

  if (stores.length === 0) {
    logger.info("Auto-charge: no auto-pay stores due within 24h");
    return;
  }

  for (const store of stores) {
    if (!store.paystackAuthCode || !store.paystackEmail || !store.subscriptionDueAt) continue;

    const reference = `dodolink_auto_${store.id}_${store.subscriptionDueAt.getTime()}`;
    const engagement = await getEngagementCount(store.id);
    const amountKobo = getSubscriptionAmountKobo(engagement);

    // Reserve this billing period before charging. The unique reference makes
    // this the idempotency gate: a second run (or second instance) hits the
    // conflict and skips.
    const reserved = await db
      .insert(subscriptionPaymentsTable)
      .values({ reference, storeId: store.id, quotedAmountKobo: amountKobo })
      .onConflictDoNothing({ target: subscriptionPaymentsTable.reference })
      .returning();
    if (reserved.length === 0) {
      logger.info({ storeId: store.id, reference }, "Auto-charge: period already attempted, skipping");
      continue;
    }

    try {
      const result = await paystackChargeAuthorization(
        store.paystackAuthCode,
        store.paystackEmail,
        amountKobo,
        reference,
      );

      const now = new Date();
      if (result.status === "success") {
        const dueAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
        await db.transaction(async (tx) => {
          await tx
            .update(subscriptionPaymentsTable)
            .set({ consumedAt: now })
            .where(eq(subscriptionPaymentsTable.reference, reference));
          await tx
            .update(storesTable)
            .set({
              subscriptionStatus: "active",
              subscriptionLastPaidAt: now,
              subscriptionDueAt: dueAt,
            })
            .where(eq(storesTable.id, store.id));
        });
        logger.info({ storeId: store.id, amountKobo }, "Auto-charge: renewed subscription");
      } else {
        await handleAutoChargeFailure(store.id, store.ownerUserId, `status ${result.status}`);
      }
    } catch (err) {
      await handleAutoChargeFailure(store.id, store.ownerUserId, String(err));
    }
  }
}

async function handleAutoChargeFailure(storeId: number, ownerUserId: string, reason: string): Promise<void> {
  logger.warn({ storeId, reason }, "Auto-charge: charge failed");
  await db
    .update(storesTable)
    .set({ subscriptionStatus: "past_due" })
    .where(eq(storesTable.id, storeId));
  try {
    const tokens = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, ownerUserId));
    await notifyTokens(
      tokens.map((t) => t.token),
      AUTO_CHARGE_FAILED_TITLE,
      AUTO_CHARGE_FAILED_BODY,
      { type: "subscription_charge_failed", storeId },
    );
  } catch (err) {
    logger.warn({ storeId, err }, "Auto-charge: failure notification could not be sent");
  }
}
