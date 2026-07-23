import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { and, asc, eq, count, desc, sql, inArray } from "drizzle-orm";
import { db, storesTable, productsTable, conversationsTable, supportMessagesTable, pushTokensTable } from "@workspace/db";
import { AdminRejectStoreBody, AdminUpdateStoreBody, SendSupportMessageBody } from "@workspace/api-zod";
import { notifyTokens } from "../lib/push";

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

router.patch("/admin/stores/:storeId", async (req, res): Promise<void> => {
  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = AdminUpdateStoreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { name, location } = parsed.data;
  if (name === undefined && location === undefined) {
    res.status(400).json({ error: "Provide a name and/or location to update" });
    return;
  }

  const [store] = await db
    .update(storesTable)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(location !== undefined ? { location } : {}),
      detailsLockedByAdmin: true,
    })
    .where(eq(storesTable.id, storeId))
    .returning();
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  res.json(store);
});

router.post("/admin/stores/:storeId/hide", async (req, res): Promise<void> => {
  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [store] = await db
    .update(storesTable)
    .set({ hiddenByAdmin: true })
    .where(eq(storesTable.id, storeId))
    .returning();
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  res.json(store);
});

router.post("/admin/stores/:storeId/restore", async (req, res): Promise<void> => {
  const storeId = parseInt(req.params.storeId, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [store] = await db
    .update(storesTable)
    .set({ hiddenByAdmin: false })
    .where(eq(storesTable.id, storeId))
    .returning();
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }
  res.json(store);
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

const ACTIVE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

router.get("/admin/users", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const statusFilter = req.query.status as string | undefined;

  // Fetch all users from Clerk
  const { data: clerkUsers } = await clerkClient.users.getUserList({ limit });

  // Fetch all stores keyed by ownerUserId for enrichment
  const ownerIds = clerkUsers.map((u) => u.id);
  const stores =
    ownerIds.length > 0
      ? await db
          .select({
            ownerUserId: storesTable.ownerUserId,
            name: storesTable.name,
            verificationStatus: storesTable.verificationStatus,
          })
          .from(storesTable)
          .where(inArray(storesTable.ownerUserId, ownerIds))
      : [];

  const storeByOwner = new Map(stores.map((s) => [s.ownerUserId, s]));
  const now = Date.now();

  const users = clerkUsers.map((u) => {
    const store = storeByOwner.get(u.id);
    const isActive = u.lastActiveAt != null && now - u.lastActiveAt < ACTIVE_THRESHOLD_MS;
    return {
      id: u.id,
      email: u.emailAddresses[0]?.emailAddress ?? "",
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      imageUrl: u.imageUrl,
      createdAt: u.createdAt,
      lastActiveAt: u.lastActiveAt ?? null,
      isActive,
      hasStore: !!store,
      storeVerified: store?.verificationStatus === "verified",
      storeName: store?.name ?? null,
    };
  });

  const filtered =
    statusFilter === "active"
      ? users.filter((u) => u.isActive)
      : statusFilter === "inactive"
        ? users.filter((u) => !u.isActive)
        : users;

  res.json(filtered);
});

router.get("/admin/support/threads", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(supportMessagesTable)
    .orderBy(desc(supportMessagesTable.createdAt));

  const threads = new Map<
    string,
    { userId: string; userName: string; userEmail: string | null; lastMessage: string; lastMessageAt: Date; unreadCount: number; isSeller: boolean }
  >();

  for (const m of rows) {
    let thread = threads.get(m.userId);
    if (!thread) {
      thread = {
        userId: m.userId,
        userName: m.userName,
        userEmail: m.userEmail,
        lastMessage: m.body,
        lastMessageAt: m.createdAt,
        unreadCount: 0,
        isSeller: false,
      };
      threads.set(m.userId, thread);
    }
    if (m.senderRole === "user" && !m.readByAdmin) thread.unreadCount += 1;
  }

  const userIds = [...threads.keys()];
  if (userIds.length > 0) {
    const sellerRows = await db
      .select({ ownerUserId: storesTable.ownerUserId })
      .from(storesTable)
      .where(inArray(storesTable.ownerUserId, userIds));
    for (const s of sellerRows) {
      const thread = threads.get(s.ownerUserId);
      if (thread) thread.isSeller = true;
    }
  }

  res.json([...threads.values()]);
});

router.get("/admin/support/threads/:userId/messages", async (req, res): Promise<void> => {
  const targetUserId = req.params.userId;
  const messages = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.userId, targetUserId))
    .orderBy(asc(supportMessagesTable.createdAt));
  res.json(messages);
});

router.post("/admin/support/threads/:userId/messages", async (req, res): Promise<void> => {
  const targetUserId = req.params.userId;

  const parsed = SendSupportMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const body = parsed.data.body.trim();
  if (!body) { res.status(400).json({ error: "Message cannot be empty" }); return; }

  const [latest] = await db
    .select()
    .from(supportMessagesTable)
    .where(eq(supportMessagesTable.userId, targetUserId))
    .orderBy(desc(supportMessagesTable.createdAt))
    .limit(1);
  if (!latest) { res.status(404).json({ error: "No support thread for this user" }); return; }

  const [message] = await db
    .insert(supportMessagesTable)
    .values({
      userId: targetUserId,
      userName: latest.userName,
      userEmail: latest.userEmail,
      senderRole: "admin",
      body,
      readByAdmin: true,
      readByUser: false,
    })
    .returning();

  try {
    const tokens = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, targetUserId));
    await notifyTokens(tokens.map((t) => t.token), "Dodolink Support", body, { support: true });
  } catch (err) {
    req.log.warn({ err }, "Failed to send support reply push notification");
  }

  res.status(201).json(message);
});

router.post("/admin/support/threads/:userId/read", async (req, res): Promise<void> => {
  const targetUserId = req.params.userId;
  await db
    .update(supportMessagesTable)
    .set({ readByAdmin: true })
    .where(and(eq(supportMessagesTable.userId, targetUserId), eq(supportMessagesTable.senderRole, "user")));
  res.json({ status: "ok" });
});

export default router;
