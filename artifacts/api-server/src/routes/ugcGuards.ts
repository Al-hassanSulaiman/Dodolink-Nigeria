import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db, conversationsTable, storesTable, deliveryConversationsTable, deliveryAgentsTable,
} from "@workspace/db";
import { blockedEitherWay, deliveryCompanyUserId, isBlockedBetween, storeOwnerId } from "../lib/ugcSafety";
import { OBJECTIONABLE_MESSAGE, containsObjectionable } from "../lib/contentFilter";

// Safety checks that run in front of the existing routes (mounted in routes/index.ts):
//  1. people who block each other cannot start or continue a chat
//  2. blocked people's chats disappear from the inbox
//  3. clearly objectionable words are refused in anything people publish
const router: IRouter = Router();
const BLOCKED = { error: "You cannot message this person." };
const idOf = (v: unknown) => { const n = Number.parseInt(String(v), 10); return Number.isInteger(n) && n > 0 ? n : null; };

const guard = (find: (req: Request, userId: string) => Promise<string | null>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = getAuth(req);
      if (!userId) { next(); return; }
      const other = await find(req, userId);
      if (other && (await isBlockedBetween(userId, other))) { res.status(403).json(BLOCKED); return; }
      next();
    } catch (err) { next(err); }
  };

// The other person in a store chat / delivery chat.
const storeChatOther = async (req: Request, userId: string) => {
  const id = idOf(req.params.conversationId);
  if (!id) return null;
  const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id));
  if (!conv) return null;
  if (conv.customerId === userId) return storeOwnerId(conv.storeId);
  return conv.customerId;
};
const deliveryChatOther = async (req: Request, userId: string) => {
  const id = idOf(req.params.id);
  if (!id) return null;
  const [conv] = await db.select().from(deliveryConversationsTable).where(eq(deliveryConversationsTable.id, id));
  if (!conv) return null;
  if (conv.customerId === userId) return deliveryCompanyUserId(conv.agentId);
  return conv.customerId;
};

router.post("/conversations/start", guard(async req => {
  const storeId = idOf(req.body?.storeId);
  return storeId ? storeOwnerId(storeId) : null;
}));
router.post("/conversations/:conversationId/messages", guard(storeChatOther));
router.post("/delivery/conversations/start", guard(async req => {
  const agentId = idOf(req.body?.agentId);
  return agentId ? deliveryCompanyUserId(agentId) : null;
}));
router.post("/delivery/conversations/:id/messages", guard(deliveryChatOther));

// Hide blocked people's chats from the inbox lists.
function filterInbox(kind: "store" | "delivery") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = getAuth(req);
      if (!userId) { next(); return; }
      const blocked = await blockedEitherWay(userId);
      if (blocked.size === 0) { next(); return; }
      const hidden = new Set<number>();
      if (kind === "store") {
        const rows = await db.select({ id: conversationsTable.id, customerId: conversationsTable.customerId, owner: storesTable.ownerUserId })
          .from(conversationsTable).innerJoin(storesTable, eq(storesTable.id, conversationsTable.storeId));
        for (const r of rows) {
          const other = r.customerId === userId ? r.owner : r.owner === userId ? r.customerId : null;
          if (other && blocked.has(other)) hidden.add(r.id);
        }
      } else {
        const rows = await db.select({ id: deliveryConversationsTable.id, customerId: deliveryConversationsTable.customerId, agent: deliveryAgentsTable.linkedUserId })
          .from(deliveryConversationsTable).innerJoin(deliveryAgentsTable, eq(deliveryAgentsTable.id, deliveryConversationsTable.agentId));
        for (const r of rows) {
          const other = r.customerId === userId ? r.agent : r.agent === userId ? r.customerId : null;
          if (other && blocked.has(other)) hidden.add(r.id);
        }
      }
      const json = res.json.bind(res);
      res.json = ((body: unknown) => json(Array.isArray(body)
        ? body.filter((c: { id?: number }) => !(typeof c?.id === "number" && hidden.has(c.id)))
        : body)) as typeof res.json;
      next();
    } catch (err) { next(err); }
  };
}
router.get("/conversations", filterInbox("store"));
router.get("/delivery/conversations", filterInbox("delivery"));

// Refuse clearly objectionable text. Only the text fields people publish are checked.
const TEXT_FIELDS = ["body", "comment", "name", "description", "bio", "location"];
function refuseObjectionable(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body === "object" &&
      TEXT_FIELDS.some(f => typeof body[f] === "string" && containsObjectionable(body[f] as string))) {
    res.status(400).json({ error: OBJECTIONABLE_MESSAGE });
    return;
  }
  next();
}
router.post("/conversations/:conversationId/messages", refuseObjectionable);
router.post("/delivery/conversations/:id/messages", refuseObjectionable);
router.post("/stores/:storeId/reviews", refuseObjectionable);
router.post("/stores", refuseObjectionable);
router.patch("/stores/:storeId", refuseObjectionable);
router.post("/stores/:storeId/products", refuseObjectionable);
router.patch("/products/:productId", refuseObjectionable);

export default router;
