import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, conversationsTable, messagesTable, storesTable, pushTokensTable } from "@workspace/db";
import { SendMessageBody, StartConversationBody } from "@workspace/api-zod";
import { notifyTokens } from "../lib/push";
import { checkAndSetQualifiedAt } from "../lib/storeSubscription";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { validateStoredMedia } from "../lib/mediaLimits";
import { clerkClient } from "@clerk/express";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const startConversationLimit = rateLimit({ name: "conv-start", max: 15, windowMs: 5 * 60 * 1000 });
const sendMessageLimit = rateLimit({ name: "msg-send", max: 30, windowMs: 60 * 1000 });

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
      // Return the unread count relevant to the requester:
      // - customer sees messages from store (unreadCount)
      // - store owner sees messages from customer (storeUnreadCount)
      const isStoreOwner = storeIds.includes(c.storeId) && c.customerId !== authUserId;
      const unreadCount = isStoreOwner ? c.storeUnreadCount : c.unreadCount;
      return { ...c, storeName, unreadCount };
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

router.post("/conversations/start", startConversationLimit, async (req, res): Promise<void> => {
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

router.post("/conversations/:conversationId/messages", sendMessageLimit, async (req, res): Promise<void> => {
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

  // Verify attached media against the real uploaded object (type + size),
  // since presigned upload URLs can't enforce these constraints themselves.
  // The client may send a raw object path ("/objects/...") or a full URL
  // pointing at the storage serve route — handle both.
  if (parsed.data.mediaUrl) {
    let objectPath: string | null = null;
    if (parsed.data.mediaUrl.startsWith("/objects/")) {
      objectPath = parsed.data.mediaUrl;
    } else {
      try {
        const pathname = new URL(parsed.data.mediaUrl).pathname;
        const idx = pathname.indexOf("/objects/");
        if (idx !== -1) objectPath = pathname.slice(idx);
      } catch {
        objectPath = null;
      }
    }
    if (!objectPath) {
      res.status(400).json({ error: "Invalid media URL" });
      return;
    }
    try {
      const mediaFile = await objectStorage.getObjectEntityFile(objectPath);
      const mediaCheck = await validateStoredMedia(mediaFile);
      if (!mediaCheck.ok) {
        res.status(400).json({ error: mediaCheck.reason });
        return;
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "Media file not found. Please upload it again." });
        return;
      }
      throw err;
    }
  }

  // Determine senderName server-side — never trust what the client sends.
  // Customer  → their Clerk account email address
  // Retailer  → the store's name (from the DB, not the client)
  const senderIsCustomer = conversation.customerId === authUserId;
  let resolvedSenderName: string;
  if (senderIsCustomer) {
    try {
      const clerkUser = await clerkClient.users.getUser(authUserId);
      const primaryId = clerkUser.primaryEmailAddressId;
      const primary = clerkUser.emailAddresses.find((e: { id: string }) => e.id === primaryId);
      resolvedSenderName = (primary as any)?.emailAddress
        ?? clerkUser.emailAddresses[0]?.emailAddress
        ?? parsed.data.senderName;
    } catch {
      resolvedSenderName = parsed.data.senderName;
    }
  } else {
    const [store] = await db.select({ name: storesTable.name }).from(storesTable).where(eq(storesTable.id, conversation.storeId));
    resolvedSenderName = store?.name ?? parsed.data.senderName;
  }

  const [msg] = await db.insert(messagesTable).values({
    conversationId,
    senderId: authUserId,
    senderName: resolvedSenderName,
    senderType: senderIsCustomer ? "customer" : "retailer",
    body: parsed.data.body,
    ...(parsed.data.mediaUrl ? { mediaUrl: parsed.data.mediaUrl } : {}),
  }).returning();

  // Increment only the RECIPIENT's unread counter; reset the sender's to 0
  // so the sender never sees their own message as outstanding.
  // (senderIsCustomer already declared above)
  await db.update(conversationsTable)
    .set({
      lastMessage: parsed.data.body || '📷 Media',
      lastMessageAt: new Date(),
      // sender's counter → 0 (they just "read" by sending)
      // recipient's counter → +1
      unreadCount: senderIsCustomer
        ? 0
        : sql`${conversationsTable.unreadCount} + 1`,
      storeUnreadCount: senderIsCustomer
        ? sql`${conversationsTable.storeUnreadCount} + 1`
        : 0,
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

  // Reset the counter for the person who read it
  const readerIsCustomer = conv.customerId === authUserId;
  await db.update(conversationsTable)
    .set(readerIsCustomer ? { unreadCount: 0 } : { storeUnreadCount: 0 })
    .where(eq(conversationsTable.id, conversationId));

  res.json({ status: "ok" });
});

export default router;
