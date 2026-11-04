// Money rules for delivery jobs. All amounts are in kobo (1 naira = 100 kobo).
// DodoLink keeps 10% of the price. Paystack's own fees come out of the delivery
// company's share, never the customer's: the customer pays exactly the price agreed in chat.
// The Paystack fee numbers below are estimates used only to show the company what it will
// receive BEFORE the customer pays; the real charge fee reported by Paystack is used at payout.
// Please verify the rates against your Paystack dashboard.

export const PLATFORM_FEE_RATE = 0.10;
export const MIN_PRICE_KOBO = 100_000;        // N1,000
export const MAX_PRICE_KOBO = 200_000_000;    // N2,000,000

export function platformFeeKobo(baseKobo: number): number {
  return Math.round(baseKobo * PLATFORM_FEE_RATE);
}

/** Paystack local card fee: 1.5% (+ N100 from N2,500 upward), capped at N2,000. */
export function estimateChargeFeeKobo(priceKobo: number): number {
  const fee = Math.round(priceKobo * 0.015) + (priceKobo >= 250_000 ? 10_000 : 0);
  return Math.min(fee, 200_000);
}

/** Paystack transfer fee: N10 up to N5,000, N25 up to N50,000, N50 above. */
export function transferFeeKobo(amountKobo: number): number {
  if (amountKobo <= 500_000) return 1_000;
  if (amountKobo <= 5_000_000) return 2_500;
  return 5_000;
}

export interface Breakdown {
  priceKobo: number;
  platformFeeKobo: number;
  paystackFeeKobo: number;
  transferFeeKobo: number;
  companyReceivesKobo: number;
}

/**
 * What the delivery company is paid. `refundKobo` is any part returned to the customer
 * after a dispute; the 10% and the fees are then worked out on what remains.
 */
export function breakdown(priceKobo: number, opts: { actualChargeFeeKobo?: number | null; refundKobo?: number } = {}): Breakdown {
  const base = Math.max(0, priceKobo - (opts.refundKobo ?? 0));
  const platform = platformFeeKobo(base);
  const charge = base === 0 ? 0 : (opts.actualChargeFeeKobo ?? estimateChargeFeeKobo(priceKobo));
  const afterCharge = Math.max(0, base - platform - charge);
  const transfer = afterCharge === 0 ? 0 : transferFeeKobo(afterCharge);
  return {
    priceKobo,
    platformFeeKobo: platform,
    paystackFeeKobo: charge,
    transferFeeKobo: transfer,
    companyReceivesKobo: Math.max(0, afterCharge - transfer),
  };
}
