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
  SUBSCRIPTION_LAUNCH_DATE,
  getEngagementCount,
  isPaymentsLive,
  isStoreHidden,
  gracePeriodDaysRemaining,
} from "../lib/storeSubscription";

const router: IRouter = Router();

const SUBSCRIPTION_AMOUNT_KOBO = 500_000; // ₦5,000
const SUBSCRIPTION_DAYS = 30;

function buildStatus(store: typeof storesTable.$inferSelect, engagementCount: number) {
  return {
    storeId: store.id,
    engagementCount,
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
  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  const engagementCount = await getEngagementCount(storeId);
  res.json(buildStatus(store, engagementCount));
});

// POST /stores/:storeId/subscription/initialize
router.post("/stores/:storeId/subscription/initialize", async (req, res): Promise<void> => {
  if (!isPaymentsLive()) {
    res.status(403).json({ error: `Subscription billing is not active yet. It launches on ${SUBSCRIPTION_LAUNCH_DATE.toDateString()}.` });
    return;
  }

  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = InitializeSubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  const engagementCount = await getEngagementCount(storeId);
  if (store.verificationStatus !== "verified" || engagementCount < ENGAGEMENT_THRESHOLD) {
    res.status(403).json({ error: "Store is not yet eligible for a subscription" });
    return;
  }

  const reference = `dodolink_sub_${storeId}_${Date.now()}`;
  const { email } = parsed.data;

  try {
    const data = await paystackInitialize(email, SUBSCRIPTION_AMOUNT_KOBO, reference, {
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
  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = VerifySubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  try {
    const txn = await paystackVerify(parsed.data.reference);

    if (txn.status !== "success") {
      res.status(400).json({ error: `Payment not successful (status: ${txn.status})` });
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

  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  if (!store.paystackAuthCode || !store.paystackEmail) {
    res.status(400).json({ error: "No saved payment method. Please pay manually first." });
    return;
  }

  try {
    const result = await paystackChargeAuthorization(
      store.paystackAuthCode,
      store.paystackEmail,
      SUBSCRIPTION_AMOUNT_KOBO
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
  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = ToggleAutoPayBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

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
