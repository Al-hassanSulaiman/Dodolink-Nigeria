import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db, deliveryAgentsTable, deliveryConversationsTable, deliveryMessagesTable, pushTokensTable,
  deliveryOrdersTable, deliveryRatingsTable, deliveryCompanyRatingsTable,
} from "@workspace/db";
import { userDisplayName, friendlyName } from "../lib/displayName";
import { checkChatMedia } from "../lib/chatMedia";
import { checkAndSetAgentQualified, visibleAgentsFilter, agentIsVisible } from "../lib/deliverySubscription";
import { orderView } from "../lib/deliveryOrders";
import { deliveryPaymentsEnabled } from "../lib/deliveryMoney";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { notifyTokens } from "../lib/push";
import { logger } from "../lib/logger";
import { NIGERIAN_STATES, DELIVERY_TYPES } from "../lib/nigerianStates";

// Customer-facing and delivery-person-facing delivery routes.
// Never returns phone numbers or bank details.
const router: IRouter = Router();
const sendLimit = rateLimit({ name: "delivery-msg", max: 30, windowMs: 60_000 });
const startLimit = rateLimit({ name: "delivery-start", max: 15, windowMs: 5 * 60_000 });

type AgentRow = typeof deliveryAgentsTable.$inferSelect;
type Rating = { average: number | null; count: number };
function publicAgent(a: AgentRow, rating: Rating = { average: null, count: 0 }) {
  return {
    id: a.id, name: a.name, imageUrl: a.imageUrl, bio: a.bio,
    deliveryType: a.deliveryType, homeState: a.homeState,
    coveredStates: a.coveredStates, nationwide: a.nationwide,
    ratingAverage: rating.average, ratingCount: rating.count,
  };
}

async function ratingsFor(agentIds: number[]): Promise<Map<number, Rating>> {
  const map = new Map<number, Rating>();
  if (!agentIds.length) return map;
  const ids = sql.join(agentIds.map(i => sql`${i}`), sql`, `);
  const result = await db.execute(sql`
    SELECT agent_id AS "agentId", round(avg(stars)::numeric, 1)::float AS average, count(*)::integer AS count
    FROM (
      SELECT agent_id, stars FROM delivery_ratings WHERE agent_id IN (${ids})
      UNION ALL
      SELECT agent_id, stars FROM delivery_company_ratings WHERE agent_id IN (${ids})
    ) r GROUP BY agent_id
  `);
  for (const r of result.rows as Array<{ agentId: number; average: number; count: number }>) {
    map.set(r.agentId, { average: r.average, count: r.count });
  }
  return map;
}

function toId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

async function agentForUser(userId: string): Promise<AgentRow | null> {
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.linkedUserId, userId));
  return agent ?? null;
}

const customerLabel = userDisplayName;

router.get("/delivery/meta", (req, res): void => {
  if (!requireUser(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ states: NIGERIAN_STATES, types: DELIVERY_TYPES });
});

router.get("/delivery/agents", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store");
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const rows = await db.select().from(deliveryAgentsTable)
    .where(visibleAgentsFilter()).orderBy(deliveryAgentsTable.name);
  const filtered = rows.filter(a => {
    if (type === "intrastate" && a.deliveryType === "interstate") return false;
    if (type === "interstate" && a.deliveryType === "intrastate") return false;
    if (state) {
      const covers = a.homeState === state || a.nationwide || a.coveredStates.includes(state);
      if (!covers) return false;
    }
    return true;
  });
  const ratings = await ratingsFor(filtered.map(a => a.id));
  res.json(filtered.map(a => publicAgent(a, ratings.get(a.id))));
});

// Is the signed-in user a delivery company? (lets the app show his inbox)
router.get("/delivery/me", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.setHeader("Cache-Control", "private, no-store");
  const agent = await agentForUser(userId);
  res.json({ agent: agent && agent.active ? publicAgent(agent) : null });
});

router.post("/delivery/conversations/start", startLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const agentId = toId(req.body?.agentId);
  if (agentId === null) { res.status(400).json({ error: "Invalid delivery company" }); return; }
  const [agent] = await db.select().from(deliveryAgentsTable)
    .where(and(eq(deliveryAgentsTable.id, agentId), eq(deliveryAgentsTable.active, true)));
  if (!agent || !agentIsVisible(agent)) { res.status(404).json({ error: "Delivery company not found" }); return; }
  if (agent.linkedUserId === userId) { res.status(400).json({ error: "You cannot chat with yourself" }); return; }
  const customerName = await customerLabel(userId);
  const [created] = await db.insert(deliveryConversationsTable)
    .values({ customerId: userId, customerName, agentId })
    .onConflictDoNothing().returning();
  let conversation = created ?? (await db.select().from(deliveryConversationsTable)
    .where(and(eq(deliveryConversationsTable.customerId, userId), eq(deliveryConversationsTable.agentId, agentId))))[0];
  if (conversation && conversation.customerName !== customerName) {
    await db.update(deliveryConversationsTable).set({ customerName })
      .where(eq(deliveryConversationsTable.id, conversation.id));
    conversation = { ...conversation, customerName };
  }
  res.status(created ? 201 : 200).json({ ...conversation, agent: publicAgent(agent) });
});

router.get("/delivery/conversations", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.setHeader("Cache-Control", "private, no-store");
  const me = await agentForUser(userId);
  const rows = await db.select().from(deliveryConversationsTable).where(and(
    me ? or(eq(deliveryConversationsTable.customerId, userId), eq(deliveryConversationsTable.agentId, me.id))
       : eq(deliveryConversationsTable.customerId, userId),
    sql`${deliveryConversationsTable.lastMessageAt} is not null`,
  )).orderBy(desc(deliveryConversationsTable.lastMessageAt));
  const agentIds = [...new Set(rows.map(r => r.agentId))];
  const agents = agentIds.length
    ? await db.select().from(deliveryAgentsTable).where(inArray(deliveryAgentsTable.id, agentIds)) : [];
  const byId = new Map(agents.map(a => [a.id, a]));
  res.json(rows.map(r => {
    const asAgent = !!me && r.agentId === me.id && r.customerId !== userId;
    const agent = byId.get(r.agentId);
    return {
      id: r.id, role: asAgent ? "agent" : "customer",
      title: asAgent ? friendlyName(r.customerName) : (agent?.name ?? "Delivery"),
      imageUrl: asAgent ? null : (agent?.imageUrl ?? null),
      deliveryType: agent?.deliveryType ?? null,
      lastMessage: r.lastMessage, lastMessageAt: r.lastMessageAt,
      unread: asAgent ? r.agentUnread : r.customerUnread,
    };
  }));
});

async function participant(conversationId: number, userId: string) {
  const [conv] = await db.select().from(deliveryConversationsTable).where(eq(deliveryConversationsTable.id, conversationId));
  if (!conv) return null;
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, conv.agentId));
  if (!agent) return null;
  if (conv.customerId === userId) return { conv, agent, role: "customer" as const };
  if (agent.linkedUserId === userId) return { conv, agent, role: "agent" as const };
  return null;
}

router.get("/delivery/conversations/:id/messages", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.setHeader("Cache-Control", "private, no-store");
  const id = toId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid chat" }); return; }
  const p = await participant(id, userId);
  if (!p) { res.status(404).json({ error: "Chat not found" }); return; }
  const messages = await db.select().from(deliveryMessagesTable)
    .where(eq(deliveryMessagesTable.conversationId, id)).orderBy(deliveryMessagesTable.createdAt, deliveryMessagesTable.id);
  const orders = await db.select().from(deliveryOrdersTable)
    .where(eq(deliveryOrdersTable.conversationId, id)).orderBy(desc(deliveryOrdersTable.createdAt));
  const ratings = await ratingsFor([p.agent.id]);
  let myRating: { stars: number; comment: string | null } | null = null;
  if (p.role === "customer") {
    const [mine] = await db.select().from(deliveryCompanyRatingsTable).where(and(
      eq(deliveryCompanyRatingsTable.agentId, p.agent.id), eq(deliveryCompanyRatingsTable.customerId, userId)));
    if (mine) myRating = { stars: mine.stars, comment: mine.comment };
  }
  res.json({
    role: p.role,
    title: p.role === "agent" ? friendlyName(p.conv.customerName) : p.agent.name,
    myRating,
    canRate: p.role === "customer" && messages.some(m => m.senderType === "agent"),
    agent: publicAgent(p.agent, ratings.get(p.agent.id)),
    paymentsEnabled: deliveryPaymentsEnabled(),
    orders: await Promise.all(orders.map(o => orderView(o, p.role))),
    messages: messages.map(m => ({
      id: m.id, body: m.body, mediaUrl: m.mediaUrl, replyPreview: m.replyPreview,
      senderId: m.senderId, senderType: m.senderType, senderName: friendlyName(m.senderName),
      mine: m.senderType !== "support" && m.senderId === userId, createdAt: m.createdAt,
    })),
  });
});

router.post("/delivery/conversations/:id/messages", sendLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid chat" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const mediaUrl = typeof req.body?.mediaUrl === "string" && req.body.mediaUrl ? req.body.mediaUrl : null;
  if (!body && !mediaUrl) { res.status(400).json({ error: "Enter a message or attach a photo or video" }); return; }
  if (body.length > 2000) { res.status(400).json({ error: "Message is too long" }); return; }
  const p = await participant(id, userId);
  if (!p) { res.status(404).json({ error: "Chat not found" }); return; }
  if (!p.agent.active) { res.status(403).json({ error: "This delivery company is not available" }); return; }
  if (mediaUrl) {
    const media = await checkChatMedia(mediaUrl);
    if (!media.ok) { res.status(400).json({ error: media.error }); return; }
  }
  let replyToMessageId: number | null = null;
  let replyPreview: { id: number; senderId: string; senderName: string; body: string; mediaUrl: string | null } | null = null;
  if (req.body?.replyToMessageId != null) {
    replyToMessageId = toId(req.body.replyToMessageId);
    if (replyToMessageId === null) { res.status(400).json({ error: "Invalid message reference" }); return; }
    const [original] = await db.select().from(deliveryMessagesTable).where(and(
      eq(deliveryMessagesTable.id, replyToMessageId), eq(deliveryMessagesTable.conversationId, id)));
    if (!original) { res.status(400).json({ error: "That message is not available in this conversation" }); return; }
    replyPreview = {
      id: original.id, senderId: original.senderId, senderName: friendlyName(original.senderName),
      body: original.body.slice(0, 500), mediaUrl: original.mediaUrl,
    };
  }

  const senderName = p.role === "agent" ? p.agent.name : await customerLabel(userId);
  const preview = body || "Sent a photo or video";
  const message = await db.transaction(async tx => {
    const [m] = await tx.insert(deliveryMessagesTable).values({
      conversationId: id, senderId: userId, senderName, senderType: p.role, body,
      mediaUrl, replyToMessageId, replyPreview,
    }).returning();
    await tx.update(deliveryConversationsTable).set({
      lastMessage: preview, lastMessageAt: new Date(),
      ...(p.role === "customer" ? { customerName: senderName } : {}),
      ...(p.role === "customer"
        ? { agentUnread: sql`${deliveryConversationsTable.agentUnread} + 1` }
        : { customerUnread: sql`${deliveryConversationsTable.customerUnread} + 1` }),
    }).where(eq(deliveryConversationsTable.id, id));
    return m;
  });
  if (p.role === "customer") await checkAndSetAgentQualified(p.agent.id).catch(() => undefined);

  try {
    const recipient = p.role === "customer" ? p.agent.linkedUserId : p.conv.customerId;
    if (recipient) {
      const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable)
        .where(eq(pushTokensTable.userId, recipient));
      await notifyTokens(tokens.map(t => t.token), senderName, preview, { deliveryConversationId: id });
    }
  } catch (err) {
    logger.warn({ err }, "Delivery message push failed");
  }
  res.status(201).json({
    id: message.id, body: message.body, mediaUrl: message.mediaUrl, replyPreview: message.replyPreview,
    senderId: message.senderId, senderType: message.senderType,
    senderName: message.senderName, mine: true, createdAt: message.createdAt,
  });
});

router.post("/delivery/conversations/:id/read", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid chat" }); return; }
  const p = await participant(id, userId);
  if (!p) { res.status(404).json({ error: "Chat not found" }); return; }
  await db.update(deliveryConversationsTable)
    .set(p.role === "agent" ? { agentUnread: 0 } : { customerUnread: 0 })
    .where(eq(deliveryConversationsTable.id, id));
  res.json({ status: "ok" });
});

// A customer rates a company once (and may change it). Only after the company has replied in chat.
router.post("/delivery/agents/:id/rating", rateLimit({ name: "delivery-rate", max: 20, windowMs: 60 * 60 * 1000 }), async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const agentId = toId(req.params.id);
  const stars = Number(req.body?.stars);
  if (agentId === null || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    res.status(400).json({ error: "Choose 1 to 5 stars" });
    return;
  }
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim().slice(0, 500) || null : null;
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, agentId));
  if (!agent || agent.linkedUserId === userId) { res.status(404).json({ error: "Delivery company not found" }); return; }
  const [replied] = await db.select({ id: deliveryMessagesTable.id }).from(deliveryMessagesTable)
    .innerJoin(deliveryConversationsTable, eq(deliveryConversationsTable.id, deliveryMessagesTable.conversationId))
    .where(and(
      eq(deliveryConversationsTable.agentId, agentId), eq(deliveryConversationsTable.customerId, userId),
      eq(deliveryMessagesTable.senderType, "agent"),
    )).limit(1);
  if (!replied) { res.status(403).json({ error: "You can rate a company after it has replied to you" }); return; }
  await db.insert(deliveryCompanyRatingsTable).values({ agentId, customerId: userId, stars, comment })
    .onConflictDoUpdate({
      target: [deliveryCompanyRatingsTable.agentId, deliveryCompanyRatingsTable.customerId],
      set: { stars, comment, updatedAt: new Date() },
    });
  const rating = (await ratingsFor([agentId])).get(agentId) ?? { average: null, count: 0 };
  res.json({ status: "ok", ratingAverage: rating.average, ratingCount: rating.count });
});

export default router;
