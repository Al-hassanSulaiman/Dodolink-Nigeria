import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { activateFromWebhook } from "../lib/subscriptionBilling";

const router: IRouter = Router();

/**
 * Paystack webhook: activates subscriptions server-side even when the payer
 * closes the app before returning from checkout. Paystack signs the raw JSON
 * body with HMAC-SHA512 using the secret key.
 *
 * Always responds 200 for valid signatures (even for events we ignore) so
 * Paystack doesn't retry forever; invalid signatures get 401.
 */
router.post("/webhooks/paystack", async (req, res): Promise<void> => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = req.header("x-paystack-signature");
  const rawBody: Buffer | undefined = (req as any).rawBody;

  if (!secret || !signature || !rawBody) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const event = req.body as {
    event?: string;
    data?: {
      reference?: string;
      amount?: number;
      currency?: string;
      status?: string;
      authorization?: { authorization_code?: string; reusable?: boolean };
      customer?: { customer_code?: string };
    };
  };

  if (event.event !== "charge.success" || !event.data?.reference) {
    res.json({ received: true });
    return;
  }

  const { reference, amount, currency, authorization, customer } = event.data;
  if (!reference.startsWith("dodolink_sub_") && !reference.startsWith("dodolink_auto_")) {
    res.json({ received: true });
    return;
  }

  try {
    const result = await activateFromWebhook({
      reference,
      amountKobo: amount ?? 0,
      currency,
      authCode: authorization?.reusable ? authorization.authorization_code : null,
      customerCode: customer?.customer_code ?? null,
    });
    req.log.info({ reference, result }, "Paystack webhook processed");
  } catch (err) {
    req.log.error({ err, reference }, "Paystack webhook processing failed");
    // Respond 500 so Paystack retries later.
    res.status(500).json({ error: "Processing failed" });
    return;
  }

  res.json({ received: true });
});

export default router;
