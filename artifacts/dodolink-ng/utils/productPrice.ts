/**
 * Product prices are naira, not kobo. Accept plain or correctly grouped amounts
 * without ever truncating malformed input the way parseFloat("70,000") does.
 */
export function parseProductPrice(input: string): number | null {
  const text = input.trim().replace(/^₦\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text.replace(/,/g, ''));
  return Number.isFinite(amount) && Number.isSafeInteger(Math.round(amount * 100))
    ? amount
    : null;
}
