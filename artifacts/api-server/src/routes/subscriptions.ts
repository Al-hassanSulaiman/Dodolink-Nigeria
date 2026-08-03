import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, storesTable } from "@workspace/db";
import {
  InitializeSubscriptionBody,
  VerifySubscriptionBody,
  ToggleAutoPayBody,
} from "@workspace/api-zod";
import {
  paystackInitialize,
  paystackVerify,
  paystackChargeAuthorization,
} from "../lib/paystack";
import {
  ENGAGEMENT_THRESHOLD,
  PREMIUM_ENGAGEMENT_THRESHOLD,
  SUBSCRIPTION_LAUNCH_DATE,
  getEngagementCount,
  getSubscriptionAmountKobo,
  isPaymentsLive,
  isStoreHidden,
  gracePeriodDaysRemaining,
} from "../lib/storeSubscription";
import { requireUser } from "../lib/auth";

const router: IRouter = Router();

/**
 * Loads the store and verifies the authenticated user owns it.
 * Sends the appropriate error response and returns null when not allowed.
 */
async function loadOwnedStore(
  req: Parameters<typeof requireUser>[0],
  res: Parameters<typeof requireUser>[1],
): Promise<typeof storesTable.$inferSelect | null> {
  const userId = requireUser(req, res);
  if (!userId) return null;

  const storeId = parseInt(String(req.params.storeId), 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return null; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return null; }
  if (store.ownerUserId !== userId) { res.status(403).json({ error: "You do not own this store" }); return null; }

  return store;
}

const SUBSCRIPTION_DAYS = 30;

function buildStatus(store: typeof storesTable.$inferSelect, engagementCount: number) {
  return {
    storeId: store.id,
    engagementCount,
    subscriptionAmountKobo: getSubscriptionAmountKobo(engagementCount),
    premiumThreshold: PREMIUM_ENGAGEMENT_THRESHOLD,
    qualified: store.verificationStatus === "verified" && engagementCount >= ENGAGEMENT_THRESHOLD,
    subscriptionStatus: store.subscriptionStatus as "inactive" | "active" | "past_due",
    subscriptionDueAt: store.subscriptionDueAt?.toISOString() ?? null,
    subscriptionLastPaidAt: store.subscriptionLastPaidAt?.toISOString() ?? null,
    qualifiedAt: store.qualifiedAt?.toISOString() ?? null,
    gracePeriodDaysRemaining: gracePeriodDaysRemaining(store),
    isVisible: !isStoreHidden(store),
    autoPayEnabled: store.autoPayEnabled,
    hasAutoCharge: !!store.paystackAuthCode,
    paymentsLive: isPaymentsLive(),
    paymentsLaunchDate: SUBSCRIPTION_LAUNCH_DATE.toISOString(),
  };
}

// GET /stores/:storeId/subscription
router.get("/stores/:storeId/subscription", async (req, res): Promise<void> => {
  const store = await loadOwnedStore(req, res);
  if (!store) return;

  const engagementCount = await getEngagementCount(store.id);
  res.json(buildStatus(store, engagementCount));
});

// POST /stores/:storeId/subscription/initialize
router.post("/stores/:storeId/subscription/initialize", async (req, res): Promise<void> => {
  if (!isPaymentsLive()) {
    res.status(403).json({ error: `Subscription billing is not active yet. It launches on ${SUBSCRIPTION_LAUNCH_DATE.toDateString()}.` });
    return;
  }

  const parsed = InitializeSubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const store = await loadOwnedStore(req, res);
  if (!store) return;
  const storeId = store.id;

  const engagementCount = await getEngagementCount(storeId);
  if (store.verificationStatus !== "verified" || engagementCount < ENGAGEMENT_THRESHOLD) {
    res.status(403).json({ error: "Store is not yet eligible for a subscription" });
    return;
  }

  const reference = `dodolink_sub_${storeId}_${Date.now()}`;
  const { email } = parsed.data;

  const amountKobo = getSubscriptionAmountKobo(engagementCount);

  try {
    const data = await paystackInitialize(email, amountKobo, reference, {
      storeId,
      storeName: store.name,
      type: "subscription",
    });

    // Save the email so we can use it for future auto-charges
    await db
      .update(storesTable)
      .set({ paystackEmail: email })
      .where(eq(storesTable.id, storeId));

    res.json({ checkoutUrl: data.authorization_url, reference: data.reference });
  } catch (err) {
    req.log.error({ err }, "Paystack initialize failed");
    res.status(502).json({ error: "Payment provider error" });
  }
});

// POST /stores/:storeId/subscription/verify
router.post("/stores/:storeId/subscription/verify", async (req, res): Promise<void> => {
  const parsed = VerifySubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const store = await loadOwnedStore(req, res);
  if (!store) return;
  const storeId = store.id;

  // The reference must be one our server generated for THIS store
  const expectedPrefix = `dodolink_sub_${storeId}_`;
  const reference = parsed.data.reference;
  if (!reference.startsWith(expectedPrefix)) {
    res.status(400).json({ error: "Payment reference does not belong to this store" });
    return;
  }

  // Replay protection: the reference embeds the timestamp it was generated at.
  // Any reference generated before the last successful payment has already been
  // consumed (or superseded) and cannot be used to renew again.
  const refTimestamp = Number(reference.slice(expectedPrefix.length));
  if (!Number.isFinite(refTimestamp)) {
    res.status(400).json({ error: "Invalid payment reference" });
    return;
  }
  if (store.subscriptionLastPaidAt && refTimestamp <= store.subscriptionLastPaidAt.getTime()) {
    res.status(400).json({ error: "This payment reference has already been used" });
    return;
  }

  try {
    const txn = await paystackVerify(reference);

    if (txn.status !== "success") {
      res.status(400).json({ error: `Payment not successful (status: ${txn.status})` });
      return;
    }

    // The amount owed depends on the store's engagement tier. Accept the
    // payment as long as it covers the tier owed right now (paying the higher
    // tier is always fine).
    const engagementNow = await getEngagementCount(storeId);
    const expectedKobo = getSubscriptionAmountKobo(engagementNow);
    if (txn.amount < expectedKobo) {
      res.status(400).json({ error: "Payment amount does not match the subscription fee" });
      return;
    }

    if (txn.currency && txn.currency !== "NGN") {
      res.status(400).json({ error: "Payment must be made in Nigerian Naira (NGN)" });
      return;
    }

    const now = new Date();
    const dueAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

    const authCode = txn.authorization?.reusable ? txn.authorization.authorization_code : null;
    const customerCode = txn.customer?.customer_code ?? null;

    const [updated] = await db
      .update(storesTable)
      .set({
        subscriptionStatus: "active",
        subscriptionLastPaidAt: now,
        subscriptionDueAt: dueAt,
        ...(authCode && { paystackAuthCode: authCode }),
        ...(customerCode && { paystackCustomerCode: customerCode }),
      })
      .where(eq(storesTable.id, storeId))
      .returning();

    const engagementCount = await getEngagementCount(storeId);
    res.json(buildStatus(updated, engagementCount));
  } catch (err) {
    req.log.error({ err }, "Paystack verify failed");
    res.status(502).json({ error: "Payment verification failed" });
  }
});

// POST /stores/:storeId/subscription/charge
router.post("/stores/:storeId/subscription/charge", async (req, res): Promise<void> => {
  if (!isPaymentsLive()) {
    res.status(403).json({ error: `Subscription billing is not active yet. It launches on ${SUBSCRIPTION_LAUNCH_DATE.toDateString()}.` });
    return;
  }

  const store = await loadOwnedStore(req, res);
  if (!store) return;
  const storeId = store.id;

  if (!store.paystackAuthCode || !store.paystackEmail) {
    res.status(400).json({ error: "No saved payment method. Please pay manually first." });
    return;
  }

  const chargeEngagement = await getEngagementCount(storeId);
  const chargeAmountKobo = getSubscriptionAmountKobo(chargeEngagement);

  try {
    const result = await paystackChargeAuthorization(
      store.paystackAuthCode,
      store.paystackEmail,
      chargeAmountKobo
    );

    if (result.status !== "success") {
      await db
        .update(storesTable)
        .set({ subscriptionStatus: "past_due" })
        .where(eq(storesTable.id, storeId));
      res.status(400).json({ error: `Charge failed (status: ${result.status})` });
      return;
    }

    const now = new Date();
    const dueAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

    const [updated] = await db
      .update(storesTable)
      .set({
        subscriptionStatus: "active",
        subscriptionLastPaidAt: now,
        subscriptionDueAt: dueAt,
      })
      .where(eq(storesTable.id, storeId))
      .returning();

    const engagementCount = await getEngagementCount(storeId);
    res.json(buildStatus(updated, engagementCount));
  } catch (err) {
    req.log.error({ err }, "Paystack charge failed");
    res.status(502).json({ error: "Payment provider error" });
  }
});

// PATCH /stores/:storeId/subscription/auto-pay
router.patch("/stores/:storeId/subscription/auto-pay", async (req, res): Promise<void> => {
  const parsed = ToggleAutoPayBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const store = await loadOwnedStore(req, res);
  if (!store) return;
  const storeId = store.id;

  if (parsed.data.enabled && !store.paystackAuthCode) {
    res.status(400).json({ error: "Cannot enable auto-pay without a saved payment method" });
    return;
  }

  const [updated] = await db
    .update(storesTable)
    .set({ autoPayEnabled: parsed.data.enabled })
    .where(eq(storesTable.id, storeId))
    .returning();

  const engagementCount = await getEngagementCount(storeId);
  res.json(buildStatus(updated, engagementCount));
});

export default router;
