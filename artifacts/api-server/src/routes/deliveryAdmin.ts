import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getAuth, clerkClient } from "@clerk/express";
import { db, deliveryAgentsTable } from "@workspace/db";
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
  try {
    const [row] = await db.insert(deliveryAgentsTable)
      .values({ ...values, linkedUserId: account.id, createdBy: getAuth(req).userId ?? null }).returning();
    res.status(201).json(row);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
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
  try {
    const [row] = await db.update(deliveryAgentsTable)
      .set({ ...values, ...(account.id ? { linkedUserId: account.id } : {}) }).where(eq(deliveryAgentsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Delivery person not found" }); return; }
    res.json(row);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "That account is already linked to another delivery person." });
      return;
    }
    throw err;
  }
});
