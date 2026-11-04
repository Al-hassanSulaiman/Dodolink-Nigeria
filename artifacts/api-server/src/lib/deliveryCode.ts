import crypto from "node:crypto";

// The 4-digit code the customer reads out when the goods arrive. It is derived from the
// order and the server secret, so it is never stored and cannot be guessed from the database.
function secret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (key) return key;
  if (process.env.NODE_ENV === "production") throw new Error("PAYSTACK_SECRET_KEY is not set");
  return "development-only-delivery-code-secret";
}

export function deliveryCode(orderId: number, paidAtIso: string): string {
  const digest = crypto.createHmac("sha256", secret()).update(`delivery-code:${orderId}:${paidAtIso}`).digest();
  return String(digest.readUInt32BE(0) % 10000).padStart(4, "0");
}

export function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
