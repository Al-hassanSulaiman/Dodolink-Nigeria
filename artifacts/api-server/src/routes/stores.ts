import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq, ilike, and, or, sql } from "drizzle-orm";
import { db, storesTable, productsTable } from "@workspace/db";
import {
  CreateStoreBody,
  UpdateStoreBody,
} from "@workspace/api-zod";
import { visibleStoresFilter, isStoreHidden } from "../lib/storeSubscription";

const router: IRouter = Router();

router.get("/stores", async (req, res): Promise<void> => {
  const { category, limit = 20, offset = 0, ownerUserId } = req.query;

  // Build visibility filter: always show, but include the requesting owner's hidden store
  const visFilter = visibleStoresFilter();
  const ownerFilter = typeof ownerUserId === "string" ? eq(storesTable.ownerUserId, ownerUserId) : undefined;
  const accessFilter = ownerFilter ? or(visFilter, ownerFilter) : visFilter;

  let query = db.select().from(storesTable).$dynamic();
  if (category && typeof category === "string") {
    query = query.where(and(accessFilter, ilike(storesTable.category, `%${category}%`)));
  } else {
    query = query.where(accessFilter);
  }

  const stores = await query.limit(Number(limit)).offset(Number(offset)).orderBy(storesTable.createdAt);
  res.json(stores);
});

router.post("/stores", async (req, res): Promise<void> => {
  const parsed = CreateStoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [store] = await db.insert(storesTable).values(parsed.data).returning();
  res.status(201).json(store);
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
  res.json({ ...store, products });
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

  if (Object.keys(updates).length === 0) {
    res.json(existing);
    return;
  }

  const [store] = await db.update(storesTable).set(updates).where(eq(storesTable.id, storeId)).returning();
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  res.json(store);
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
