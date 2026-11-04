import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, deliveryOrdersTable, deliveryAgentsTable, deliverySettingsTable, deliveryRatingsTable, pushTokensTable,
} from "@workspace/db";
import {
  paystackVerify, paystackRefund, paystackCreateRecipient, paystackTransfer, paystackVerifyTransfer,
  paystackFinalizeTransfer, paystackResendTransferOtp,
} from "./paystack";
import { breakdown } from "./deliveryMoney";
import { notifyTokens } from "./push";
import { logger } from "./logger";

export type Order = typeof deliveryOrdersTable.$inferSelect;

export const PAYOUT_MODES = ["manual_otp", "automatic"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

export async function pushToUser(userId: string | null | undefined, title: string, body: string, data: Record<string, unknown> = {}) {
  if (!userId) return;
  try {
    const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable).where(eq(pushTokensTable.userId, userId));
    await notifyTokens(tokens.map(t => t.token), title, body, data);
  } catch (err) {
    logger.warn({ err }, "Delivery push failed");
  }
}

// ---- settings (payout mode and pause switch, changed from the admin dashboard) ----

export async function getDeliverySettings(): Promise<{ payoutMode: PayoutMode; payoutsPaused: boolean }> {
  const rows = await db.select().from(deliverySettingsTable);
  const map = new Map(rows.map(r => [r.key, r.value]));
  const mode = map.get("payout_mode");
  return {
    // Safe default: a person must type the Paystack OTP for every payout.
    payoutMode: (PAYOUT_MODES as readonly string[]).includes(mode ?? "") ? (mode as PayoutMode) : "manual_otp",
    payoutsPaused: map.get("payouts_paused") === "true",
  };
}

export async function setDeliverySetting(key: "payout_mode" | "payouts_paused", value: string) {
  await db.insert(deliverySettingsTable).values({ key, value })
    .onConflictDoUpdate({ target: deliverySettingsTable.key, set: { value } });
}

// ---- payments ----

export function orderIdFromReference(reference: string): number | null {
  const match = /^del_(\d+)_/.exec(reference);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

export type PaymentResult = "paid" | "already" | "ignored" | "refunded" | "mismatch";

/**
 * Marks a delivery job paid. Called by the Paystack webhook and by the app after checkout.
 * Always asks Paystack for the truth instead of trusting the request that called us, and is
 * safe to run any number of times for the same payment.
 */
export async function applyPayment(reference: string): Promise<PaymentResult> {
  const orderId = orderIdFromReference(reference);
  if (orderId === null) return "ignored";
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, orderId));
  if (!order) return "ignored";
  const tx = await paystackVerify(reference);
  if (tx.status !== "success") return "ignored";
  if (tx.amount !== order.amountKobo || (tx.currency && tx.currency !== "NGN")) {
    logger.error({ reference, expected: order.amountKobo, got: tx.amount }, "Delivery payment amount mismatch");
    return "mismatch";
  }
  const [updated] = await db.update(deliveryOrdersTable).set({
    status: "paid", paidAt: new Date(), paystackReference: reference, paystackFeeKobo: tx.fees ?? null,
  }).where(and(eq(deliveryOrdersTable.id, orderId), eq(deliveryOrdersTable.status, "requested"))).returning();
  if (updated) {
    const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
    void pushToUser(agent?.linkedUserId, "Delivery paid", `Job #${orderId} has been paid. You can start the delivery.`, { deliveryOrderId: orderId });
    return "paid";
  }
  if (order.paystackReference === reference && order.status !== "requested" && order.status !== "cancelled") return "already";
  // A second payment for a job that is already paid or was cancelled: give the money back.
  try {
    await paystackRefund(reference);
    logger.warn({ reference, orderId }, "Refunded an extra delivery payment");
  } catch (err) {
    logger.error({ err, reference, orderId }, "Could not refund an extra delivery payment; needs manual refund");
  }
  return "refunded";
}

// ---- delivery confirmed -> payout ----

export async function markDelivered(orderId: number): Promise<boolean> {
  const [updated] = await db.update(deliveryOrdersTable).set({
    status: "delivered", deliveredAt: new Date(), payoutStatus: "queued",
  }).where(and(eq(deliveryOrdersTable.id, orderId), eq(deliveryOrdersTable.status, "paid"))).returning();
  if (!updated) return false;
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, updated.agentId));
  void pushToUser(updated.customerId, "Delivery complete", `Job #${orderId} is delivered. Please rate the delivery.`, { deliveryOrderId: orderId });
  void pushToUser(agent?.linkedUserId, "Delivery confirmed", `Job #${orderId} is confirmed. Your payout is being processed.`, { deliveryOrderId: orderId });
  const settings = await getDeliverySettings();
  if (settings.payoutMode === "automatic" && !settings.payoutsPaused) {
    void attemptPayout(orderId).catch(err => logger.error({ err, orderId }, "Automatic payout failed"));
  }
  return true;
}

const payoutRef = (orderId: number, attempt: number) => `dlvpay_${orderId}_${attempt}`;
const LIVE_TRANSFER_STATES = ["success", "pending", "processing", "received", "otp"];

export interface PayoutResult { ok: boolean; status: string; message?: string }

/**
 * Starts the payout for a delivered job. Each attempt uses its own fixed reference and first
 * checks whether Paystack already has an earlier attempt, so the company can never be paid twice.
 */
export async function attemptPayout(orderId: number): Promise<PayoutResult> {
  const settings = await getDeliverySettings();
  if (settings.payoutsPaused) return { ok: false, status: "paused", message: "Payouts are paused." };

  const [claimed] = await db.update(deliveryOrdersTable).set({
    payoutStatus: "sending", payoutAttempts: sql`${deliveryOrdersTable.payoutAttempts} + 1`,
  }).where(and(
    eq(deliveryOrdersTable.id, orderId), eq(deliveryOrdersTable.status, "delivered"),
    inArray(deliveryOrdersTable.payoutStatus, ["queued", "failed"]),
  )).returning();
  if (!claimed) return { ok: false, status: "not_ready", message: "This job is not ready for payout." };

  try {
    const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, claimed.agentId));
    if (!agent || !agent.bankCode || !agent.bankAccountNumber) throw new Error("This company has no verified bank account saved.");
    let recipient = agent.paystackRecipientCode;
    if (!recipient) {
      recipient = await paystackCreateRecipient(agent.bankAccountName || agent.name, agent.bankAccountNumber, agent.bankCode);
      await db.update(deliveryAgentsTable).set({ paystackRecipientCode: recipient }).where(eq(deliveryAgentsTable.id, agent.id));
    }
    const b = breakdown(claimed.amountKobo, { actualChargeFeeKobo: claimed.paystackFeeKobo, refundKobo: claimed.refundKobo });
    if (b.companyReceivesKobo <= 0) throw new Error("Nothing left to pay out after fees.");

    let transfer = null;
    for (let n = claimed.payoutAttempts - 1; n >= 1 && !transfer; n--) {
      const earlier = await paystackVerifyTransfer(payoutRef(orderId, n));
      if (earlier && LIVE_TRANSFER_STATES.includes(earlier.status)) transfer = earlier;
    }
    if (!transfer) {
      transfer = await paystackTransfer(b.companyReceivesKobo, recipient, payoutRef(orderId, claimed.payoutAttempts), `DodoLink delivery #${orderId}`);
    }
    const payoutStatus = transfer.status === "success" ? "paid" : transfer.status === "otp" ? "awaiting_otp" : "sent";
    await db.update(deliveryOrdersTable).set({
      payoutStatus, transferReference: transfer.reference, transferCode: transfer.transfer_code ?? null,
      agentAmountKobo: b.companyReceivesKobo, platformFeeKobo: b.platformFeeKobo, payoutError: null,
    }).where(eq(deliveryOrdersTable.id, orderId));
    return { ok: true, status: payoutStatus };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Payout failed";
    await db.update(deliveryOrdersTable).set({ payoutStatus: "failed", payoutError: message.slice(0, 300) })
      .where(eq(deliveryOrdersTable.id, orderId));
    logger.error({ err, orderId }, "Delivery payout failed");
    return { ok: false, status: "failed", message };
  }
}

export async function finalizePayoutOtp(orderId: number, otp: string): Promise<PayoutResult> {
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, orderId));
  if (!order || order.status !== "delivered" || order.payoutStatus !== "awaiting_otp" || !order.transferCode) {
    return { ok: false, status: "not_ready", message: "This payout is not waiting for a code." };
  }
  try {
    const transfer = await paystackFinalizeTransfer(order.transferCode, otp);
    const payoutStatus = transfer.status === "success" ? "paid" : "sent";
    await db.update(deliveryOrdersTable).set({ payoutStatus, payoutError: null })
      .where(and(eq(deliveryOrdersTable.id, orderId), eq(deliveryOrdersTable.payoutStatus, "awaiting_otp")));
    return { ok: true, status: payoutStatus };
  } catch (err) {
    return { ok: false, status: "awaiting_otp", message: err instanceof Error ? err.message : "Wrong code" };
  }
}

export async function resendPayoutOtp(orderId: number): Promise<PayoutResult> {
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, orderId));
  if (!order || order.payoutStatus !== "awaiting_otp" || !order.transferCode) {
    return { ok: false, status: "not_ready", message: "This payout is not waiting for a code." };
  }
  try {
    await paystackResendTransferOtp(order.transferCode);
    return { ok: true, status: "awaiting_otp" };
  } catch (err) {
    return { ok: false, status: "awaiting_otp", message: err instanceof Error ? err.message : "Could not resend" };
  }
}

/** Paystack tells us how a transfer ended. */
export async function applyTransferEvent(event: string, reference: string): Promise<void> {
  if (!reference.startsWith("dlvpay_")) return;
  if (event === "transfer.success") {
    await db.update(deliveryOrdersTable).set({ payoutStatus: "paid", payoutError: null })
      .where(eq(deliveryOrdersTable.transferReference, reference));
  } else if (event === "transfer.failed" || event === "transfer.reversed") {
    await db.update(deliveryOrdersTable).set({ payoutStatus: "failed", payoutError: `Paystack reported ${event.replace("transfer.", "")}` })
      .where(and(eq(deliveryOrdersTable.transferReference, reference), inArray(deliveryOrdersTable.payoutStatus, ["sent", "awaiting_otp", "paid"])));
  }
}

// ---- ratings ----

export async function ratingSummaries(agentIds: number[]): Promise<Map<number, { avg: number; count: number }>> {
  const out = new Map<number, { avg: number; count: number }>();
  if (!agentIds.length) return out;
  const rows = await db.select({
    agentId: deliveryRatingsTable.agentId,
    avg: sql<number>`round(avg(${deliveryRatingsTable.stars})::numeric, 1)::float`,
    count: sql<number>`count(*)::integer`,
  }).from(deliveryRatingsTable).where(inArray(deliveryRatingsTable.agentId, agentIds)).groupBy(deliveryRatingsTable.agentId);
  for (const row of rows) out.set(row.agentId, { avg: row.avg, count: row.count });
  return out;
}
