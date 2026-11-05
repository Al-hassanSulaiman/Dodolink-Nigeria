import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { activateFromWebhook } from "../lib/subscriptionBilling";
import { DELIVERY_REFERENCE_PREFIX, activateAgentForReference } from "../lib/deliverySubscription";
import { and, eq } from "drizzle-orm";
import { db, deliveryOrdersTable } from "@workspace/db";
import { markDeliveryOrderPaid } from "../lib/deliveryOrders";

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
      fees?: number;
    };
  };

  // Delivery payouts: Paystack reports the final result of each transfer.
  if (event.event === "transfer.success" || event.event === "transfer.failed" || event.event === "transfer.reversed") {
    const transferRef = event.data?.reference;
    if (transferRef?.startsWith("delpay_")) {
      const done = event.event === "transfer.success";
      await db.update(deliveryOrdersTable).set({
        payoutStatus: done ? "paid" : "failed",
        payoutNote: done ? null : `Paystack reported: ${event.event}`,
      }).where(and(eq(deliveryOrdersTable.transferReference, transferRef)));
    }
    res.json({ received: true });
    return;
  }

  // Delivery payments are recognised by their reference prefix; store subscriptions are untouched.
  if (event.event === "charge.success" && event.data?.reference?.startsWith("del_")) {
    try {
      const result = await markDeliveryOrderPaid({
        reference: event.data.reference, amountKobo: event.data.amount ?? 0, feesKobo: event.data.fees ?? 0,
      });
      req.log.info({ reference: event.data.reference, result }, "Delivery payment webhook processed");
    } catch (err) {
      req.log.error({ err }, "Delivery payment webhook failed");
      res.status(500).json({ error: "Processing failed" });
      return;
    }
    res.json({ received: true });
    return;
  }

  // Delivery company subscriptions.
  if (event.event === "charge.success" && event.data?.reference?.startsWith(DELIVERY_REFERENCE_PREFIX)) {
    try {
      const result = await activateAgentForReference({
        reference: event.data.reference, amountKobo: event.data.amount ?? 0, currency: event.data.currency,
      });
      req.log.info({ reference: event.data.reference, result }, "Delivery subscription webhook processed");
    } catch (err) {
      req.log.error({ err }, "Delivery subscription webhook failed");
      res.status(500).json({ error: "Processing failed" });
      return;
    }
    res.json({ received: true });
    return;
  }

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
