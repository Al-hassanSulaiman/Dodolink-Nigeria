import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db, chatReportsTable, conversationsTable, storesTable, deliveryConversationsTable, deliveryAgentsTable,
} from "@workspace/db";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { friendlyName, userDisplayName } from "../lib/displayName";

// "Report a problem" from inside any chat (store chat or delivery chat).
// Support can read a chat only after one of its people has reported it.
const router: IRouter = Router();
const reportLimit = rateLimit({ name: "chat-report", max: 5, windowMs: 60 * 60 * 1000 });

router.post("/reports", reportLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const kind = req.body?.kind;
  const conversationId = Number(req.body?.conversationId);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if ((kind !== "store" && kind !== "delivery") || !Number.isInteger(conversationId) || conversationId < 1 || conversationId > 2147483647) {
    res.status(400).json({ error: "Invalid report" });
    return;
  }
  if (reason.length < 5 || reason.length > 1000) {
    res.status(400).json({ error: "Please describe the problem (5 to 1000 characters)" });
    return;
  }

  let otherPartyName: string;
  if (kind === "store") {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
    if (!conv) { res.status(404).json({ error: "Chat not found" }); return; }
    const [store] = await db.select().from(storesTable).where(eq(storesTable.id, conv.storeId));
    const isCustomer = conv.customerId === userId;
    if (!isCustomer && store?.ownerUserId !== userId) { res.status(403).json({ error: "You are not in this chat" }); return; }
    otherPartyName = isCustomer ? (store?.name ?? "Store") : friendlyName(conv.customerName);
  } else {
    const [conv] = await db.select().from(deliveryConversationsTable).where(eq(deliveryConversationsTable.id, conversationId));
    if (!conv) { res.status(404).json({ error: "Chat not found" }); return; }
    const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, conv.agentId));
    const isCustomer = conv.customerId === userId;
    if (!isCustomer && agent?.linkedUserId !== userId) { res.status(403).json({ error: "You are not in this chat" }); return; }
    otherPartyName = isCustomer ? (agent?.name ?? "Delivery company") : friendlyName(conv.customerName);
  }

  const [existing] = await db.select().from(chatReportsTable).where(and(
    eq(chatReportsTable.kind, kind), eq(chatReportsTable.conversationId, conversationId),
    eq(chatReportsTable.reporterId, userId), eq(chatReportsTable.status, "open"),
  ));
  if (existing) { res.json({ status: "already_reported", id: existing.id }); return; }

  const [created] = await db.insert(chatReportsTable).values({
    kind, conversationId, reporterId: userId, reporterName: await userDisplayName(userId), otherPartyName, reason,
  }).returning();
  res.status(201).json({ status: "reported", id: created.id });
});

export default router;
