import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, userBlocksTable, contentReportsTable, conversationsTable, deliveryConversationsTable } from "@workspace/db";
import { deliveryCompanyUserId, storeOwnerId } from "../lib/ugcSafety";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { userDisplayName } from "../lib/displayName";

// Block an abusive person. Their stores, products and reviews disappear from the blocker's app,
// neither can message the other, and the DodoLink team is told (it shows in the admin Reports page).
const router: IRouter = Router();
const blockLimit = rateLimit({ name: "block-user", max: 30, windowMs: 60 * 60 * 1000 });

router.get("/blocks", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const rows = await db.select().from(userBlocksTable).where(eq(userBlocksTable.blockerId, userId))
    .orderBy(userBlocksTable.createdAt);
  const people = await Promise.all(rows.map(async r => ({
    userId: r.blockedId, name: await userDisplayName(r.blockedId), blockedAt: r.createdAt,
  })));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(people);
});

router.post("/blocks", blockLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  let blockedId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
  // From inside a chat the app sends the chat; the server works out who is on the other side.
  const chatId = Number(req.body?.conversationId);
  if (!blockedId && Number.isInteger(chatId) && chatId > 0 && ["store", "delivery"].includes(req.body?.chatKind)) {
    if (req.body.chatKind === "store") {
      const [c] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, chatId));
      if (c) blockedId = c.customerId === userId ? ((await storeOwnerId(c.storeId)) ?? "") : c.customerId;
    } else {
      const [c] = await db.select().from(deliveryConversationsTable).where(eq(deliveryConversationsTable.id, chatId));
      if (c) blockedId = c.customerId === userId ? ((await deliveryCompanyUserId(c.agentId)) ?? "") : c.customerId;
    }
  }
  if (!blockedId || blockedId.length > 200) { res.status(400).json({ error: "Choose someone to block" }); return; }
  if (blockedId === userId) { res.status(400).json({ error: "You cannot block yourself" }); return; }

  const inserted = await db.insert(userBlocksTable).values({ blockerId: userId, blockedId })
    .onConflictDoNothing().returning();
  if (inserted.length > 0) {
    // Tell the team. Best effort: the block itself already worked.
    try {
      await db.insert(contentReportsTable).values({
        kind: "block", targetId: blockedId, targetOwnerId: blockedId,
        targetLabel: await userDisplayName(blockedId),
        reporterId: userId, reporterName: await userDisplayName(userId),
        reason: "This person was blocked by another user.",
      });
    } catch (err) {
      req.log.error({ err }, "Could not record block for the team");
    }
  }
  res.status(201).json({ status: "blocked" });
});

router.delete("/blocks/:userId", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  await db.delete(userBlocksTable).where(and(
    eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, String(req.params.userId)),
  ));
  res.json({ status: "unblocked" });
});

export default router;
