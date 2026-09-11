import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, ilike, and, sql, inArray } from "drizzle-orm";
import { db, storesTable, productsTable, conversationsTable, messagesTable } from "@workspace/db";
import {
  CreateStoreBody,
  UpdateStoreBody,
} from "@workspace/api-zod";
import { visibleStoresFilter, isStoreHidden } from "../lib/storeSubscription";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import {
  findVerifiedStoreNameConflict,
  isVerifiedStoreNameUniqueViolation,
  STORE_NAME_ALREADY_EXISTS,
} from "../lib/storeName";

const storeCreateLimit = rateLimit({ name: "store-create", max: 5, windowMs: 60 * 60 * 1000 });

const router: IRouter = Router();

/**
 * Strip internal payment credentials before sending a store to any public
 * endpoint.  These fields must never leave the server — they can be used to
 * charge a seller's saved card.
 */
function toPublicStore<T extends Record<string, unknown>>(store: T) {
  const { paystackAuthCode, paystackCustomerCode, paystackEmail, ...pub } = store as any;
  return pub as Omit<T, "paystackAuthCode" | "paystackCustomerCode" | "paystackEmail">;
}

router.get("/stores", async (req, res): Promise<void> => {
  const { category, limit = 20, offset = 0, ownerUserId } = req.query;

  // When filtering by owner, hidden stores are only included when the caller
  // IS that owner (so owners can always reach their own store to pay). Anyone
  // else asking for a specific owner's stores still gets the public
  // visibility filter applied — otherwise hidden/pending/rejected store data
  // would be enumerable by unauthenticated callers.
  const visFilter = visibleStoresFilter();
  const ownerFilter = typeof ownerUserId === "string" ? eq(storesTable.ownerUserId, ownerUserId) : undefined;
  const { userId: callerId } = getAuth(req);
  const isOwnerRequest = ownerFilter !== undefined && callerId != null && callerId === ownerUserId;
  const accessFilter = isOwnerRequest ? ownerFilter : ownerFilter ? and(ownerFilter, visFilter) : visFilter;

  let query = db.select().from(storesTable).$dynamic();
  if (category && typeof category === "string") {
    query = query.where(and(accessFilter, ilike(storesTable.category, `%${category}%`)));
  } else {
    query = query.where(accessFilter);
  }

  const stores = await query.limit(Number(limit)).offset(Number(offset)).orderBy(storesTable.createdAt);
  res.json(stores.map(toPublicStore));
});

router.post("/stores", storeCreateLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const parsed = CreateStoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // A user can only own one store
  const [existing] = await db
    .select({ id: storesTable.id })
    .from(storesTable)
    .where(eq(storesTable.ownerUserId, userId));
  if (existing) {
    res.status(409).json({ error: "You already have a store" });
    return;
  }

  if (await findVerifiedStoreNameConflict(parsed.data.name)) {
    res.status(409).json(STORE_NAME_ALREADY_EXISTS);
    return;
  }

  // Never trust ownerUserId from the client — always bind to the authenticated user
  const [store] = await db
    .insert(storesTable)
    .values({ ...parsed.data, ownerUserId: userId })
    .returning();
  res.status(201).json(toPublicStore(store));
});

router.get("/stores/:storeId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  // Hidden stores are invisible to the public (owner can still see via /subscription)
  if (isStoreHidden(store)) {
    res.status(404).json({ error: "Store not found" });
    return;
  }

  const products = await db.select().from(productsTable).where(eq(productsTable.storeId, storeId));
  res.json({ ...toPublicStore(store), products });
});

router.patch("/stores/:storeId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = UpdateStoreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!existing) { res.status(404).json({ error: "Store not found" }); return; }

  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }
  if (existing.ownerUserId !== userId) {
    res.status(403).json({ error: "Only the store owner can edit this store" });
    return;
  }

  const updates = { ...parsed.data };
  if (existing.detailsLockedByAdmin) {
    const changingName = updates.name !== undefined && updates.name !== existing.name;
    const changingLocation = updates.location !== undefined && updates.location !== existing.location;
    if (changingName || changingLocation) {
      res.status(403).json({
        error: "Store name and location were set by an admin and can no longer be changed",
      });
      return;
    }
    delete updates.name;
    delete updates.location;
  }

  if (
    updates.name !== undefined &&
    updates.name !== existing.name &&
    await findVerifiedStoreNameConflict(updates.name, storeId)
  ) {
    res.status(409).json(STORE_NAME_ALREADY_EXISTS);
    return;
  }

  if (Object.keys(updates).length === 0) {
    res.json(toPublicStore(existing));
    return;
  }

  let store;
  try {
    [store] = await db.update(storesTable).set(updates).where(eq(storesTable.id, storeId)).returning();
  } catch (error) {
    if (isVerifiedStoreNameUniqueViolation(error)) {
      res.status(409).json(STORE_NAME_ALREADY_EXISTS);
      return;
    }
    throw error;
  }
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  // When the store name changes, backfill senderName on all existing retailer
  // messages so conversation history and future notification titles stay consistent.
  if (updates.name !== undefined && updates.name !== existing.name) {
    const storeConvs = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(eq(conversationsTable.storeId, storeId));
    if (storeConvs.length > 0) {
      const convIds = storeConvs.map(c => c.id);
      await db
        .update(messagesTable)
        .set({ senderName: updates.name })
        .where(
          and(
            inArray(messagesTable.conversationId, convIds),
            eq(messagesTable.senderType, "retailer"),
          )
        );
    }
  }

  res.json(toPublicStore(store));
});

router.get("/stores/:storeId/stats", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [store] = await db.select().from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  const totalProductsResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(productsTable)
    .where(eq(productsTable.storeId, storeId));
  const totalProducts = Number(totalProductsResult[0]?.count ?? 0);

  const { reviewsTable } = await import("@workspace/db");
  const allReviews = await db.select({ rating: reviewsTable.rating }).from(reviewsTable).where(eq(reviewsTable.storeId, storeId));
  const ratingBreakdown = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as Record<string, number>;
  for (const r of allReviews) {
    const key = String(r.rating);
    if (key in ratingBreakdown) ratingBreakdown[key]++;
  }

  res.json({
    storeId,
    avgRating: store.avgRating,
    totalReviews: store.totalReviews,
    totalProducts,
    ratingBreakdown,
  });
});

export default router;
