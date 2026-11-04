import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db, deliveryAgentsTable, deliveryConversationsTable, deliveryMessagesTable, pushTokensTable,
} from "@workspace/db";
import { clerkClient } from "@clerk/express";
import { requireUser } from "../lib/auth";
import { rateLimit } from "../lib/rateLimit";
import { notifyTokens } from "../lib/push";
import { logger } from "../lib/logger";
import { NIGERIAN_STATES, DELIVERY_TYPES } from "../lib/nigerianStates";
import { ratingSummaries } from "../lib/deliveryOrders";
import { ordersForConversation } from "../lib/deliveryOrderView";

// Customer-facing and delivery-person-facing delivery routes.
// Never returns phone numbers or bank details.
const router: IRouter = Router();
const sendLimit = rateLimit({ name: "delivery-msg", max: 30, windowMs: 60_000 });
const startLimit = rateLimit({ name: "delivery-start", max: 15, windowMs: 5 * 60_000 });

type AgentRow = typeof deliveryAgentsTable.$inferSelect;
export function publicAgent(a: AgentRow, rating?: { avg: number; count: number }) {
  return {
    ratingAvg: rating?.avg ?? null, ratingCount: rating?.count ?? 0,
    id: a.id, name: a.name, imageUrl: a.imageUrl, bio: a.bio,
    deliveryType: a.deliveryType, homeState: a.homeState,
    coveredStates: a.coveredStates, nationwide: a.nationwide,
  };
}

export function toId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
}

async function agentForUser(userId: string): Promise<AgentRow | null> {
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.linkedUserId, userId));
  return agent ?? null;
}

async function customerLabel(userId: string): Promise<string> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
      || user.username || "Dodolink user";
  } catch {
    return "Dodolink user";
  }
}

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
    .where(eq(deliveryAgentsTable.active, true)).orderBy(deliveryAgentsTable.name);
  const filtered = rows.filter(a => {
    if (type === "intrastate" && a.deliveryType === "interstate") return false;
    if (type === "interstate" && a.deliveryType === "intrastate") return false;
    if (state) {
      const covers = a.homeState === state || a.nationwide || a.coveredStates.includes(state);
      if (!covers) return false;
    }
    return true;
  });
  const ratings = await ratingSummaries(filtered.map(a => a.id));
  res.json(filtered.map(a => publicAgent(a, ratings.get(a.id))));
});

// Is the signed-in user a delivery person? (lets the app show his inbox)
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
  if (agentId === null) { res.status(400).json({ error: "Invalid delivery person" }); return; }
  const [agent] = await db.select().from(deliveryAgentsTable)
    .where(and(eq(deliveryAgentsTable.id, agentId), eq(deliveryAgentsTable.active, true)));
  if (!agent) { res.status(404).json({ error: "Delivery person not found" }); return; }
  if (agent.linkedUserId === userId) { res.status(400).json({ error: "You cannot chat with yourself" }); return; }
  const customerName = await customerLabel(userId);
  const [created] = await db.insert(deliveryConversationsTable)
    .values({ customerId: userId, customerName, agentId })
    .onConflictDoNothing().returning();
  const conversation = created ?? (await db.select().from(deliveryConversationsTable)
    .where(and(eq(deliveryConversationsTable.customerId, userId), eq(deliveryConversationsTable.agentId, agentId))))[0];
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
      title: asAgent ? r.customerName : (agent?.name ?? "Delivery"),
      imageUrl: asAgent ? null : (agent?.imageUrl ?? null),
      deliveryType: agent?.deliveryType ?? null,
      lastMessage: r.lastMessage, lastMessageAt: r.lastMessageAt,
      unread: asAgent ? r.agentUnread : r.customerUnread,
    };
  }));
});

export async function participant(conversationId: number, userId: string) {
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
  const orders = await ordersForConversation(id, p.role === "agent" ? "company" : "customer");
  const ratings = await ratingSummaries([p.agent.id]);
  res.json({
    role: p.role,
    title: p.role === "agent" ? p.conv.customerName : p.agent.name,
    agent: publicAgent(p.agent, ratings.get(p.agent.id)),
    orders,
    messages: messages.map(m => ({
      id: m.id, body: m.body, senderType: m.senderType, senderName: m.senderName,
      mine: m.senderId === userId, createdAt: m.createdAt,
    })),
  });
});

router.post("/delivery/conversations/:id/messages", sendLimit, async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const id = toId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid chat" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) { res.status(400).json({ error: "Message cannot be empty" }); return; }
  if (body.length > 2000) { res.status(400).json({ error: "Message is too long" }); return; }
  const p = await participant(id, userId);
  if (!p) { res.status(404).json({ error: "Chat not found" }); return; }
  if (!p.agent.active) { res.status(403).json({ error: "This delivery person is not available" }); return; }

  const senderName = p.role === "agent" ? p.agent.name : p.conv.customerName;
  const message = await db.transaction(async tx => {
    const [m] = await tx.insert(deliveryMessagesTable).values({
      conversationId: id, senderId: userId, senderName, senderType: p.role, body,
    }).returning();
    await tx.update(deliveryConversationsTable).set({
      lastMessage: body, lastMessageAt: new Date(),
      ...(p.role === "customer"
        ? { agentUnread: sql`${deliveryConversationsTable.agentUnread} + 1` }
        : { customerUnread: sql`${deliveryConversationsTable.customerUnread} + 1` }),
    }).where(eq(deliveryConversationsTable.id, id));
    return m;
  });

  try {
    const recipient = p.role === "customer" ? p.agent.linkedUserId : p.conv.customerId;
    if (recipient) {
      const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable)
        .where(eq(pushTokensTable.userId, recipient));
      await notifyTokens(tokens.map(t => t.token), senderName, body, { deliveryConversationId: id });
    }
  } catch (err) {
    logger.warn({ err }, "Delivery message push failed");
  }
  res.status(201).json({
    id: message.id, body: message.body, senderType: message.senderType,
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

export default router;
