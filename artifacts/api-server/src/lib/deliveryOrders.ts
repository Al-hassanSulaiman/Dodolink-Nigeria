import { and, eq, sql } from "drizzle-orm";
import {
  db, deliveryOrdersTable, deliveryAgentsTable, deliveryConversationsTable, deliveryMessagesTable,
  deliveryRatingsTable, deliveryDisputesTable, pushTokensTable,
} from "@workspace/db";
import { notifyTokens } from "./push";
import { logger } from "./logger";
import { deliveryCode, quote, orderIsStale } from "./deliveryMoney";

export type OrderRow = typeof deliveryOrdersTable.$inferSelect;
export type Viewer = "customer" | "agent";

export async function pushToUser(userId: string | null | undefined, title: string, body: string, data: Record<string, unknown> = {}) {
  if (!userId) return;
  try {
    const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable).where(eq(pushTokensTable.userId, userId));
    await notifyTokens(tokens.map(t => t.token), title, body, data);
  } catch (err) {
    logger.warn({ err }, "Delivery push failed");
  }
}

/** A system-style line in the delivery chat, sent as the company or the customer. */
export async function postChatLine(order: OrderRow, as: Viewer, body: string, senderName: string, senderId: string) {
  if (!order.conversationId) return;
  await db.transaction(async tx => {
    await tx.insert(deliveryMessagesTable).values({
      conversationId: order.conversationId!, senderId, senderName, senderType: as, body,
    });
    await tx.update(deliveryConversationsTable).set({
      lastMessage: body, lastMessageAt: new Date(),
      ...(as === "customer"
        ? { agentUnread: sql`${deliveryConversationsTable.agentUnread} + 1` }
        : { customerUnread: sql`${deliveryConversationsTable.customerUnread} + 1` }),
    }).where(eq(deliveryConversationsTable.id, order.conversationId!));
  });
}

export async function orderView(order: OrderRow, viewer: Viewer) {
  const [rating] = await db.select().from(deliveryRatingsTable).where(eq(deliveryRatingsTable.orderId, order.id));
  const [openDispute] = await db.select({ id: deliveryDisputesTable.id }).from(deliveryDisputesTable)
    .where(and(eq(deliveryDisputesTable.orderId, order.id), eq(deliveryDisputesTable.status, "open")));
  const q = quote(order.amountKobo, order.paystackFeeKobo > 0 ? order.paystackFeeKobo : undefined, order.refundedKobo);
  return {
    id: order.id, status: order.status, amountKobo: order.amountKobo,
    pickupState: order.pickupState, dropState: order.dropState, description: order.description,
    createdAt: order.createdAt, paidAt: order.paidAt, deliveredAt: order.deliveredAt,
    disputed: !!openDispute, rating: rating ? { stars: rating.stars, comment: rating.comment } : null,
    // Only the customer sees the code, and only once paid.
    code: viewer === "customer" && order.status === "paid" && order.paystackReference
      ? deliveryCode(order.id, order.paystackReference) : null,
    // Only the company sees the breakdown of what it will receive.
    breakdown: viewer === "agent" ? {
      platformFeeKobo: q.platformFeeKobo, paystackFeeKobo: q.paystackFeeKobo,
      transferFeeKobo: q.transferFeeKobo, youReceiveKobo: q.agentAmountKobo,
    } : null,
    payoutStatus: viewer === "agent" ? order.payoutStatus : null,
    needsReview: orderIsStale(order.paidAt, order.status),
  };
}

/**
 * Marks a delivery order as paid. Safe to call many times (webhook + verify): only the first
 * call changes anything. Records the real Paystack fee so the company's share is exact.
 */
export async function markDeliveryOrderPaid(params: {
  reference: string; amountKobo: number; feesKobo: number;
}): Promise<"paid" | "already" | "unknown" | "mismatch"> {
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.paystackReference, params.reference));
  if (!order) return "unknown";
  if (order.status !== "requested") return "already";
  if (params.amountKobo !== order.amountKobo) {
    logger.error({ orderId: order.id, expected: order.amountKobo, got: params.amountKobo }, "Delivery payment amount mismatch");
    await db.update(deliveryOrdersTable).set({ status: "review", payoutNote: "Paid amount did not match the request" })
      .where(and(eq(deliveryOrdersTable.id, order.id), eq(deliveryOrdersTable.status, "requested")));
    return "mismatch";
  }
  const q = quote(order.amountKobo, params.feesKobo);
  const updated = await db.update(deliveryOrdersTable).set({
    status: "paid", paidAt: new Date(), paystackFeeKobo: params.feesKobo,
    platformFeeKobo: q.platformFeeKobo, agentAmountKobo: q.agentAmountKobo,
  }).where(and(eq(deliveryOrdersTable.id, order.id), eq(deliveryOrdersTable.status, "requested"))).returning();
  if (updated.length === 0) return "already";
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
  await pushToUser(agent?.linkedUserId, "Delivery paid", `Job #${order.id} is paid. Deliver, then ask the customer for the 4-digit code.`, { deliveryConversationId: order.conversationId });
  await pushToUser(order.customerId, "Payment received", `Your delivery #${order.id} is paid. Your 4-digit code is in the chat.`, { deliveryConversationId: order.conversationId });
  return "paid";
}

export async function markDelivered(order: OrderRow): Promise<boolean> {
  const updated = await db.update(deliveryOrdersTable).set({
    status: "delivered", deliveredAt: new Date(), payoutStatus: "pending",
  }).where(and(eq(deliveryOrdersTable.id, order.id), eq(deliveryOrdersTable.status, "paid"))).returning();
  if (updated.length === 0) return false;
  await pushToUser(order.customerId, "Delivered", `Delivery #${order.id} is complete. Please rate the company.`, { deliveryConversationId: order.conversationId });
  return true;
}
