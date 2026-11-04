import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, deliveryOrdersTable, deliveryAgentsTable, deliveryMessagesTable, deliveryConversationsTable, pushTokensTable,
} from "@workspace/db";
import {
  paystackCreateRecipient, paystackTransfer, paystackVerifyTransfer, paystackRefund,
} from "./paystack";
import { notifyTokens } from "./push";
import { logger } from "./logger";
import { payoutsEnabled, transferReference } from "./deliveryMoney";

export type Order = typeof deliveryOrdersTable.$inferSelect;

/** Adds a plain line to the chat (from the system, shown as the delivery person's side) and bumps unread. */
export async function postChatNote(order: Order, body: string): Promise<void> {
  if (!order.conversationId) return;
  await db.insert(deliveryMessagesTable).values({
    conversationId: order.conversationId, senderId: "system", senderName: "DodoLink", senderType: "system", body,
  });
  await db.update(deliveryConversationsTable).set({
    lastMessage: body, lastMessageAt: new Date(),
    customerUnread: sql`${deliveryConversationsTable.customerUnread} + 1`,
    agentUnread: sql`${deliveryConversationsTable.agentUnread} + 1`,
  }).where(eq(deliveryConversationsTable.id, order.conversationId));
}

async function pushTo(userId: string | null, title: string, body: string, data: Record<string, unknown>) {
  if (!userId) return;
  try {
    const rows = await db.select({ token: pushTokensTable.token }).from(pushTokensTable).where(eq(pushTokensTable.userId, userId));
    await notifyTokens(rows.map(r => r.token), title, body, data);
  } catch (err) {
    logger.warn({ err }, "Delivery push failed");
  }
}

/** Idempotent: only the first call for a requested order changes anything. */
export async function markOrderPaid(orderId: number, reference: string): Promise<boolean> {
  const [updated] = await db.update(deliveryOrdersTable)
    .set({ status: "paid", paidAt: new Date(), paystackReference: reference })
    .where(and(eq(deliveryOrdersTable.id, orderId), eq(deliveryOrdersTable.status, "requested"))).returning();
  if (!updated) return false;
  await postChatNote(updated, "Payment received. Share the delivery code with the delivery person only when your goods arrive.");
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, updated.agentId));
  await pushTo(agent?.linkedUserId ?? null, "Delivery paid", "A customer paid for your delivery job.", { deliveryConversationId: updated.conversationId });
  return true;
}

/** Marks a paid order delivered (once) and starts the payout. */
export async function markDelivered(orderId: number): Promise<boolean> {
  const [updated] = await db.update(deliveryOrdersTable)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(and(eq(deliveryOrdersTable.id, orderId), eq(deliveryOrdersTable.status, "paid"))).returning();
  if (!updated) return false;
  await postChatNote(updated, "Delivery confirmed. Thank you!");
  await releasePayout(orderId).catch(err => logger.error({ err, orderId }, "Payout start failed"));
  return true;
}

export type PayoutResult = "paid_out" | "pending" | "disabled" | "no_bank" | "not_ready" | "failed";

/**
 * Sends the delivery person his share. Safe to call repeatedly: one fixed reference per job,
 * and it checks with Paystack before creating a transfer.
 */
export async function releasePayout(orderId: number): Promise<PayoutResult> {
  if (!payoutsEnabled()) return "disabled";
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, orderId));
  if (!order || order.status !== "delivered") return "not_ready";
  if (order.payoutStatus === "success") return "paid_out";

  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
  if (!agent?.bankCode || !agent.bankAccountNumber || !agent.bankAccountName) {
    await db.update(deliveryOrdersTable).set({ payoutStatus: "failed" }).where(eq(deliveryOrdersTable.id, orderId));
    return "no_bank";
  }

  // Claim the payout. Only one caller can move none/failed to pending.
  const [claimed] = await db.update(deliveryOrdersTable).set({ payoutStatus: "pending" })
    .where(and(eq(deliveryOrdersTable.id, orderId), inArray(deliveryOrdersTable.payoutStatus, ["none", "failed"]))).returning();
  if (!claimed) return order.payoutStatus === "pending" ? "pending" : "not_ready";

  const reference = transferReference(orderId);
  try {
    // If an earlier attempt already reached Paystack, use its outcome instead of paying twice.
    const existing = await paystackVerifyTransfer(reference);
    if (existing) {
      return await recordTransferStatus(orderId, existing.status, reference);
    }
    let recipient = agent.paystackRecipientCode;
    if (!recipient) {
      recipient = await paystackCreateRecipient(agent.bankAccountName, agent.bankAccountNumber, agent.bankCode);
      await db.update(deliveryAgentsTable).set({ paystackRecipientCode: recipient }).where(eq(deliveryAgentsTable.id, agent.id));
    }
    const transfer = await paystackTransfer(order.agentAmountKobo, recipient, reference, `DodoLink delivery #${orderId}`);
    await db.update(deliveryOrdersTable).set({ transferReference: reference }).where(eq(deliveryOrdersTable.id, orderId));
    return await recordTransferStatus(orderId, transfer.status, reference);
  } catch (err) {
    logger.error({ err, orderId }, "Delivery payout failed");
    await db.update(deliveryOrdersTable).set({ payoutStatus: "failed", transferReference: reference }).where(eq(deliveryOrdersTable.id, orderId));
    return "failed";
  }
}

/** Maps a Paystack transfer status onto our payout status. */
export async function recordTransferStatus(orderId: number, status: string, reference: string): Promise<PayoutResult> {
  const next = status === "success" ? "success"
    : status === "failed" || status === "reversed" ? "failed"
    : status === "otp" ? "failed"   // needs the Paystack OTP switched off or approval; admin sees "failed" and retries
    : "pending";
  await db.update(deliveryOrdersTable).set({ payoutStatus: next, transferReference: reference }).where(eq(deliveryOrdersTable.id, orderId));
  if (next === "success") {
    const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, orderId));
    if (order) {
      const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
      await pushTo(agent?.linkedUserId ?? null, "You have been paid", "Your delivery payout has been sent to your bank account.", { deliveryConversationId: order.conversationId });
    }
    return "paid_out";
  }
  return next === "failed" ? "failed" : "pending";
}

/** Called by the signed Paystack webhook for transfer.* events. */
export async function handleTransferEvent(event: string, reference: string): Promise<void> {
  if (!reference.startsWith("delpay_order_")) return;
  const orderId = Number(reference.slice("delpay_order_".length));
  if (!Number.isInteger(orderId)) return;
  const status = event === "transfer.success" ? "success" : event === "transfer.failed" || event === "transfer.reversed" ? "failed" : null;
  if (!status) return;
  await recordTransferStatus(orderId, status, reference);
}

/** Admin decision on a dispute: give the customer his money back. */
export async function refundOrder(orderId: number): Promise<boolean> {
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, orderId));
  if (!order?.paystackReference || order.payoutStatus === "success" || order.payoutStatus === "pending") return false;
  await paystackRefund(order.paystackReference);
  await db.update(deliveryOrdersTable).set({ status: "refunded", payoutStatus: "none" }).where(eq(deliveryOrdersTable.id, orderId));
  await postChatNote(order, "This job was refunded to the customer.");
  return true;
}
