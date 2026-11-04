import { desc, eq, inArray } from "drizzle-orm";
import { db, deliveryOrdersTable, deliveryRatingsTable, deliveryDisputesTable } from "@workspace/db";
import { breakdown } from "./deliveryMoney";
import { deliveryCode } from "./deliveryCode";
import type { Order } from "./deliveryOrders";

export type Viewer = "customer" | "company";

/** What each side is allowed to see about a job. The customer never sees fees; the company never sees the code. */
export function orderView(
  order: Order, viewer: Viewer,
  ctx: { ratingStars: number | null; disputeOpen: boolean },
) {
  const base = {
    id: order.id,
    status: order.status,
    amountKobo: order.amountKobo,
    pickupState: order.pickupState,
    dropState: order.dropState,
    description: order.description,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    deliveredAt: order.deliveredAt,
    refundKobo: order.refundKobo,
    ratingStars: ctx.ratingStars,
    disputeOpen: ctx.disputeOpen,
  };
  if (viewer === "customer") {
    return {
      ...base,
      // Shown only while the goods are on the way; the company asks for it on arrival.
      deliveryCode: order.status === "paid" && order.paidAt ? deliveryCode(order.id, order.paidAt.toISOString()) : null,
    };
  }
  const b = breakdown(order.amountKobo, { actualChargeFeeKobo: order.paystackFeeKobo, refundKobo: order.refundKobo });
  return {
    ...base,
    payoutStatus: order.payoutStatus,
    breakdown: {
      platformFeeKobo: b.platformFeeKobo, paystackFeeKobo: b.paystackFeeKobo,
      transferFeeKobo: b.transferFeeKobo, companyReceivesKobo: b.companyReceivesKobo,
      estimated: order.paystackFeeKobo === null,
    },
  };
}

export async function ordersForConversation(conversationId: number, viewer: Viewer) {
  const orders = await db.select().from(deliveryOrdersTable)
    .where(eq(deliveryOrdersTable.conversationId, conversationId)).orderBy(desc(deliveryOrdersTable.createdAt)).limit(20);
  if (!orders.length) return [];
  const ids = orders.map(o => o.id);
  const [ratings, disputes] = await Promise.all([
    db.select().from(deliveryRatingsTable).where(inArray(deliveryRatingsTable.orderId, ids)),
    db.select().from(deliveryDisputesTable).where(inArray(deliveryDisputesTable.orderId, ids)),
  ]);
  const stars = new Map(ratings.map(r => [r.orderId, r.stars]));
  const open = new Set(disputes.filter(d => d.status === "open").map(d => d.orderId));
  return orders.map(o => orderView(o, viewer, { ratingStars: stars.get(o.id) ?? null, disputeOpen: open.has(o.id) }));
}
