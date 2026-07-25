import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, conversationsTable, messagesTable, storesTable, pushTokensTable } from "@workspace/db";
import { SendMessageBody, StartConversationBody } from "@workspace/api-zod";
import { notifyTokens } from "../lib/push";
import { checkAndSetQualifiedAt } from "../lib/storeSubscription";
import { requireUser } from "../lib/auth";

const router: IRouter = Router();

async function loadConversationIfParticipant(conversationId: number, userId: string) {
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (!conv) return { conv: null, allowed: false };
  if (conv.customerId === userId) return { conv, allowed: true };
  const [store] = await db
    .select({ ownerUserId: storesTable.ownerUserId })
    .from(storesTable)
    .where(eq(storesTable.id, conv.storeId));
  return { conv, allowed: store?.ownerUserId === userId };
}

router.get("/conversations", async (req, res): Promise<void> => {
  const authUserId = requireUser(req, res);
  if (!authUserId) return;

  const userId = typeof req.query.userId === "string" ? req.query.userId : null;
  if (!userId) { res.status(400).json({ error: "userId is required" }); return; }
  if (userId !== authUserId) { res.status(403).json({ error: "Cannot access another user's conversations" }); return; }

  // Get conversations where user is customer OR owns the store
  const storesByOwner = await db.select({ id: storesTable.id, name: storesTable.name }).from(storesTable).where(eq(storesTable.ownerUserId, userId));
  const storeIds = storesByOwner.map(s => s.id);

  const allConvs = await db.select().from(conversationsTable);
  const relevant = allConvs.filter(c => c.customerId === userId || storeIds.includes(c.storeId));

  const storeNames: Record<number, string> = {};
  for (const s of storesByOwner) storeNames[s.id] = s.name;

  const enriched = await Promise.all(
    relevant.map(async (c) => {
      let storeName = storeNames[c.storeId];
      if (!storeName) {
        const [s] = await db.select({ name: storesTable.name }).from(storesTable).where(eq(storesTable.id, c.storeId));
        storeName = s?.name ?? "";
      }
      return { ...c, storeName };
    })
  );

  // Newest conversation (most recent message) first
  enriched.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : new Date(a.createdAt).getTime();
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : new Date(b.createdAt).getTime();
    return tb - ta;
  });

  res.json(enriched);
});

router.post("/conversations/start", async (req, res): Promise<void> => {
  const authUserId = requireUser(req, res);
  if (!authUserId) return;

  const parsed = StartConversationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { customerId, customerName, storeId, initialMessage } = parsed.data;
  if (customerId !== authUserId) { res.status(403).json({ error: "customerId must match the authenticated user" }); return; }

  const [store] = await db.select({ name: storesTable.name }).from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  // Return existing conversation if one already exists between this customer and store
  const [existing] = await db
    .select()
    .from(conversationsTable)
    .where(and(eq(conversationsTable.customerId, customerId), eq(conversationsTable.storeId, storeId)));

  if (existing) {
    res.status(200).json({ ...existing, storeName: store.name });
    return;
  }

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      customerId,
      customerName,
      storeId,
      ...(initialMessage ? { lastMessage: initialMessage, lastMessageAt: new Date() } : {}),
    })
    .returning();

  if (initialMessage) {
    await db.insert(messagesTable).values({
      conversationId: conv.id,
      senderId: customerId,
      senderName: customerName,
      senderType: "customer",
      body: initialMessage,
    });
  }

  // Check if this conversation pushes the store to the engagement threshold
  await checkAndSetQualifiedAt(storeId).catch(() => undefined);

  res.status(201).json({ ...conv, storeName: store.name });
});

router.get("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const authUserId = requireUser(req, res);
  if (!authUserId) return;

  const raw = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(raw, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversationId" }); return; }

  const { conv, allowed } = await loadConversationIfParticipant(conversationId, authUserId);
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (!allowed) { res.status(403).json({ error: "You are not a participant in this conversation" }); return; }

  const msgs = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conversationId));
  res.json(msgs);
});

router.post("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const authUserId = requireUser(req, res);
  if (!authUserId) return;

  const raw = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(raw, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversationId" }); return; }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.senderId !== authUserId) { res.status(403).json({ error: "senderId must match the authenticated user" }); return; }

  const { conv: conversation, allowed } = await loadConversationIfParticipant(conversationId, authUserId);
  if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (!allowed) { res.status(403).json({ error: "You are not a participant in this conversation" }); return; }

  const [msg] = await db.insert(messagesTable).values({
    conversationId,
    senderId: parsed.data.senderId,
    senderName: parsed.data.senderName,
    senderType: parsed.data.senderType,
    body: parsed.data.body,
    ...(parsed.data.mediaUrl ? { mediaUrl: parsed.data.mediaUrl } : {}),
  }).returning();

  await db.update(conversationsTable)
    .set({
      lastMessage: parsed.data.body || '📷 Media',
      lastMessageAt: new Date(),
      unreadCount: sql`${conversationsTable.unreadCount} + 1`,
    })
    .where(eq(conversationsTable.id, conversationId));

  // Send push notification to the recipient.
  // Derive sender role server-side from the conversation record — never trust
  // the senderType the client submitted, which could be spoofed to misdirect
  // notifications.
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
  if (conv) {
    const [store] = await db
      .select({ ownerUserId: storesTable.ownerUserId })
      .from(storesTable)
      .where(eq(storesTable.id, conv.storeId));

    const senderIsCustomer = conv.customerId === authUserId;
    const senderIsRetailer = store?.ownerUserId === authUserId;

    if (senderIsCustomer && store) {
      // Buyer sent a message → notify the store owner
      const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable).where(eq(pushTokensTable.userId, store.ownerUserId));
      await notifyTokens(
        tokens.map(t => t.token),
        `New message from ${parsed.data.senderName}`,
        parsed.data.body,
        { conversationId },
      );
    } else if (senderIsRetailer) {
      // Store owner replied → notify the buyer
      const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable).where(eq(pushTokensTable.userId, conv.customerId));
      await notifyTokens(
        tokens.map(t => t.token),
        `Reply from ${parsed.data.senderName}`,
        parsed.data.body,
        { conversationId },
      );
    }
  }

  res.status(201).json(msg);
});

router.post("/conversations/:conversationId/read", async (req, res): Promise<void> => {
  const authUserId = requireUser(req, res);
  if (!authUserId) return;

  const raw = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(raw, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversationId" }); return; }

  const { conv, allowed } = await loadConversationIfParticipant(conversationId, authUserId);
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (!allowed) { res.status(403).json({ error: "You are not a participant in this conversation" }); return; }

  await db.update(conversationsTable)
    .set({ unreadCount: 0 })
    .where(eq(conversationsTable.id, conversationId));

  res.json({ status: "ok" });
});

export default router;
