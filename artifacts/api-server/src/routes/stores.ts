import { Router, type IRouter } from "express";
import { eq, ilike, or, sql } from "drizzle-orm";
import { db, storesTable, productsTable } from "@workspace/db";
import {
  CreateStoreBody,
  UpdateStoreBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stores", async (req, res): Promise<void> => {
  const { category, limit = 20, offset = 0 } = req.query;
  let query = db.select().from(storesTable).$dynamic();
  if (category && typeof category === "string") {
    query = query.where(ilike(storesTable.category, `%${category}%`));
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

  const products = await db.select().from(productsTable).where(eq(productsTable.storeId, storeId));
  res.json({ ...store, products });
});

router.patch("/stores/:storeId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = UpdateStoreBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [store] = await db.update(storesTable).set(parsed.data).where(eq(storesTable.id, storeId)).returning();
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
