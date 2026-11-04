import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import crypto from "node:crypto";
import {
  db, deliveryOrdersTable, deliveryAgentsTable, deliveryConversationsTable,
  deliveryRatingsTable, deliveryDisputesTable,
} from "@workspace/db";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { paystackInitialize, paystackVerify } from "../lib/paystack";
import { NIGERIAN_STATES } from "../lib/nigerianStates";
import {
  MIN_JOB_KOBO, MAX_JOB_KOBO, deliveryPaymentsEnabled, quote, deliveryCode, codeMatches, coversRoute,
} from "../lib/deliveryMoney";
import { orderView, markDeliveryOrderPaid, markDelivered, postChatLine, pushToUser } from "../lib/deliveryOrders";

const router: IRouter = Router();
const actionLimit = rateLimit({ name: "delivery-order", max: 40, windowMs: 60_000 });
const codeLimit = rateLimit({ name: "delivery-code", max: 10, windowMs: 10 * 60_000 });
const MAX_CODE_ATTEMPTS = 5;

function toId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}
const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

async function loadOrder(id: number, userId: string) {
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
  if (!order) return null;
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
  if (!agent) return null;
  if (order.customerId === userId) return { order, agent, role: "customer" as const };
  if (agent.linkedUserId === userId) return { order, agent, role: "agent" as const };
  return null;
}

// The company proposes a job and price inside the chat.
router.post("/delivery/conversations/:id/orders", actionLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!deliveryPaymentsEnabled()) { res.status(403).json({ error: "Delivery payments are not open yet." }); return; }
  const convId = toId(req.params.id);
  if (convId === null) { res.status(400).json({ error: "Invalid chat" }); return; }
  const [conv] = await db.select().from(deliveryConversationsTable).where(eq(deliveryConversationsTable.id, convId));
  const [agent] = conv ? await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, conv.agentId)) : [];
  if (!conv || !agent || agent.linkedUserId !== userId) { res.status(404).json({ error: "Chat not found" }); return; }
  if (!agent.active) { res.status(403).json({ error: "This company is not active" }); return; }
  if (!agent.bankCode || !agent.bankAccountNumber) {
    res.status(400).json({ error: "Your payout bank account is not set up yet. Contact DodoLink support." });
    return;
  }
  const amountKobo = Math.round(Number(req.body?.amountNaira) * 100);
  if (!Number.isFinite(amountKobo) || amountKobo < MIN_JOB_KOBO || amountKobo > MAX_JOB_KOBO) {
    res.status(400).json({ error: "Enter a price between ₦500 and ₦5,000,000." });
    return;
  }
  const pickupState = String(req.body?.pickupState ?? "");
  const dropState = String(req.body?.dropState ?? "");
  const known = new Set<string>(NIGERIAN_STATES);
  if (!known.has(pickupState) || !known.has(dropState)) { res.status(400).json({ error: "Choose the pickup and drop-off states." }); return; }
  if (!coversRoute(agent, pickupState, dropState)) {
    res.status(400).json({ error: "This route is outside the areas you deliver. Check your delivery type and states." });
    return;
  }
  const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 500) : null;
  const q = quote(amountKobo);
  const [order] = await db.insert(deliveryOrdersTable).values({
    customerId: conv.customerId, agentId: agent.id, conversationId: conv.id,
    pickupState, dropState, description: description || null,
    amountKobo, platformFeeKobo: q.platformFeeKobo, agentAmountKobo: q.agentAmountKobo,
  }).returning();
  await postChatLine(order, "agent", `Delivery request #${order.id}: ${naira(amountKobo)}, ${pickupState} to ${dropState}. Open it above to pay.`, agent.name, userId);
  await pushToUser(conv.customerId, agent.name, `Delivery request: ${naira(amountKobo)}, ${pickupState} to ${dropState}`, { deliveryConversationId: conv.id });
  res.status(201).json(await orderView(order, "agent"));
});

router.get("/delivery/orders/:id", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.setHeader("Cache-Control", "private, no-store");
  const id = toId(req.params.id);
  const found = id === null ? null : await loadOrder(id, userId);
  if (!found) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(await orderView(found.order, found.role));
});

router.post("/delivery/orders/:id/cancel", actionLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const found = id === null ? null : await loadOrder(id, userId);
  if (!found) { res.status(404).json({ error: "Job not found" }); return; }
  const updated = await db.update(deliveryOrdersTable).set({ status: "cancelled" })
    .where(and(eq(deliveryOrdersTable.id, found.order.id), eq(deliveryOrdersTable.status, "requested"))).returning();
  if (!updated.length) { res.status(409).json({ error: "Only unpaid requests can be cancelled." }); return; }
  res.json(await orderView(updated[0], found.role));
});

router.post("/delivery/orders/:id/pay", actionLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!deliveryPaymentsEnabled()) { res.status(403).json({ error: "Delivery payments are not open yet." }); return; }
  const id = toId(req.params.id);
  const found = id === null ? null : await loadOrder(id, userId);
  if (!found || found.role !== "customer") { res.status(404).json({ error: "Job not found" }); return; }
  const { order } = found;
  if (order.status !== "requested") { res.status(409).json({ error: "This request is not waiting for payment." }); return; }
  let email: string | null = null;
  try {
    const user = await clerkClient.users.getUser(userId);
    email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  } catch { /* handled below */ }
  if (!email) { res.status(400).json({ error: "Your account needs an email address to pay." }); return; }
  const reference = `del_${order.id}_${crypto.randomBytes(6).toString("hex")}`;
  try {
    const data = await paystackInitialize(email, order.amountKobo, reference, {
      type: "delivery", orderId: order.id,
      custom_fields: [
        { display_name: "Type", variable_name: "type", value: "Delivery" },
        { display_name: "Delivery job", variable_name: "delivery_order", value: String(order.id) },
      ],
    });
    await db.update(deliveryOrdersTable).set({ paystackReference: reference })
      .where(and(eq(deliveryOrdersTable.id, order.id), eq(deliveryOrdersTable.status, "requested")));
    res.json({ checkoutUrl: data.authorization_url, reference });
  } catch {
    res.status(502).json({ error: "Could not start the payment. Please try again." });
  }
});

// The app calls this when the customer returns from checkout, in case the webhook is slow.
router.post("/delivery/orders/:id/verify", actionLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const found = id === null ? null : await loadOrder(id, userId);
  if (!found || found.role !== "customer") { res.status(404).json({ error: "Job not found" }); return; }
  if (found.order.status === "requested" && found.order.paystackReference) {
    try {
      const tx = await paystackVerify(found.order.paystackReference);
      if (tx.status === "success") {
        await markDeliveryOrderPaid({ reference: found.order.paystackReference, amountKobo: tx.amount, feesKobo: tx.fees ?? 0 });
      }
    } catch { /* still unpaid or Paystack unreachable; the webhook can finish it */ }
  }
  const [fresh] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, found.order.id));
  res.json(await orderView(fresh, "customer"));
});

// The company enters the code the customer reads out.
router.post("/delivery/orders/:id/deliver", codeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const found = id === null ? null : await loadOrder(id, userId);
  if (!found || found.role !== "agent") { res.status(404).json({ error: "Job not found" }); return; }
  const { order } = found;
  if (order.status !== "paid" || !order.paystackReference) { res.status(409).json({ error: "This job is not waiting for delivery." }); return; }
  if (order.codeAttempts >= MAX_CODE_ATTEMPTS) {
    res.status(423).json({ error: "Too many wrong codes. DodoLink support will review this job." });
    return;
  }
  const given = String(req.body?.code ?? "");
  if (!codeMatches(deliveryCode(order.id, order.paystackReference), given)) {
    const [row] = await db.update(deliveryOrdersTable).set({ codeAttempts: sql`${deliveryOrdersTable.codeAttempts} + 1` })
      .where(eq(deliveryOrdersTable.id, order.id)).returning({ attempts: deliveryOrdersTable.codeAttempts });
    res.status(400).json({ error: `Wrong code. ${Math.max(MAX_CODE_ATTEMPTS - (row?.attempts ?? MAX_CODE_ATTEMPTS), 0)} tries left.` });
    return;
  }
  if (!(await markDelivered(order))) { res.status(409).json({ error: "This job is not waiting for delivery." }); return; }
  const [fresh] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, order.id));
  res.json(await orderView(fresh, "agent"));
});

// Or the customer confirms delivery themselves.
router.post("/delivery/orders/:id/confirm", actionLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const found = id === null ? null : await loadOrder(id, userId);
  if (!found || found.role !== "customer") { res.status(404).json({ error: "Job not found" }); return; }
  if (!(await markDelivered(found.order))) { res.status(409).json({ error: "This job is not waiting for delivery." }); return; }
  const [fresh] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, found.order.id));
  res.json(await orderView(fresh, "customer"));
});

router.post("/delivery/orders/:id/rate", actionLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const found = id === null ? null : await loadOrder(id, userId);
  if (!found || found.role !== "customer") { res.status(404).json({ error: "Job not found" }); return; }
  if (!found.order.deliveredAt || found.order.status === "refunded") { res.status(409).json({ error: "You can rate a company after delivery." }); return; }
  const stars = Number(req.body?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) { res.status(400).json({ error: "Choose 1 to 5 stars." }); return; }
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim().slice(0, 500) : "";
  const inserted = await db.insert(deliveryRatingsTable).values({
    orderId: found.order.id, agentId: found.order.agentId, customerId: userId, stars, comment: comment || null,
  }).onConflictDoNothing().returning();
  if (!inserted.length) { res.status(409).json({ error: "You already rated this job." }); return; }
  res.status(201).json(await orderView(found.order, "customer"));
});

// Either side can raise a problem. The payout is held until an admin decides.
router.post("/delivery/orders/:id/dispute", actionLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const found = id === null ? null : await loadOrder(id, userId);
  if (!found) { res.status(404).json({ error: "Job not found" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  if (reason.length < 10) { res.status(400).json({ error: "Please describe the problem (at least 10 characters)." }); return; }
  const { order } = found;
  const held = await db.transaction(async tx => {
    const updated = await tx.update(deliveryOrdersTable).set({ status: "disputed", payoutStatus: "held" })
      .where(and(
        eq(deliveryOrdersTable.id, order.id),
        sql`${deliveryOrdersTable.status} in ('paid', 'delivered')`,
        sql`${deliveryOrdersTable.payoutStatus} in ('none', 'pending')`,
      )).returning();
    if (!updated.length) return false;
    await tx.insert(deliveryDisputesTable).values({ orderId: order.id, openedBy: userId, openedByRole: found.role, reason });
    return true;
  });
  if (!held) { res.status(409).json({ error: "A problem can only be raised on a paid job before it is paid out." }); return; }
  const other = found.role === "customer" ? found.agent.linkedUserId : order.customerId;
  await pushToUser(other, "Delivery problem raised", `A problem was raised on job #${order.id}. DodoLink support will review it.`, { deliveryConversationId: order.conversationId });
  const [fresh] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, order.id));
  res.status(201).json(await orderView(fresh, found.role));
});

export default router;
