import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getAuth, clerkClient } from "@clerk/express";
import { db, deliveryAgentsTable, deliveryOrdersTable, deliveryDisputesTable } from "@workspace/db";
import { paystackListBanks, paystackResolveAccount, paystackRefund } from "../lib/paystack";
import {
  attemptPayout, finalizePayoutOtp, resendPayoutOtp, getDeliverySettings, setDeliverySetting,
  pushToUser, PAYOUT_MODES,
} from "../lib/deliveryOrders";
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

/** Checks the account number with the bank through Paystack and returns the real account name. */
async function verifyBank(values: { bankCode: string | null; bankAccountNumber: string | null }): Promise<{ name: string | null; error?: string }> {
  if (!values.bankCode && !values.bankAccountNumber) return { name: null };
  if (!values.bankCode || !values.bankAccountNumber) return { name: null, error: "Choose the bank and enter the account number, or leave both empty." };
  if (!/^\d{10}$/.test(values.bankAccountNumber)) return { name: null, error: "The account number must be 10 digits." };
  try {
    return { name: await paystackResolveAccount(values.bankAccountNumber, values.bankCode) };
  } catch {
    return { name: null, error: "Paystack could not verify that account number with that bank." };
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
  const account = await resolveAccount(parsed.data.accountEmail);
  if (account.error) { res.status(400).json({ error: account.error }); return; }
  const bank = await verifyBank(values);
  if (bank.error) { res.status(400).json({ error: bank.error }); return; }
  try {
    const [row] = await db.insert(deliveryAgentsTable)
      .values({ ...values, bankAccountName: bank.name, linkedUserId: account.id, createdBy: getAuth(req).userId ?? null }).returning();
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
  const [current] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, id));
  if (!current) { res.status(404).json({ error: "Delivery company not found" }); return; }
  const bankChanged = current.bankCode !== values.bankCode || current.bankAccountNumber !== values.bankAccountNumber;
  const bank = bankChanged ? await verifyBank(values) : { name: current.bankAccountName };
  if ("error" in bank && bank.error) { res.status(400).json({ error: bank.error }); return; }
  try {
    const [row] = await db.update(deliveryAgentsTable)
      .set({
        ...values, bankAccountName: bank.name,
        ...(bankChanged ? { paystackRecipientCode: null } : {}),
        ...(account.id ? { linkedUserId: account.id } : {}),
      }).where(eq(deliveryAgentsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Delivery company not found" }); return; }
    res.json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "That account is already linked to another delivery person." });
      return;
    }
    throw err;
  }
});

// ---- banks, jobs, payouts, disputes, settings ----

let bankCache: { at: number; banks: Awaited<ReturnType<typeof paystackListBanks>> } | null = null;
deliveryAdminRouter.get("/admin/delivery/banks", async (_req, res): Promise<void> => {
  try {
    if (!bankCache || Date.now() - bankCache.at > 6 * 60 * 60 * 1000) {
      bankCache = { at: Date.now(), banks: await paystackListBanks() };
    }
    res.json(bankCache.banks);
  } catch {
    res.status(502).json({ error: "Could not load the bank list from Paystack." });
  }
});

const REVIEW_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

deliveryAdminRouter.get("/admin/delivery-orders", async (_req, res): Promise<void> => {
  const rows = await db.select({ o: deliveryOrdersTable, companyName: deliveryAgentsTable.name })
    .from(deliveryOrdersTable).innerJoin(deliveryAgentsTable, eq(deliveryAgentsTable.id, deliveryOrdersTable.agentId))
    .orderBy(desc(deliveryOrdersTable.createdAt)).limit(200);
  const openDisputes = rows.length
    ? await db.select({ orderId: deliveryDisputesTable.orderId }).from(deliveryDisputesTable)
        .where(and(eq(deliveryDisputesTable.status, "open"), inArray(deliveryDisputesTable.orderId, rows.map(r => r.o.id))))
    : [];
  const disputed = new Set(openDisputes.map(d => d.orderId));
  const now = Date.now();
  res.json(rows.map(({ o, companyName }) => ({
    id: o.id, companyName, customerId: o.customerId, pickupState: o.pickupState, dropState: o.dropState,
    amountKobo: o.amountKobo, refundKobo: o.refundKobo, platformFeeKobo: o.platformFeeKobo,
    companyReceivesKobo: o.agentAmountKobo, status: o.status, payoutStatus: o.payoutStatus,
    payoutError: o.payoutError, paidAt: o.paidAt, deliveredAt: o.deliveredAt, createdAt: o.createdAt,
    disputeOpen: disputed.has(o.id),
    // Paid but nobody confirmed delivery within 3 days: needs a human decision.
    needsReview: o.status === "paid" && !!o.paidAt && now - o.paidAt.getTime() > REVIEW_AFTER_MS,
  })));
});

deliveryAdminRouter.post("/admin/delivery-orders/:id/payout", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await attemptPayout(id);
  res.status(result.ok ? 200 : 409).json(result);
});

deliveryAdminRouter.post("/admin/delivery-orders/:id/otp", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const otp = String(req.body?.otp ?? "").trim();
  if (!Number.isInteger(id) || id < 1 || !/^\d{4,8}$/.test(otp)) { res.status(400).json({ error: "Enter the code Paystack sent you." }); return; }
  const result = await finalizePayoutOtp(id, otp);
  res.status(result.ok ? 200 : 409).json(result);
});

deliveryAdminRouter.post("/admin/delivery-orders/:id/resend-otp", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await resendPayoutOtp(id);
  res.status(result.ok ? 200 : 409).json(result);
});

deliveryAdminRouter.get("/admin/delivery-disputes", async (_req, res): Promise<void> => {
  const rows = await db.select({ d: deliveryDisputesTable, o: deliveryOrdersTable, companyName: deliveryAgentsTable.name })
    .from(deliveryDisputesTable)
    .innerJoin(deliveryOrdersTable, eq(deliveryOrdersTable.id, deliveryDisputesTable.orderId))
    .innerJoin(deliveryAgentsTable, eq(deliveryAgentsTable.id, deliveryOrdersTable.agentId))
    .orderBy(sql`${deliveryDisputesTable.status} = 'open' desc`, desc(deliveryDisputesTable.createdAt)).limit(100);
  res.json(rows.map(({ d, o, companyName }) => ({
    id: d.id, orderId: o.id, companyName, customerId: o.customerId, openedByRole: d.openedByRole,
    reason: d.reason, status: d.status, resolution: d.resolution, adminNote: d.adminNote, createdAt: d.createdAt,
    amountKobo: o.amountKobo, pickupState: o.pickupState, dropState: o.dropState, orderStatus: o.status, payoutStatus: o.payoutStatus,
  })));
});

const ResolveBody = z.object({
  resolution: z.enum(["pay_company", "refund_customer", "split"]),
  refundNaira: z.number().int().positive().optional(),
  note: z.string().trim().max(500).optional(),
});

deliveryAdminRouter.post("/admin/delivery-disputes/:id/resolve", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const parsed = ResolveBody.safeParse(req.body);
  if (!Number.isInteger(id) || id < 1 || !parsed.success) { res.status(400).json({ error: "Please check the form." }); return; }
  const [dispute] = await db.select().from(deliveryDisputesTable).where(eq(deliveryDisputesTable.id, id));
  if (!dispute || dispute.status !== "open") { res.status(409).json({ error: "This dispute is not open." }); return; }
  const [order] = await db.select().from(deliveryOrdersTable).where(eq(deliveryOrdersTable.id, dispute.orderId));
  if (!order || order.status !== "disputed") { res.status(409).json({ error: "This job is not on hold." }); return; }
  if (["sending", "sent", "paid"].includes(order.payoutStatus)) {
    res.status(409).json({ error: "The company has already been paid, so this cannot be changed here." });
    return;
  }
  const { resolution, note } = parsed.data;
  let refundKobo = 0;
  let nextStatus: "delivered" | "refunded" = "delivered";
  if (resolution !== "pay_company") {
    if (!order.paystackReference) { res.status(409).json({ error: "No payment found for this job." }); return; }
    refundKobo = resolution === "refund_customer" ? order.amountKobo : (parsed.data.refundNaira ?? 0) * 100;
    if (refundKobo <= 0 || refundKobo > order.amountKobo || (resolution === "split" && refundKobo >= order.amountKobo)) {
      res.status(400).json({ error: "Enter how much to refund the customer (less than the full price for a split)." });
      return;
    }
    try {
      await paystackRefund(order.paystackReference, resolution === "refund_customer" ? undefined : refundKobo);
    } catch (err) {
      req.log.error({ err }, "Delivery dispute refund failed");
      res.status(502).json({ error: "Paystack could not process the refund. Nothing was changed." });
      return;
    }
    if (resolution === "refund_customer") nextStatus = "refunded";
  }
  const adminId = getAuth(req).userId ?? null;
  await db.transaction(async tx => {
    await tx.update(deliveryOrdersTable).set({
      status: nextStatus, refundKobo,
      deliveredAt: nextStatus === "delivered" ? (order.deliveredAt ?? new Date()) : order.deliveredAt,
      payoutStatus: nextStatus === "refunded" ? "none" : (order.payoutStatus === "none" ? "queued" : order.payoutStatus),
    }).where(eq(deliveryOrdersTable.id, order.id));
    await tx.update(deliveryDisputesTable).set({
      status: "resolved", resolution, adminNote: note || null, resolvedBy: adminId, resolvedAt: new Date(),
    }).where(eq(deliveryDisputesTable.id, id));
  });
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, order.agentId));
  const message = `DodoLink reviewed problem on job #${order.id}: ${
    resolution === "pay_company" ? "payment goes to the delivery company." :
    resolution === "refund_customer" ? "the customer is refunded." : "the payment is split."}`;
  void pushToUser(order.customerId, "Problem resolved", message, { deliveryOrderId: order.id });
  void pushToUser(agent?.linkedUserId, "Problem resolved", message, { deliveryOrderId: order.id });
  const settings = await getDeliverySettings();
  if (nextStatus === "delivered" && settings.payoutMode === "automatic" && !settings.payoutsPaused) {
    void attemptPayout(order.id);
  }
  res.json({ status: "resolved" });
});

deliveryAdminRouter.get("/admin/delivery-settings", async (_req, res): Promise<void> => {
  res.json(await getDeliverySettings());
});

deliveryAdminRouter.put("/admin/delivery-settings", async (req, res): Promise<void> => {
  const mode = req.body?.payoutMode;
  const paused = req.body?.payoutsPaused;
  if (mode !== undefined) {
    if (!(PAYOUT_MODES as readonly string[]).includes(mode)) { res.status(400).json({ error: "Invalid payout mode" }); return; }
    await setDeliverySetting("payout_mode", mode);
  }
  if (paused !== undefined) {
    if (typeof paused !== "boolean") { res.status(400).json({ error: "Invalid pause value" }); return; }
    await setDeliverySetting("payouts_paused", String(paused));
  }
  res.json(await getDeliverySettings());
});

