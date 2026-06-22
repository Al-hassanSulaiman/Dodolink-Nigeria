import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, conversationsTable, messagesTable, storesTable } from "@workspace/db";
import { SendMessageBody, StartConversationBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/conversations", async (req, res): Promise<void> => {
  const userId = typeof req.query.userId === "string" ? req.query.userId : null;
  if (!userId) { res.status(400).json({ error: "userId is required" }); return; }

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

  res.json(enriched);
});

router.post("/conversations/start", async (req, res): Promise<void> => {
  const parsed = StartConversationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { customerId, customerName, storeId, initialMessage } = parsed.data;

  const [store] = await db.select({ name: storesTable.name }).from(storesTable).where(eq(storesTable.id, storeId));
  if (!store) { res.status(404).json({ error: "Store not found" }); return; }

  const [conv] = await db
    .insert(conversationsTable)
    .values({ customerId, customerName, storeId, lastMessage: initialMessage, lastMessageAt: new Date() })
    .returning();

  await db.insert(messagesTable).values({
    conversationId: conv.id,
    senderId: customerId,
    senderName: customerName,
    senderType: "customer",
    body: initialMessage,
  });

  res.status(201).json({ ...conv, storeName: store.name });
});

router.get("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(raw, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversationId" }); return; }

  const msgs = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conversationId));
  res.json(msgs);
});

router.post("/conversations/:conversationId/messages", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.conversationId) ? req.params.conversationId[0] : req.params.conversationId;
  const conversationId = parseInt(raw, 10);
  if (isNaN(conversationId)) { res.status(400).json({ error: "Invalid conversationId" }); return; }

  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [msg] = await db.insert(messagesTable).values({ ...parsed.data, conversationId }).returning();

  await db.update(conversationsTable)
    .set({ lastMessage: parsed.data.body, lastMessageAt: new Date() })
    .where(eq(conversationsTable.id, conversationId));

  res.status(201).json(msg);
});

export default router;
