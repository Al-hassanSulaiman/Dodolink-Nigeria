import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db, storesTable, subscriptionPaymentsTable, pushTokensTable } from "@workspace/db";
import { paystackChargeAuthorization, paystackVerify } from "./paystack";
import { getEngagementCount, getSubscriptionAmountKobo, isPaymentsLive } from "./storeSubscription";
import { notifyTokens } from "./push";
import { logger } from "./logger";

export const SUBSCRIPTION_DAYS = 30;

/**
 * Namespace for our Postgres advisory locks so a store id can never collide
 * with a lock taken by unrelated code using the same numeric key.
 */
const SUBSCRIPTION_LOCK_NAMESPACE = 4242;

/**
 * Runs `fn` while holding a Postgres transaction-scoped advisory lock keyed on
 * the store. This is the per-store in-progress gate for charging: two
 * concurrent charge attempts for the same store serialize here, so only one
 * can be reconciling/reserving/charging at a time. The lock is released
 * automatically when the surrounding transaction commits or rolls back.
 *
 * **Why:** A unique `reference` alone is per-attempt, not per-store, so two
 * requests could each mint a distinct reference and both call Paystack. The
 * advisory lock makes "one charge in flight per store" an atomic guarantee.
 */
export async function withStoreChargeLock<T>(
  storeId: number,
  fn: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${SUBSCRIPTION_LOCK_NAMESPACE}, ${storeId})`,
    );
    return fn();
  });
}

/** A pending (unconsumed) charge attempt whose remote outcome is unknown. */
export type ReconcileResult =
  | { kind: "settled" }        // verified success — subscription should be active
  | { kind: "resolved" }       // definitively not charged — safe to proceed/retry
  | { kind: "inconclusive" };  // still unknown — do NOT charge again yet

/** True when a verify error means "transaction not found" (never reached Paystack). */
export function isNotFoundError(err: unknown): boolean {
  return /not found|404/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * Reconcile a single pending attempt by asking Paystack the true outcome of
 * its reference. On definitive success, activates the store and consumes the
 * quote. On definitive non-charge, deletes the pending row. When verification
 * is itself inconclusive (transient), leaves the row intact and reports so —
 * the caller must NOT start a new charge.
 */
export async function reconcilePendingAttempt(
  storeId: number,
  reference: string,
): Promise<ReconcileResult> {
  try {
    const verified = await paystackVerify(reference);
    if (verified.status === "success") {
      await activateStoreForReference(storeId, reference);
      return { kind: "settled" };
    }
    // Definitive non-success (failed/abandoned): resolve the row.
    await db.delete(subscriptionPaymentsTable).where(eq(subscriptionPaymentsTable.reference, reference));
    return { kind: "resolved" };
  } catch (err) {
    if (isNotFoundError(err)) {
      await db.delete(subscriptionPaymentsTable).where(eq(subscriptionPaymentsTable.reference, reference));
      return { kind: "resolved" };
    }
    logger.warn({ err, storeId, reference }, "reconcile: verification inconclusive, keeping pending row");
    return { kind: "inconclusive" };
  }
}

/** Consume the quote row and activate the store, idempotently. */
export async function activateStoreForReference(storeId: number, reference: string): Promise<void> {
  const now = new Date();
  const dueAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptionPaymentsTable)
      .set({ consumedAt: now })
      .where(and(
        eq(subscriptionPaymentsTable.reference, reference),
        isNull(subscriptionPaymentsTable.consumedAt),
      ));
    await tx
      .update(storesTable)
      .set({ subscriptionStatus: "active", subscriptionLastPaidAt: now, subscriptionDueAt: dueAt })
      .where(eq(storesTable.id, storeId));
  });
}

export type ChargeStoreResult =
  | { kind: "charged" }         // a new successful charge activated the store
  | { kind: "already_active" }  // a prior settled attempt covered this window; no new charge
  | { kind: "declined"; reason: string }   // definitive non-success; store set past_due
  | { kind: "unconfirmed" };    // outcome unknown; pending row kept, no retry-safe claim

/**
 * The single, authoritative charging routine for BOTH the manual route and the
 * auto-charge worker. It always runs under the per-store advisory lock so every
 * Paystack charge for a given store is serialized — a manual request and the
 * auto worker can never charge the same store concurrently.
 *
 * Flow inside the lock:
 *  1. Reconcile any unconsumed pending attempt (manual OR auto) for this store.
 *     A settled one activates the store and short-circuits (no new charge). An
 *     inconclusive one aborts (never charge over an unknown-outcome attempt).
 *  2. Reserve `reference` (idempotent insert).
 *  3. Charge with a bounded timeout, then resolve the SAME reference —
 *     reconciling via verify on any ambiguous error.
 *
 * **Why:** a per-attempt unique reference is not a per-store gate. Serializing
 * every charge path on one lock is what actually prevents a double charge for a
 * single renewal window.
 */
export async function chargeStoreSubscription(params: {
  storeId: number;
  authCode: string;
  email: string;
  amountKobo: number;
  reference: string;
}): Promise<ChargeStoreResult> {
  const { storeId, authCode, email, amountKobo, reference } = params;

  return withStoreChargeLock(storeId, async (): Promise<ChargeStoreResult> => {
    // Step 1: reconcile ALL unconsumed attempts for this store (any prefix).
    const pending = await db
      .select()
      .from(subscriptionPaymentsTable)
      .where(and(
        eq(subscriptionPaymentsTable.storeId, storeId),
        isNull(subscriptionPaymentsTable.consumedAt),
      ));

    for (const row of pending) {
      // NOTE: this deliberately includes a pending row with OUR OWN reference
      // (a prior auto run that timed out on this same deterministic period
      // reference). Reconciling it either activates the store (settled),
      // clears it so we may retry (never reached Paystack), or blocks the
      // retry while the outcome is still unknown.
      const rec = await reconcilePendingAttempt(storeId, row.reference);
      if (rec.kind === "settled") return { kind: "already_active" };
      if (rec.kind === "inconclusive") return { kind: "unconfirmed" };
      // resolved → keep scanning
    }

    // Renewal-window guard: if the store is active with a due date comfortably
    // in the future, this window was already paid (possibly by the competing
    // path that just released the lock). Charging again would double-bill.
    const [current] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
    if (
      current?.subscriptionStatus === "active" &&
      current.subscriptionDueAt &&
      current.subscriptionDueAt.getTime() - Date.now() > 48 * 60 * 60 * 1000
    ) {
      return { kind: "already_active" };
    }

    // Step 2: reserve this attempt (idempotent).
    await db
      .insert(subscriptionPaymentsTable)
      .values({ reference, storeId, quotedAmountKobo: amountKobo })
      .onConflictDoNothing({ target: subscriptionPaymentsTable.reference });

    // Step 3: charge and resolve the SAME reference.
    try {
      const result = await paystackChargeAuthorization(authCode, email, amountKobo, reference);
      if (result.status === "success") {
        await activateStoreForReference(storeId, reference);
        return { kind: "charged" };
      }
      // Definitive non-success: release reservation, mark past due.
      await db.delete(subscriptionPaymentsTable).where(eq(subscriptionPaymentsTable.reference, reference));
      await db.update(storesTable).set({ subscriptionStatus: "past_due" }).where(eq(storesTable.id, storeId));
      return { kind: "declined", reason: `status ${result.status}` };
    } catch (err) {
      const rec = await reconcilePendingAttempt(storeId, reference);
      if (rec.kind === "settled") return { kind: "charged" };
      if (rec.kind === "resolved") {
        await db.update(storesTable).set({ subscriptionStatus: "past_due" }).where(eq(storesTable.id, storeId));
        return { kind: "declined", reason: String(err) };
      }
      return { kind: "unconfirmed" };
    }
  });
}

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

    // Deterministic per-period reference: a second run for the same window
    // reuses it. chargeStoreSubscription reconciles any pending attempt (this
    // reference from a prior timed-out run included) BEFORE charging, so a
    // settled-but-unconfirmed auto charge is resolved instead of skipped.
    const reference = `dodolink_auto_${store.id}_${store.subscriptionDueAt.getTime()}`;
    const engagement = await getEngagementCount(store.id);
    const amountKobo = getSubscriptionAmountKobo(engagement);

    const result = await chargeStoreSubscription({
      storeId: store.id,
      authCode: store.paystackAuthCode,
      email: store.paystackEmail,
      amountKobo,
      reference,
    });

    switch (result.kind) {
      case "charged":
        logger.info({ storeId: store.id, amountKobo }, "Auto-charge: renewed subscription");
        break;
      case "already_active":
        logger.info({ storeId: store.id }, "Auto-charge: period already settled, skipping");
        break;
      case "declined":
        // chargeStoreSubscription already set past_due; just notify.
        await handleAutoChargeFailure(store.id, store.ownerUserId, result.reason);
        break;
      case "unconfirmed":
        logger.warn({ storeId: store.id, reference }, "Auto-charge: outcome unknown, pending kept for later reconciliation");
        break;
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
