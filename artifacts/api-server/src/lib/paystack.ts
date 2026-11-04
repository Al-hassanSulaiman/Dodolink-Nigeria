const PAYSTACK_BASE = "https://api.paystack.co";

/**
 * Fail fast at startup if the Paystack key is missing or the wrong mode.
 * In production a test key (sk_test_...) would silently make every "payment"
 * fake, so we refuse to start.
 */
export function validatePaystackKey(): void {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  if (process.env.NODE_ENV === "production" && key.startsWith("sk_test_")) {
    // Warn but do not crash — crashing takes the entire site down for users.
    // Replace PAYSTACK_SECRET_KEY with the live sk_live_... key in Replit
    // Secrets to resolve this warning.
    console.warn(
      "[WARN] PAYSTACK_SECRET_KEY is a TEST key in a production deployment. " +
        "Real payments will not work until you set the live sk_live_... key in Replit Secrets.",
    );
  }
}

function headers() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export interface PaystackTransaction {
  status: string;
  amount: number;
  currency?: string;
  fees?: number | null;
  reference: string;
  authorization: {
    authorization_code: string;
    reusable: boolean;
  };
  customer: {
    customer_code: string;
    email: string;
  };
}

const PAYSTACK_TIMEOUT_MS = 15_000;

async function paystackFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
  });
  if (!res.ok) {
    let message = `Paystack HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch { /* ignore parse errors on error bodies */ }
    throw new Error(message);
  }
  return res;
}

export async function paystackInitialize(
  email: string,
  amountKobo: number,
  reference: string,
  metadata: Record<string, unknown>
): Promise<{ authorization_url: string; reference: string }> {
  const res = await paystackFetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, amount: amountKobo, reference, metadata }),
  });
  const json = (await res.json()) as { status: boolean; message: string; data: { authorization_url: string; reference: string } };
  if (!json.status) throw new Error(json.message || "Paystack initialization failed");
  return json.data;
}

export async function paystackVerify(reference: string): Promise<PaystackTransaction> {
  const res = await paystackFetch(
    `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: headers() }
  );
  const json = (await res.json()) as { status: boolean; message: string; data: PaystackTransaction };
  if (!json.status) throw new Error(json.message || "Paystack verification failed");
  return json.data;
}

export async function paystackChargeAuthorization(
  authorizationCode: string,
  email: string,
  amountKobo: number,
  reference?: string
): Promise<{ status: string; reference: string }> {
  // charge_authorization is irreversible, so the bounded timeout here is only
  // safe because every caller persists `reference` BEFORE charging and, on any
  // error/timeout, reconciles that same reference via paystackVerify() before
  // ever attempting a new charge. Never call this without a durable reference.
  const res = await paystackFetch(`${PAYSTACK_BASE}/transaction/charge_authorization`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      authorization_code: authorizationCode,
      email,
      amount: amountKobo,
      ...(reference ? { reference } : {}),
    }),
  });
  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data: { status: string; reference: string };
  };
  if (!json.status) throw new Error(json.message || "Charge authorization failed");
  return json.data;
}

// ---- Bank lookups, payouts (Transfers) and refunds, used by delivery ----

export interface PaystackBank { name: string; code: string }

export async function paystackListBanks(): Promise<PaystackBank[]> {
  const res = await paystackFetch(`${PAYSTACK_BASE}/bank?country=nigeria&perPage=200&use_cursor=false`, { headers: headers() });
  const json = (await res.json()) as { status: boolean; data: Array<{ name: string; code: string; active?: boolean }> };
  return (json.data ?? []).filter(b => b.active !== false).map(b => ({ name: b.name, code: b.code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function paystackResolveAccount(accountNumber: string, bankCode: string): Promise<string> {
  const res = await paystackFetch(
    `${PAYSTACK_BASE}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: headers() });
  const json = (await res.json()) as { status: boolean; message: string; data?: { account_name?: string } };
  if (!json.status || !json.data?.account_name) throw new Error(json.message || "Could not verify the account");
  return json.data.account_name;
}

export async function paystackCreateRecipient(name: string, accountNumber: string, bankCode: string): Promise<string> {
  const res = await paystackFetch(`${PAYSTACK_BASE}/transferrecipient`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ type: "nuban", name, account_number: accountNumber, bank_code: bankCode, currency: "NGN" }),
  });
  const json = (await res.json()) as { status: boolean; message: string; data?: { recipient_code?: string } };
  if (!json.status || !json.data?.recipient_code) throw new Error(json.message || "Could not create payout recipient");
  return json.data.recipient_code;
}

export interface PaystackTransfer { status: string; reference: string; transfer_code?: string; amount?: number }

/** Returns the transfer for a reference, or null if Paystack has none. */
export async function paystackVerifyTransfer(reference: string): Promise<PaystackTransfer | null> {
  const res = await fetch(`${PAYSTACK_BASE}/transfer/verify/${encodeURIComponent(reference)}`, {
    headers: headers(), signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Paystack HTTP ${res.status}`);
  const json = (await res.json()) as { status: boolean; data?: PaystackTransfer };
  return json.status && json.data ? json.data : null;
}

/** Sends money from the Paystack balance. The reference is fixed per job, so it can never be paid twice. */
export async function paystackTransfer(
  amountKobo: number, recipientCode: string, reference: string, reason: string,
): Promise<PaystackTransfer> {
  const res = await paystackFetch(`${PAYSTACK_BASE}/transfer`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ source: "balance", amount: amountKobo, recipient: recipientCode, reference, reason }),
  });
  const json = (await res.json()) as { status: boolean; message: string; data?: PaystackTransfer };
  if (!json.status || !json.data) throw new Error(json.message || "Transfer failed");
  return json.data;
}

/** Refunds the whole payment, or only `amountKobo` when given (partial refund). */
export async function paystackRefund(transactionReference: string, amountKobo?: number): Promise<void> {
  await paystackFetch(`${PAYSTACK_BASE}/refund`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ transaction: transactionReference, ...(amountKobo ? { amount: amountKobo } : {}) }),
  });
}

/** Completes a transfer that Paystack is holding for the one-time code (OTP) sent to the account owner. */
export async function paystackFinalizeTransfer(transferCode: string, otp: string): Promise<PaystackTransfer> {
  const res = await paystackFetch(`${PAYSTACK_BASE}/transfer/finalize_transfer`, {
    method: "POST", headers: headers(), body: JSON.stringify({ transfer_code: transferCode, otp }),
  });
  const json = (await res.json()) as { status: boolean; message: string; data?: PaystackTransfer };
  if (!json.status || !json.data) throw new Error(json.message || "Could not finalize the transfer");
  return json.data;
}

export async function paystackResendTransferOtp(transferCode: string): Promise<void> {
  await paystackFetch(`${PAYSTACK_BASE}/transfer/resend_otp`, {
    method: "POST", headers: headers(), body: JSON.stringify({ transfer_code: transferCode, reason: "transfer" }),
  });
}
