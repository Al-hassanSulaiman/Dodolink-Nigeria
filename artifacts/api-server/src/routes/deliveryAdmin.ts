import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getAuth, clerkClient } from "@clerk/express";
import { db, deliveryAgentsTable, deliveryOrdersTable, deliveryDisputesTable } from "@workspace/db";
import {
  paystackListBanks, paystackResolveAccount, paystackCreateRecipient, paystackInitiateTransfer,
  paystackFinalizeTransfer, paystackResendTransferOtp, paystackRefund,
} from "../lib/paystack";
import { quote, orderIsStale } from "../lib/deliveryMoney";
import { pushToUser } from "../lib/deliveryOrders";
import { DELIVERY_TYPES, validateCoverage } from "../lib/nigerianStates";

// Mounted inside admin.ts AFTER its admin-only guard, so every route here is admin-only.
export const deliveryAdminRouter: IRouter = Router();

const text = (max: number) => z.string().trim().max(max);
const AgentBody = z.object({
  name: text(80).min(2),
  phone: text(30).min(7),
  imageUrl: text(500).nullish(),
  bio: text(500).nullish(),
  accountEmail: text(200).nullish(),
  deliveryType: z.enum(DELIVERY_TYPES),
  homeState: text(40).nullish(),
  coveredStates: z.array(text(40)).max(40).default([]),
  nationwide: z.boolean().default(false),
  bankName: text(80).nullish(),
  bankCode: text(20).nullish(),
  bankAccountNumber: text(20).nullish(),
  bankAccountName: text(120).nullish(),
  active: z.boolean().default(true),
});

async function resolveAccount(email: string | null | undefined): Promise<{ id: string | null; error?: string }> {
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed) return { id: null };
  try {
    const found = await clerkClient.users.getUserList({ emailAddress: [trimmed], limit: 1 });
    const user = found.data[0];
    if (!user) return { id: null, error: "No DodoLink account has that email. Ask him to sign up in the app first." };
    return { id: user.id };
  } catch {
    return { id: null, error: "Could not look up that email right now. Try again." };
  }
}

// With a bank and account number, ask Paystack who owns the account so a typo can never send money elsewhere.
async function verifyBank(values: { bankCode: string | null; bankAccountNumber: string | null }):
  Promise<{ set: Record<string, unknown>; error?: string }> {
  if (!values.bankCode && !values.bankAccountNumber) return { set: { paystackRecipientCode: null } };
  if (!values.bankCode || !values.bankAccountNumber) return { set: {}, error: "Choose the bank and enter the account number." };
  if (!/^\d{10}$/.test(values.bankAccountNumber)) return { set: {}, error: "The account number must be 10 digits." };
  try {
    const resolved = await paystackResolveAccount(values.bankAccountNumber, values.bankCode);
    return { set: { bankAccountName: resolved.account_name, paystackRecipientCode: null } };
  } catch {
    return { set: {}, error: "Paystack could not verify this bank account. Check the bank and number." };
  }
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function clean(body: z.infer<typeof AgentBody>) {
  const intra = body.deliveryType === "intrastate";
  return {
    name: body.name, phone: body.phone,
    imageUrl: body.imageUrl || null, bio: body.bio || null,
    deliveryType: body.deliveryType,
    homeState: body.homeState || null,
    // An intrastate person does not travel between states, so no interstate coverage is stored.
    coveredStates: intra ? [] : [...new Set(body.coveredStates)],
    nationwide: intra ? false : body.nationwide,
    bankName: body.bankName || null,
    bankCode: body.bankCode || null,
    bankAccountNumber: body.bankAccountNumber || null,
    bankAccountName: body.bankAccountName || null,
    active: body.active,
  };
}

deliveryAdminRouter.get("/admin/delivery-agents", async (_req, res): Promise<void> => {
  const rows = await db.select().from(deliveryAgentsTable).orderBy(desc(deliveryAgentsTable.createdAt));
  res.json(rows);
});

deliveryAdminRouter.post("/admin/delivery-agents", async (req, res): Promise<void> => {
  const parsed = AgentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Please check the form: " + parsed.error.issues[0]?.message }); return; }
  const values = clean(parsed.data);
  const coverageError = validateCoverage(values as Parameters<typeof validateCoverage>[0]);
  if (coverageError) { res.status(400).json({ error: coverageError }); return; }
  if (!parsed.data.accountEmail?.trim()) { res.status(400).json({ error: "Enter the email the company will log in with." }); return; }
  const account = await resolveAccount(parsed.data.accountEmail);
  if (account.error) { res.status(400).json({ error: account.error }); return; }
  const bank = await verifyBank(values);
  if (bank.error) { res.status(400).json({ error: bank.error }); return; }
  try {
    const [row] = await db.insert(deliveryAgentsTable)
      .values({ ...values, ...bank.set, linkedUserId: account.id, createdBy: getAuth(req).userId ?? null }).returning();
    res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "That account is already linked to another delivery person." });
      return;
    }
    throw err;
  }
});

deliveryAdminRouter.patch("/admin/delivery-agents/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = AgentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Please check the form: " + parsed.error.issues[0]?.message }); return; }
  const values = clean(parsed.data);
  const coverageError = validateCoverage(values as Parameters<typeof validateCoverage>[0]);
  if (coverageError) { res.status(400).json({ error: coverageError }); return; }
  const account = await resolveAccount(parsed.data.accountEmail);
  if (account.error) { res.status(400).json({ error: account.error }); return; }
  const [existing] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Company not found" }); return; }
  const bankChanged = existing.bankAccountNumber !== values.bankAccountNumber || existing.bankCode !== values.bankCode;
  const bank = bankChanged ? await verifyBank(values) : { set: {} as Record<string, unknown> };
  if ("error" in bank && bank.error) { res.status(400).json({ error: bank.error }); return; }
  try {
    const [row] = await db.update(deliveryAgentsTable)
      .set({ ...values, ...bank.set, ...(account.id ? { linkedUserId: account.id } : {}) }).where(eq(deliveryAgentsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Delivery person not found" }); return; }
    res.json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "That account is already linked to another delivery person." });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Banks, jobs, payouts and disputes
// ---------------------------------------------------------------------------

let bankCache: { at: number; banks: { name: string; code: string }[] } | null = null;
deliveryAdminRouter.get("/admin/delivery-banks", async (_req, res): Promise<void> => {
  try {
    if (!bankCache || Date.now() - bankCache.at > 6 * 60 * 60 * 1000) {
      bankCache = { at: Date.now(), banks: await paystackListBanks() };
    }
    res.json(bankCache.banks);
  } catch {
    res.status(502).json({ error: "Could not load the bank list from Paystack." });
  }
});

deliveryAdminRouter.get("/admin/delivery-orders", async (req, res): Promise<void> => {
  const rows = await db.select({ order: deliveryOrdersTable, agentName: deliveryAgentsTable.name })
    .from(deliveryOrdersTable).innerJoin(deliveryAgentsTable, eq(deliveryAgentsTable.id, deliveryOrdersTable.agentId))
    .orderBy(desc(deliveryOrdersTable.createdAt)).limit(200);
  const ids = rows.map(r => r.order.id);
  const disputes = ids.length
    ? await db.select().from(deliveryDisputesTable).where(inArray(deliveryDisputesTable.orderId, ids)).orderBy(desc(deliveryDisputesTable.createdAt))
    : [];
  res.json(rows.map(({ order, agentName }) => {
    const q = quote(order.amountKobo, order.paystackFeeKobo > 0 ? order.paystackFeeKobo : undefined, order.refundedKobo);
    return {
      id: order.id, company: agentName, status: order.status, payoutStatus: order.payoutStatus,
      amountKobo: order.amountKobo, platformFeeKobo: q.platformFeeKobo, companyReceivesKobo: q.agentAmountKobo,
      refundedKobo: order.refundedKobo, pickupState: order.pickupState, dropState: order.dropState,
      description: order.description, paidAt: order.paidAt, deliveredAt: order.deliveredAt, createdAt: order.createdAt,
      payoutNote: order.payoutNote,
      needsReview: orderIsStale(order.paidAt, order.status),
      disputes: disputes.filter(d => d.orderId === order.id),
    };
  }));
});

type Row = typeof deliveryOrdersTable.$inferSelect;
async function getOrder(req: { params: { id?: string | string[] } }): Promise<Row | null> {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!Number.isInteger(id) || id < 1) return null;
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, id));
  return order ?? null;
}
function isTransient(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return e?.name === "TimeoutError" || e?.name === "AbortError" || e?.name === "TypeError" || /^Paystack HTTP 5/.test(e?.message ?? "");
}

// Step 1: start the transfer. With OTP on, Paystack then waits for the admin's code.
deliveryAdminRouter.post("/admin/delivery-orders/:id/payout", async (req, res): Promise<void> => {
  const order = await getOrder(req);
  if (!order) { res.status(404).json({ error: "Job not found" }); return; }
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
  if (!agent?.bankCode || !agent.bankAccountNumber) { res.status(400).json({ error: "This company has no verified bank account." }); return; }
  const reference = `delpay_${order.id}_${Date.now().toString(36)}`;
  // Claim the payout atomically so two clicks can never start two transfers.
  const claimed = await db.update(deliveryOrdersTable).set({ payoutStatus: "starting", transferReference: reference, payoutNote: null })
    .where(and(
      eq(deliveryOrdersTable.id, order.id), eq(deliveryOrdersTable.status, "delivered"),
      sql`${deliveryOrdersTable.payoutStatus} in ('pending', 'failed')`,
    )).returning();
  if (!claimed.length) { res.status(409).json({ error: "This job is not ready for payout (or already started)." }); return; }
  const payable = quote(order.amountKobo, order.paystackFeeKobo > 0 ? order.paystackFeeKobo : undefined, order.refundedKobo).agentAmountKobo;
  if (payable < 100) {
    await db.update(deliveryOrdersTable).set({ payoutStatus: "failed", payoutNote: "Nothing left to pay out" }).where(eq(deliveryOrdersTable.id, order.id));
    res.status(400).json({ error: "Nothing left to pay out after fees." });
    return;
  }
  try {
    let recipient = agent.paystackRecipientCode;
    if (!recipient) {
      recipient = (await paystackCreateRecipient(agent.bankAccountName || agent.name, agent.bankAccountNumber, agent.bankCode)).recipient_code;
      await db.update(deliveryAgentsTable).set({ paystackRecipientCode: recipient }).where(eq(deliveryAgentsTable.id, agent.id));
    }
    const transfer = await paystackInitiateTransfer(payable, recipient, reference, `DodoLink delivery #${order.id}`);
    const next = transfer.status === "otp" ? "awaiting_otp" : transfer.status === "success" ? "paid" : "processing";
    await db.update(deliveryOrdersTable).set({ payoutStatus: next, transferCode: transfer.transfer_code, agentAmountKobo: payable })
      .where(eq(deliveryOrdersTable.id, order.id));
    res.json({ payoutStatus: next, message: next === "awaiting_otp" ? "Paystack sent you a code. Enter it to release the money." : "Transfer started." });
  } catch (err) {
    if (isTransient(err)) {
      // We cannot know whether Paystack created the transfer. Never retry blindly.
      await db.update(deliveryOrdersTable).set({ payoutNote: "No clear answer from Paystack. Check the Paystack dashboard before retrying." })
        .where(eq(deliveryOrdersTable.id, order.id));
      res.status(502).json({ error: "No clear answer from Paystack. Check your Paystack dashboard for this transfer before trying again." });
      return;
    }
    await db.update(deliveryOrdersTable).set({ payoutStatus: "failed", payoutNote: (err as Error).message.slice(0, 200) })
      .where(eq(deliveryOrdersTable.id, order.id));
    res.status(502).json({ error: (err as Error).message });
  }
});

// Step 2: the admin types the OTP that Paystack sent.
deliveryAdminRouter.post("/admin/delivery-orders/:id/payout/otp", async (req, res): Promise<void> => {
  const order = await getOrder(req);
  if (!order || order.payoutStatus !== "awaiting_otp" || !order.transferCode) { res.status(409).json({ error: "No payout is waiting for a code." }); return; }
  const otp = String(req.body?.otp ?? "").trim();
  if (!/^\d{4,8}$/.test(otp)) { res.status(400).json({ error: "Enter the numeric code Paystack sent you." }); return; }
  try {
    const result = await paystackFinalizeTransfer(order.transferCode, otp);
    const next = result.status === "success" ? "paid" : "processing";
    await db.update(deliveryOrdersTable).set({ payoutStatus: next }).where(eq(deliveryOrdersTable.id, order.id));
    res.json({ payoutStatus: next });
  } catch (err) {
    // A wrong code is safe to retry; the transfer stays waiting.
    res.status(400).json({ error: (err as Error).message });
  }
});

deliveryAdminRouter.post("/admin/delivery-orders/:id/payout/resend-otp", async (req, res): Promise<void> => {
  const order = await getOrder(req);
  if (!order || order.payoutStatus !== "awaiting_otp" || !order.transferCode) { res.status(409).json({ error: "No payout is waiting for a code." }); return; }
  try { await paystackResendTransferOtp(order.transferCode); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ error: (err as Error).message }); }
});

// After a payout with no clear answer, the admin checks Paystack and records the truth here.
deliveryAdminRouter.post("/admin/delivery-orders/:id/payout/mark", async (req, res): Promise<void> => {
  const order = await getOrder(req);
  const outcome = req.body?.outcome;
  if (!order || order.payoutStatus !== "starting" || (outcome !== "paid" && outcome !== "failed")) {
    res.status(409).json({ error: "Only a payout with an unclear result can be marked." });
    return;
  }
  await db.update(deliveryOrdersTable).set({ payoutStatus: outcome, payoutNote: `Marked ${outcome} by admin after checking Paystack` })
    .where(eq(deliveryOrdersTable.id, order.id));
  res.json({ payoutStatus: outcome });
});

// Dispute decision: pay the company, refund the customer, or split.
deliveryAdminRouter.post("/admin/delivery-orders/:id/resolve", async (req, res): Promise<void> => {
  const order = await getOrder(req);
  if (!order || order.status !== "disputed") { res.status(409).json({ error: "This job has no open dispute." }); return; }
  const action = req.body?.action;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : "";
  const adminId = getAuth(req).userId ?? "admin";
  let refundKobo = 0;
  if (action === "refund_customer") refundKobo = order.amountKobo;
  else if (action === "split") {
    refundKobo = Math.round(Number(req.body?.refundNaira) * 100);
    if (!Number.isFinite(refundKobo) || refundKobo <= 0 || refundKobo >= order.amountKobo) {
      res.status(400).json({ error: "For a split, the refund must be more than 0 and less than the full price." });
      return;
    }
  } else if (action !== "pay_agent") { res.status(400).json({ error: "Choose an action." }); return; }

  if (refundKobo > 0) {
    if (!order.paystackReference) { res.status(400).json({ error: "This job has no payment to refund." }); return; }
    try { await paystackRefund(order.paystackReference, action === "refund_customer" ? undefined : refundKobo); }
    catch (err) { res.status(502).json({ error: `Paystack refused the refund: ${(err as Error).message}` }); return; }
  }
  const full = action === "refund_customer";
  await db.transaction(async tx => {
    await tx.update(deliveryOrdersTable).set(full
      ? { status: "refunded", payoutStatus: "none", refundedKobo: order.amountKobo, payoutNote: note || "Refunded to customer" }
      : { status: "delivered", payoutStatus: "pending", deliveredAt: order.deliveredAt ?? new Date(), refundedKobo: refundKobo, payoutNote: note || null })
      .where(eq(deliveryOrdersTable.id, order.id));
    await tx.update(deliveryDisputesTable).set({ status: "resolved", resolution: `${action}${note ? `: ${note}` : ""}`, resolvedBy: adminId, resolvedAt: new Date() })
      .where(and(eq(deliveryDisputesTable.orderId, order.id), eq(deliveryDisputesTable.status, "open")));
  });
  await pushToUser(order.customerId, "Delivery dispute decided", `DodoLink support has decided job #${order.id}.`);
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
  await pushToUser(agent?.linkedUserId, "Delivery dispute decided", `DodoLink support has decided job #${order.id}.`);
  res.json({ status: full ? "refunded" : "delivered" });
});
