import crypto from "node:crypto";

// All money is in kobo (1 naira = 100 kobo).
export const PLATFORM_RATE = 0.1; // DodoLink keeps 10% of the agreed price
export const MIN_JOB_KOBO = 50_000; // N500
export const MAX_JOB_KOBO = 500_000_000; // N5,000,000
export const REVIEW_AFTER_DAYS = 3; // paid but unconfirmed jobs are flagged for admin review

/** Delivery payments stay off until DELIVERY_PAYMENTS_ENABLED=true is set on the server. */
export function deliveryPaymentsEnabled(): boolean {
  return process.env.DELIVERY_PAYMENTS_ENABLED === "true";
}

/** Paystack local card fee: 1.5%, plus N100 from N2,500 upwards, capped at N2,000. */
export function estimatePaystackFeeKobo(amountKobo: number): number {
  const flat = amountKobo >= 250_000 ? 10_000 : 0;
  return Math.min(Math.ceil(amountKobo * 0.015) + flat, 200_000);
}

/** Paystack transfer fee (estimate): N10 up to N5,000, N25 up to N50,000, else N50. */
export function estimateTransferFeeKobo(payoutKobo: number): number {
  if (payoutKobo <= 500_000) return 1_000;
  if (payoutKobo <= 5_000_000) return 2_500;
  return 5_000;
}

export type Quote = {
  amountKobo: number; platformFeeKobo: number; paystackFeeKobo: number;
  transferFeeKobo: number; agentAmountKobo: number;
};

/**
 * What the company receives. The customer pays exactly amountKobo. DodoLink's 10%
 * and the Paystack fees all come out of the company's share.
 * Pass the real Paystack fee once the payment has gone through.
 */
export function quote(amountKobo: number, paystackFeeKobo = estimatePaystackFeeKobo(amountKobo), refundedKobo = 0): Quote {
  const base = Math.max(amountKobo - refundedKobo, 0);
  const platformFeeKobo = Math.round(base * PLATFORM_RATE);
  const beforeTransfer = Math.max(base - platformFeeKobo - paystackFeeKobo, 0);
  const transferFeeKobo = estimateTransferFeeKobo(beforeTransfer);
  const agentAmountKobo = Math.max(beforeTransfer - transferFeeKobo, 0);
  return { amountKobo, platformFeeKobo, paystackFeeKobo, transferFeeKobo, agentAmountKobo };
}

/** A 4-digit code the customer reads out on arrival. Derived, never stored in plain text. */
export function deliveryCode(orderId: number, reference: string): string {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "dev-secret";
  const digest = crypto.createHmac("sha256", secret).update(`delivery:${orderId}:${reference}`).digest();
  return String(digest.readUInt32BE(0) % 10_000).padStart(4, "0");
}

export function codeMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given.trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type Coverage = { deliveryType: string; homeState: string | null; coveredStates: string[]; nationwide: boolean };

/** Can this company do a job from pickup to drop-off? */
export function coversRoute(agent: Coverage, pickup: string, drop: string): boolean {
  const intra = pickup === drop;
  const covers = (s: string) => agent.nationwide || agent.coveredStates.includes(s) || agent.homeState === s;
  if (intra) {
    // Inside one state: allowed for intrastate/both in their home state, or interstate companies covering that state.
    if (agent.deliveryType === "interstate") return covers(pickup);
    return agent.homeState === pickup;
  }
  // Between two states: needs interstate or both, and one end must be a state they cover.
  if (agent.deliveryType === "intrastate") return false;
  return covers(pickup) || covers(drop);
}

export function orderIsStale(paidAt: Date | null, status: string, now = new Date()): boolean {
  if (status !== "paid" || !paidAt) return false;
  return now.getTime() - paidAt.getTime() > REVIEW_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
