import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, contentReportsTable, storesTable, productsTable, reviewsTable } from "@workspace/db";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { userDisplayName } from "../lib/displayName";

// Report a store, product, review or person that breaks the rules. The team reviews it within 24 hours.
const router: IRouter = Router();
const reportLimit = rateLimit({ name: "content-report", max: 10, windowMs: 60 * 60 * 1000 });

router.post("/content-reports", reportLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const kind = req.body?.kind;
  const targetId = String(req.body?.targetId ?? "").trim();
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!["store", "product", "review", "user"].includes(kind) || !targetId || targetId.length > 200) {
    res.status(400).json({ error: "Invalid report" });
    return;
  }
  if (reason.length < 5 || reason.length > 1000) {
    res.status(400).json({ error: "Please describe the problem (5 to 1000 characters)" });
    return;
  }

  let ownerId: string | null = null;
  let label = "";
  const numericId = Number(targetId);
  if (kind === "store" || kind === "product" || kind === "review") {
    if (!Number.isInteger(numericId) || numericId < 1 || numericId > 2147483647) { res.status(400).json({ error: "Invalid report" }); return; }
  }
  if (kind === "store") {
    const [s] = await db.select().from(storesTable).where(eq(storesTable.id, numericId));
    if (!s) { res.status(404).json({ error: "Not found" }); return; }
    ownerId = s.ownerUserId; label = `Store: ${s.name}`;
  } else if (kind === "product") {
    const [p] = await db.select({ name: productsTable.name, owner: storesTable.ownerUserId }).from(productsTable)
      .innerJoin(storesTable, eq(storesTable.id, productsTable.storeId)).where(eq(productsTable.id, numericId));
    if (!p) { res.status(404).json({ error: "Not found" }); return; }
    ownerId = p.owner; label = `Product: ${p.name}`;
  } else if (kind === "review") {
    const [r] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, numericId));
    if (!r) { res.status(404).json({ error: "Not found" }); return; }
    ownerId = r.reviewerId; label = `Review by ${r.reviewerName}: ${r.comment.slice(0, 80)}`;
  } else {
    ownerId = targetId; label = `Person: ${await userDisplayName(targetId)}`;
  }
  if (ownerId === userId) { res.status(400).json({ error: "You cannot report your own content" }); return; }

  const [existing] = await db.select().from(contentReportsTable).where(and(
    eq(contentReportsTable.kind, kind), eq(contentReportsTable.targetId, targetId),
    eq(contentReportsTable.reporterId, userId), eq(contentReportsTable.status, "open"),
  ));
  if (existing) { res.json({ status: "already_reported", id: existing.id }); return; }

  const [created] = await db.insert(contentReportsTable).values({
    kind, targetId, targetOwnerId: ownerId, targetLabel: label,
    reporterId: userId, reporterName: await userDisplayName(userId), reason,
  }).returning();
  res.status(201).json({ status: "reported", id: created.id });
});

export default router;
