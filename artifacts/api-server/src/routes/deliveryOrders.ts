import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db, deliveryOrdersTable, deliveryAgentsTable, deliveryConversationsTable, deliveryMessagesTable,
  deliveryRatingsTable, deliveryDisputesTable,
} from "@workspace/db";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { paystackInitialize } from "../lib/paystack";
import { NIGERIAN_STATES, agentCoversJob } from "../lib/nigerianStates";
import { breakdown, MIN_PRICE_KOBO, MAX_PRICE_KOBO } from "../lib/deliveryMoney";
import { deliveryCode, codesMatch } from "../lib/deliveryCode";
import { applyPayment, markDelivered, pushToUser, type Order } from "../lib/deliveryOrders";
import { participant, toId } from "./delivery";

// Delivery jobs: request, pay, confirm with a code, rate, dispute. Money rules live in lib/deliveryMoney.
const router: IRouter = Router();
const writeLimit = rateLimit({ name: "delivery-order", max: 20, windowMs: 60_000 });
const codeLimit = rateLimit({ name: "delivery-code", max: 10, windowMs: 10 * 60_000 });
const MAX_WRONG_CODES = 5;
const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG")}`;

async function loadForUser(orderId: number, userId: string) {
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, orderId));
  if (!order) return null;
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
  if (!agent) return null;
  if (order.customerId === userId) return { order, agent, role: "customer" as const };
  if (agent.linkedUserId === userId) return { order, agent, role: "company" as const };
  return null;
}

router.post("/delivery/orders", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const conversationId = toId(req.body?.conversationId);
  if (conversationId === null) { res.status(400).json({ error: "Invalid chat" }); return; }
  const p = await participant(conversationId, userId);
  if (!p || p.role !== "agent") { res.status(403).json({ error: "Only the delivery company can send a delivery request." }); return; }
  if (!p.agent.active) { res.status(403).json({ error: "This company is not active." }); return; }

  const naira100 = Number(req.body?.amountNaira) * 100;
  if (!Number.isInteger(naira100) || naira100 < MIN_PRICE_KOBO || naira100 > MAX_PRICE_KOBO) {
    res.status(400).json({ error: `Price must be a whole number between ${naira(MIN_PRICE_KOBO)} and ${naira(MAX_PRICE_KOBO)}.` });
    return;
  }
  const pickup = String(req.body?.pickupState ?? "");
  const drop = String(req.body?.dropState ?? "");
  const known = new Set<string>(NIGERIAN_STATES);
  if (!known.has(pickup) || !known.has(drop)) { res.status(400).json({ error: "Choose the pickup and drop-off states." }); return; }
  if (!agentCoversJob(p.agent, pickup, drop)) {
    res.status(400).json({ error: "This route is outside the states your company covers." });
    return;
  }
  if (!p.agent.bankCode || !p.agent.bankAccountNumber) {
    res.status(400).json({ error: "Your payout bank account is not set up yet. Please contact DodoLink." });
    return;
  }
  const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 500) || null : null;

  const [{ open }] = await db.select({ open: sql<number>`count(*)::integer` }).from(deliveryOrdersTable)
    .where(and(eq(deliveryOrdersTable.conversationId, conversationId), eq(deliveryOrdersTable.status, "requested")));
  if (open >= 3) { res.status(400).json({ error: "Please cancel an unpaid request first." }); return; }

  const b = breakdown(naira100);
  const order = await db.transaction(async tx => {
    const [row] = await tx.insert(deliveryOrdersTable).values({
      customerId: p.conv.customerId, agentId: p.agent.id, conversationId,
      pickupState: pickup, dropState: drop, description,
      amountKobo: naira100, platformFeeKobo: b.platformFeeKobo, agentAmountKobo: b.companyReceivesKobo,
    }).returning();
    const text = `Delivery request #${row.id}: ${naira(naira100)}, ${pickup} to ${drop}. Open the request in this chat to pay.`;
    await tx.insert(deliveryMessagesTable).values({
      conversationId, senderId: userId, senderName: p.agent.name, senderType: "agent", body: text,
    });
    await tx.update(deliveryConversationsTable).set({
      lastMessage: text, lastMessageAt: new Date(),
      customerUnread: sql`${deliveryConversationsTable.customerUnread} + 1`,
    }).where(eq(deliveryConversationsTable.id, conversationId));
    return row;
  });
  void pushToUser(p.conv.customerId, p.agent.name, `Delivery request: ${naira(naira100)}, ${pickup} to ${drop}`, { deliveryConversationId: conversationId });
  res.status(201).json({ id: order.id });
});

router.post("/delivery/orders/:id/cancel", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const ctx = id === null ? null : await loadForUser(id, userId);
  if (!ctx) { res.status(404).json({ error: "Job not found" }); return; }
  const [updated] = await db.update(deliveryOrdersTable).set({ status: "cancelled" })
    .where(and(eq(deliveryOrdersTable.id, ctx.order.id), eq(deliveryOrdersTable.status, "requested"))).returning();
  if (!updated) { res.status(409).json({ error: "Only an unpaid request can be cancelled." }); return; }
  res.json({ status: "cancelled" });
});

router.post("/delivery/orders/:id/pay", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const ctx = id === null ? null : await loadForUser(id, userId);
  if (!ctx || ctx.role !== "customer") { res.status(404).json({ error: "Job not found" }); return; }
  if (ctx.order.status !== "requested") { res.status(409).json({ error: "This request cannot be paid." }); return; }
  let email: string | undefined;
  try {
    const user = await clerkClient.users.getUser(userId);
    email = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  } catch { /* handled below */ }
  if (!email) { res.status(400).json({ error: "Your account needs an email address to pay." }); return; }
  const reference = `del_${ctx.order.id}_${Date.now().toString(36)}`;
  try {
    const init = await paystackInitialize(email, ctx.order.amountKobo, reference, {
      type: "delivery", orderId: ctx.order.id,
      custom_fields: [{ display_name: "Type", variable_name: "type", value: "Delivery" }],
    });
    await db.update(deliveryOrdersTable).set({ paystackReference: reference })
      .where(and(eq(deliveryOrdersTable.id, ctx.order.id), eq(deliveryOrdersTable.status, "requested")));
    res.json({ checkoutUrl: init.authorization_url, reference });
  } catch (err) {
    req.log.error({ err }, "Delivery payment init failed");
    res.status(502).json({ error: "Could not start the payment. Please try again." });
  }
});

// The app calls this when the customer comes back from checkout (the webhook does the same job).
router.post("/delivery/orders/:id/verify", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const ctx = id === null ? null : await loadForUser(id, userId);
  if (!ctx || ctx.role !== "customer") { res.status(404).json({ error: "Job not found" }); return; }
  if (ctx.order.paystackReference && ctx.order.status === "requested") {
    try { await applyPayment(ctx.order.paystackReference); } catch (err) { req.log.warn({ err }, "Delivery verify failed"); }
  }
  const [fresh] = await db.select({ status: deliveryOrdersTable.status }).from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, ctx.order.id));
  res.json({ status: fresh?.status ?? ctx.order.status });
});

router.post("/delivery/orders/:id/deliver", codeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const ctx = id === null ? null : await loadForUser(id, userId);
  if (!ctx || ctx.role !== "company") { res.status(404).json({ error: "Job not found" }); return; }
  const { order } = ctx;
  if (order.status !== "paid" || !order.paidAt) { res.status(409).json({ error: "This job is not waiting for delivery." }); return; }
  if (order.codeAttempts >= MAX_WRONG_CODES) {
    res.status(423).json({ error: "Too many wrong codes. Ask the customer to confirm in the app, or report a problem." });
    return;
  }
  const code = String(req.body?.code ?? "").trim();
  if (!codesMatch(code, deliveryCode(order.id, order.paidAt.toISOString()))) {
    await db.update(deliveryOrdersTable).set({ codeAttempts: sql`${deliveryOrdersTable.codeAttempts} + 1` })
      .where(eq(deliveryOrdersTable.id, order.id));
    res.status(400).json({ error: "That code is not correct." });
    return;
  }
  if (!(await markDelivered(order.id))) { res.status(409).json({ error: "This job is not waiting for delivery." }); return; }
  res.json({ status: "delivered" });
});

router.post("/delivery/orders/:id/confirm", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const ctx = id === null ? null : await loadForUser(id, userId);
  if (!ctx || ctx.role !== "customer") { res.status(404).json({ error: "Job not found" }); return; }
  if (!(await markDelivered(ctx.order.id))) { res.status(409).json({ error: "This job cannot be confirmed right now." }); return; }
  res.json({ status: "delivered" });
});

router.post("/delivery/orders/:id/rate", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const ctx = id === null ? null : await loadForUser(id, userId);
  if (!ctx || ctx.role !== "customer") { res.status(404).json({ error: "Job not found" }); return; }
  const stars = Number(req.body?.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) { res.status(400).json({ error: "Choose 1 to 5 stars." }); return; }
  if (ctx.order.status !== "delivered") { res.status(409).json({ error: "You can rate after the delivery is confirmed." }); return; }
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim().slice(0, 500) || null : null;
  const [row] = await db.insert(deliveryRatingsTable).values({
    orderId: ctx.order.id, agentId: ctx.order.agentId, customerId: userId, stars, comment,
  }).onConflictDoNothing().returning();
  if (!row) { res.status(409).json({ error: "You already rated this delivery." }); return; }
  res.status(201).json({ stars });
});

router.post("/delivery/orders/:id/dispute", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  const ctx = id === null ? null : await loadForUser(id, userId);
  if (!ctx) { res.status(404).json({ error: "Job not found" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 5 || reason.length > 1000) { res.status(400).json({ error: "Please describe the problem (at least 5 characters)." }); return; }
  const ok = await db.transaction(async tx => {
    const [held] = await tx.update(deliveryOrdersTable).set({ status: "disputed" }).where(and(
      eq(deliveryOrdersTable.id, ctx.order.id),
      inArray(deliveryOrdersTable.status, ["paid", "delivered"]),
      inArray(deliveryOrdersTable.payoutStatus, ["none", "queued", "failed", "awaiting_otp"]),
    )).returning();
    if (!held) return false;
    await tx.insert(deliveryDisputesTable).values({
      orderId: ctx.order.id, openedBy: userId, openedByRole: ctx.role, reason,
    });
    return true;
  });
  if (!ok) { res.status(409).json({ error: "This job can no longer be disputed here. Please contact DodoLink support." }); return; }
  const other = ctx.role === "customer" ? ctx.agent.linkedUserId : ctx.order.customerId;
  void pushToUser(other, "Problem reported", `A problem was reported on delivery job #${ctx.order.id}. DodoLink will review it.`, { deliveryOrderId: ctx.order.id });
  res.status(201).json({ status: "disputed" });
});

export type { Order };
export default router;
