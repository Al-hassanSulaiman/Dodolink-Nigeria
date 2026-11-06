import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, userBlocksTable, contentReportsTable, storesTable, productsTable } from "@workspace/db";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { userDisplayName } from "../lib/displayName";

// Apple guideline 1.2: users can block abusive people and report content.
// A block also files a report so the team sees it and acts within 24 hours.
const router: IRouter = Router();
const writeLimit = rateLimit({ name: "safety", max: 30, windowMs: 60 * 60 * 1000 });

router.get("/blocks", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const rows = await db.select().from(userBlocksTable).where(eq(userBlocksTable.blockerId, userId));
  res.json(rows.map(r => ({ userId: r.blockedId, name: r.blockedLabel || "User", createdAt: r.createdAt })));
});

router.post("/blocks", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const blockedId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
  const label = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  if (!blockedId || blockedId.length > 200) { res.status(400).json({ error: "Invalid user" }); return; }
  if (blockedId === userId) { res.status(400).json({ error: "You cannot block yourself" }); return; }

  const [existing] = await db.select().from(userBlocksTable).where(and(
    eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, blockedId)));
  if (!existing) {
    await db.insert(userBlocksTable).values({ blockerId: userId, blockedId, blockedLabel: label });
    await db.insert(contentReportsTable).values({
      targetType: "user", targetId: blockedId, targetLabel: label || blockedId,
      reporterId: userId, reporterName: await userDisplayName(userId),
      reason: reason || "Blocked by another user as abusive",
    });
  }
  res.status(201).json({ status: "blocked" });
});

router.delete("/blocks/:userId", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  await db.delete(userBlocksTable).where(and(
    eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, String(req.params.userId))));
  res.json({ status: "unblocked" });
});

router.post("/content-reports", writeLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const type = req.body?.targetType;
  const targetId = req.body?.targetId == null ? "" : String(req.body.targetId).trim();
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if ((type !== "store" && type !== "product" && type !== "user") || !targetId || targetId.length > 200) {
    res.status(400).json({ error: "Invalid report" }); return;
  }
  if (reason.length < 5 || reason.length > 1000) {
    res.status(400).json({ error: "Please say what is wrong (5 to 1000 characters)" }); return;
  }

  let label = typeof req.body?.targetLabel === "string" ? req.body.targetLabel.trim().slice(0, 120) : "";
  if (type === "store" || type === "product") {
    const id = Number(targetId);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) { res.status(400).json({ error: "Invalid report" }); return; }
    const table = type === "store" ? storesTable : productsTable;
    const [row] = await db.select({ name: table.name }).from(table).where(eq(table.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    label = row.name;
  }

  const [dup] = await db.select().from(contentReportsTable).where(and(
    eq(contentReportsTable.targetType, type), eq(contentReportsTable.targetId, targetId),
    eq(contentReportsTable.reporterId, userId), eq(contentReportsTable.status, "open")));
  if (dup) { res.json({ status: "already_reported" }); return; }

  await db.insert(contentReportsTable).values({
    targetType: type, targetId, targetLabel: label || targetId,
    reporterId: userId, reporterName: await userDisplayName(userId), reason,
  });
  res.status(201).json({ status: "reported" });
});

export default router;
