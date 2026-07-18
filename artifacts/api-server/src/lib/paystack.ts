const PAYSTACK_BASE = "https://api.paystack.co";

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

export async function paystackInitialize(
  email: string,
  amountKobo: number,
  reference: string,
  metadata: Record<string, unknown>
): Promise<{ authorization_url: string; reference: string }> {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ email, amount: amountKobo, reference, metadata }),
  });
  const json = (await res.json()) as { status: boolean; message: string; data: { authorization_url: string; reference: string } };
  if (!json.status) throw new Error(json.message || "Paystack initialization failed");
  return json.data;
}

export async function paystackVerify(reference: string): Promise<PaystackTransaction> {
  const res = await fetch(
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
  amountKobo: number
): Promise<{ status: string; reference: string }> {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/charge_authorization`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ authorization_code: authorizationCode, email, amount: amountKobo }),
  });
  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data: { status: string; reference: string };
  };
  if (!json.status) throw new Error(json.message || "Charge authorization failed");
  return json.data;
}
