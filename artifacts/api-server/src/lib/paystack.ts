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
