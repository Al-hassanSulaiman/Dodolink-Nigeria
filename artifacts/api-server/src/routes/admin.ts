import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq, count, desc, sql } from "drizzle-orm";
import { db, storesTable, productsTable, conversationsTable } from "@workspace/db";
import { AdminRejectStoreBody } from "@workspace/api-zod";

const ADMIN_EMAILS = [
  "alhassansulaiman1369@gmail.com",
  "alhassansulaiman5star@gmail.com",
];

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(userId);
    const emails = user.emailAddresses.map((e: { emailAddress: string }) => e.emailAddress);
    if (!emails.some((e: string) => ADMIN_EMAILS.includes(e))) {
      res.status(403).json({ error: "Forbidden – not an admin account" });
      return;
    }
    next();
  } catch {
    res.status(403).json({ error: "Forbidden" });
  }
}

const router: IRouter = Router();

router.use("/admin", requireAdmin);

router.get("/admin/stores", async (req, res): Promise<void> => {
  const { status, limit = 50, offset = 0 } = req.query;
  let query = db.select().from(storesTable).$dynamic();
  if (status && typeof status === "string") {
    query = query.where(eq(storesTable.verificationStatus, status));
  }
  const stores = await query
    .orderBy(desc(storesTable.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));
  res.json(stores);
});

router.post("/admin/stores/:storeId/verify", async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [store] = await db
    .update(storesTable)
    .set({
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verifiedBy: userId ?? "admin",
      rejectionReason: null,
    })
    .where(eq(storesTable.id, storeId))
    .returning();
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  res.json(store);
});

router.post("/admin/stores/:storeId/reject", async (req, res): Promise<void> => {
  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = AdminRejectStoreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [store] = await db
    .update(storesTable)
    .set({
      verificationStatus: "rejected",
      rejectionReason: parsed.data.reason,
      verifiedAt: null,
      verifiedBy: null,
    })
    .where(eq(storesTable.id, storeId))
    .returning();
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  res.json(store);
});

router.get("/admin/analytics", async (req, res): Promise<void> => {
  const [storeCounts] = await db
    .select({
      total: count(),
      pending: sql<number>`count(*) filter (where ${storesTable.verificationStatus} = 'pending')`,
      verified: sql<number>`count(*) filter (where ${storesTable.verificationStatus} = 'verified')`,
      rejected: sql<number>`count(*) filter (where ${storesTable.verificationStatus} = 'rejected')`,
    })
    .from(storesTable);

  const [{ total: totalProducts }] = await db.select({ total: count() }).from(productsTable);
  const [{ total: totalConversations }] = await db.select({ total: count() }).from(conversationsTable);

  const recentStores = await db
    .select()
    .from(storesTable)
    .orderBy(desc(storesTable.createdAt))
    .limit(5);

  res.json({
    totalStores: Number(storeCounts.total),
    pendingStores: Number(storeCounts.pending),
    verifiedStores: Number(storeCounts.verified),
    rejectedStores: Number(storeCounts.rejected),
    totalProducts: Number(totalProducts),
    totalConversations: Number(totalConversations),
    recentStores,
  });
});

export default router;
