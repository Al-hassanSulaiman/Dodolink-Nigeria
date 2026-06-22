import { Router, type IRouter } from "express";
import { eq, avg, count, sql } from "drizzle-orm";
import { db, reviewsTable, storesTable } from "@workspace/db";
import { CreateReviewBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stores/:storeId/reviews", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.storeId, storeId));
  res.json(reviews);
});

router.post("/stores/:storeId/reviews", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const parsed = CreateReviewBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  if (parsed.data.rating < 1 || parsed.data.rating > 5) {
    res.status(400).json({ error: "Rating must be between 1 and 5" });
    return;
  }

  const [review] = await db.insert(reviewsTable).values({ ...parsed.data, storeId }).returning();

  // Recalculate avg rating
  const stats = await db
    .select({ avgRating: avg(reviewsTable.rating), total: count(reviewsTable.id) })
    .from(reviewsTable)
    .where(eq(reviewsTable.storeId, storeId));

  await db.update(storesTable)
    .set({ avgRating: Number(stats[0]?.avgRating ?? 0), totalReviews: Number(stats[0]?.total ?? 0) })
    .where(eq(storesTable.id, storeId));

  res.status(201).json(review);
});

export default router;
