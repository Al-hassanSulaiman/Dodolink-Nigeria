import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, deliveryAgentsTable, deliverySubscriptionPaymentsTable } from "@workspace/db";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { paystackInitialize, paystackVerify } from "../lib/paystack";
import { ENGAGEMENT_THRESHOLD, getSubscriptionAmountKobo, isPaymentsLive } from "../lib/storeSubscription";
import {
  DELIVERY_REFERENCE_PREFIX, activateAgentForReference, deliveryEngagementCount, deliverySubscriptionStatus,
} from "../lib/deliverySubscription";

// A delivery company manages its own subscription here. Customers never see these routes' data.
const router: IRouter = Router();
const paymentLimit = rateLimit({ name: "delivery-subscription", max: 10, windowMs: 60 * 60 * 1000 });

async function myAgent(req: Parameters<typeof requireUser>[0], res: Parameters<typeof requireUser>[1]) {
  const userId = requireUser(req, res);
  if (!userId) return null;
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.linkedUserId, userId));
  if (!agent) { res.status(404).json({ error: "You do not have a delivery company" }); return null; }
  return agent;
}

router.get("/delivery/subscription", async (req, res): Promise<void> => {
  const agent = await myAgent(req, res);
  if (!agent) return;
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await deliverySubscriptionStatus(agent));
});

router.post("/delivery/subscription/initialize", paymentLimit, async (req, res): Promise<void> => {
  const agent = await myAgent(req, res);
  if (!agent) return;
  if (!isPaymentsLive()) { res.status(403).json({ error: "Subscription billing is not active yet" }); return; }
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Enter a valid email" }); return; }
  const engagement = await deliveryEngagementCount(agent.id);
  if (!agent.qualifiedAt && engagement < ENGAGEMENT_THRESHOLD) {
    res.status(403).json({ error: "You are not yet eligible for a subscription" });
    return;
  }
  const amountKobo = getSubscriptionAmountKobo(engagement);
  const reference = `${DELIVERY_REFERENCE_PREFIX}${agent.id}_${Date.now()}`;
  try {
    const data = await paystackInitialize(email, amountKobo, reference, {
      agentId: agent.id, agentName: agent.name, type: "delivery_subscription",
    });
    await db.insert(deliverySubscriptionPaymentsTable).values({ reference, agentId: agent.id, quotedAmountKobo: amountKobo });
    await db.update(deliveryAgentsTable).set({ paystackEmail: email }).where(eq(deliveryAgentsTable.id, agent.id));
    res.json({ checkoutUrl: data.authorization_url, reference: data.reference });
  } catch (err) {
    req.log.error({ err }, "Delivery subscription initialize failed");
    res.status(502).json({ error: "Payment provider error" });
  }
});

router.post("/delivery/subscription/verify", paymentLimit, async (req, res): Promise<void> => {
  const agent = await myAgent(req, res);
  if (!agent) return;
  const reference = typeof req.body?.reference === "string" ? req.body.reference : "";
  if (!reference.startsWith(`${DELIVERY_REFERENCE_PREFIX}${agent.id}_`)) {
    res.status(400).json({ error: "Payment reference does not belong to your company" });
    return;
  }
  try {
    const txn = await paystackVerify(reference);
    if (txn.status !== "success") { res.status(400).json({ error: `Payment not successful (status: ${txn.status})` }); return; }
    const result = await activateAgentForReference({ reference, amountKobo: txn.amount, currency: txn.currency });
    if (result === "amount_mismatch" || result === "unknown_reference") {
      res.status(400).json({ error: "Payment does not match the subscription fee" });
      return;
    }
    const [fresh] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, agent.id));
    res.json(await deliverySubscriptionStatus(fresh)); // "already_used" is fine: webhook got there first
  } catch (err) {
    req.log.error({ err }, "Delivery subscription verify failed");
    res.status(502).json({ error: "Payment verification failed" });
  }
});

export default router;
