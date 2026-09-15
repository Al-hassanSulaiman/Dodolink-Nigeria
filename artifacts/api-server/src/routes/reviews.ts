import { Router, type IRouter } from "express";
import { eq, avg, count } from "drizzle-orm";
import { db, reviewsTable, storesTable, pushTokensTable } from "@workspace/db";
import { CreateReviewBody } from "@workspace/api-zod";
import { notifyTokens } from "../lib/push";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";

const reviewCreateLimit = rateLimit({ name: "review-create", max: 10, windowMs: 60 * 60 * 1000 });

const router: IRouter = Router();

router.get("/stores/:storeId/reviews", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const reviews = await db.select().from(reviewsTable).where(eq(reviewsTable.storeId, storeId));
  res.json(reviews);
});

router.post("/stores/:storeId/reviews", reviewCreateLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const raw = Array.isArray(req.params.storeId) ? req.params.storeId[0] : req.params.storeId;
  const storeId = parseInt(raw, 10);
  if (isNaN(storeId)) { res.status(400).json({ error: "Invalid storeId" }); return; }

  const [targetStore] = await db.select({ verificationStatus: storesTable.verificationStatus, ownerUserId: storesTable.ownerUserId }).from(storesTable).where(eq(storesTable.id, storeId));
  if (!targetStore) { res.status(404).json({ error: "Store not found" }); return; }
  if (targetStore.verificationStatus !== "verified") {
    res.status(403).json({ error: "Only verified stores can receive reviews" });
    return;
  }
  if (targetStore.ownerUserId === userId) {
    res.status(403).json({ error: "You cannot review your own store" });
    return;
  }

  const parsed = CreateReviewBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.reviewerId !== userId) { res.status(403).json({ error: "reviewerId must match the authenticated user" }); return; }

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

  const [store] = await db
    .update(storesTable)
    .set({ avgRating: Number(stats[0]?.avgRating ?? 0), totalReviews: Number(stats[0]?.total ?? 0) })
    .where(eq(storesTable.id, storeId))
    .returning({ ownerUserId: storesTable.ownerUserId, name: storesTable.name });

  // Push notification to store owner
  if (store) {
    const tokens = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, store.ownerUserId));
    const stars = "★".repeat(parsed.data.rating) + "☆".repeat(5 - parsed.data.rating);
    await notifyTokens(
      tokens.map(t => t.token),
      `New ${stars} review on ${store.name}`,
      `${parsed.data.reviewerName}: "${parsed.data.comment}"`,
      { storeId },
    );
  }

  res.status(201).json(review);
});

export default router;
