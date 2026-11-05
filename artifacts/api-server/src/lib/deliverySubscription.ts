import { and, eq, gte, gt, isNull, or, countDistinct, sql } from "drizzle-orm";
import {
  db, deliveryAgentsTable, deliveryConversationsTable, deliveryMessagesTable,
  deliverySubscriptionPaymentsTable, pushTokensTable,
} from "@workspace/db";
import {
  ENGAGEMENT_THRESHOLD, GRACE_PERIOD_DAYS, getSubscriptionAmountKobo, isPaymentsLive,
} from "./storeSubscription";
import { notifyTokens } from "./push";

// Delivery companies pay like stores: ₦2,000 a month, ₦5,000 with 12+ chatting customers,
// starting once 7 different customers have chatted with them in 30 days, with a grace period first.
export const DELIVERY_SUBSCRIPTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
export const DELIVERY_REFERENCE_PREFIX = "dodolink_dsub_";

export async function deliveryEngagementCount(agentId: number): Promise<number> {
  const since = new Date(Date.now() - 30 * DAY);
  const [row] = await db.select({ count: countDistinct(deliveryConversationsTable.customerId) })
    .from(deliveryConversationsTable)
    .innerJoin(deliveryMessagesTable, eq(deliveryMessagesTable.conversationId, deliveryConversationsTable.id))
    .where(and(
      eq(deliveryConversationsTable.agentId, agentId),
      eq(deliveryMessagesTable.senderType, "customer"),
      gte(deliveryMessagesTable.createdAt, since),
    ));
  return row?.count ?? 0;
}

/** Start the clock (once) when enough different customers have chatted with the company. */
export async function checkAndSetAgentQualified(agentId: number): Promise<void> {
  const [agent] = await db.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, agentId));
  if (!agent || agent.qualifiedAt) return;
  if ((await deliveryEngagementCount(agentId)) < ENGAGEMENT_THRESHOLD) return;
  await db.update(deliveryAgentsTable).set({ qualifiedAt: new Date() })
    .where(and(eq(deliveryAgentsTable.id, agentId), isNull(deliveryAgentsTable.qualifiedAt)));
  if (!agent.linkedUserId) return;
  const tokens = await db.select({ token: pushTokensTable.token }).from(pushTokensTable)
    .where(eq(pushTokensTable.userId, agent.linkedUserId));
  await notifyTokens(tokens.map(t => t.token), "Important Notice",
    `Dear ${agent.name}, enough customers are now chatting with you. Starting in ${GRACE_PERIOD_DAYS} days a monthly subscription applies ` +
    "(₦2,000/month, or ₦5,000/month with 12+ different chatting customers in 30 days). Open the Delivery tab to subscribe.",
    { type: "delivery_subscription_qualified", agentId });
}

type Fields = Pick<typeof deliveryAgentsTable.$inferSelect,
  "active" | "qualifiedAt" | "subscriptionDueAt" | "subscriptionLastPaidAt" | "subscriptionExempt">;

/** Should customers see this company in the Delivery tab? (JS version, used for single rows.) */
export function agentIsVisible(a: Fields, now = Date.now()): boolean {
  if (!a.active) return false;
  if (!isPaymentsLive() || a.subscriptionExempt || !a.qualifiedAt) return true;
  if (a.subscriptionDueAt && a.subscriptionDueAt.getTime() > now) return true;
  // Never paid: a grace period from qualifying. A lapsed renewal is hidden at once, like stores.
  return !a.subscriptionLastPaidAt && a.qualifiedAt.getTime() + GRACE_PERIOD_DAYS * DAY > now;
}

/** Same rule as a SQL condition, so the list query hides unpaid companies. */
export function visibleAgentsFilter() {
  if (!isPaymentsLive()) return eq(deliveryAgentsTable.active, true);
  const graceStart = new Date(Date.now() - GRACE_PERIOD_DAYS * DAY);
  return and(
    eq(deliveryAgentsTable.active, true),
    or(
      eq(deliveryAgentsTable.subscriptionExempt, true),
      isNull(deliveryAgentsTable.qualifiedAt),
      gt(deliveryAgentsTable.subscriptionDueAt, sql`now()`),
      and(isNull(deliveryAgentsTable.subscriptionLastPaidAt), gte(deliveryAgentsTable.qualifiedAt, graceStart)),
    ),
  );
}

export function agentGraceDaysLeft(a: Fields, now = Date.now()): number | null {
  if (a.subscriptionExempt || !a.qualifiedAt || a.subscriptionLastPaidAt) return null;
  const left = a.qualifiedAt.getTime() + GRACE_PERIOD_DAYS * DAY - now;
  return left <= 0 ? 0 : Math.ceil(left / DAY);
}

export async function deliverySubscriptionStatus(agent: typeof deliveryAgentsTable.$inferSelect) {
  const engagementCount = await deliveryEngagementCount(agent.id);
  return {
    agentId: agent.id,
    engagementCount,
    amountKobo: getSubscriptionAmountKobo(engagementCount),
    qualified: !!agent.qualifiedAt,
    exempt: agent.subscriptionExempt,
    paid: !!agent.subscriptionDueAt && agent.subscriptionDueAt.getTime() > Date.now(),
    dueAt: agent.subscriptionDueAt?.toISOString() ?? null,
    lastPaidAt: agent.subscriptionLastPaidAt?.toISOString() ?? null,
    graceDaysLeft: agentGraceDaysLeft(agent),
    visible: agentIsVisible(agent),
    paymentsLive: isPaymentsLive(),
  };
}

export type ActivateResult = "activated" | "already_used" | "amount_mismatch" | "unknown_reference";

/** Consume the price quote and start/extend the month, once per reference (safe to call twice). */
export async function activateAgentForReference(params: {
  reference: string; amountKobo: number; currency?: string;
}): Promise<ActivateResult> {
  if (params.currency && params.currency !== "NGN") return "amount_mismatch";
  const now = new Date();
  return db.transaction(async tx => {
    const [quote] = await tx.select().from(deliverySubscriptionPaymentsTable)
      .where(eq(deliverySubscriptionPaymentsTable.reference, params.reference));
    if (!quote) return "unknown_reference" as const;
    if (params.amountKobo < quote.quotedAmountKobo) return "amount_mismatch" as const;
    const consumed = await tx.update(deliverySubscriptionPaymentsTable).set({ consumedAt: now })
      .where(and(
        eq(deliverySubscriptionPaymentsTable.reference, params.reference),
        isNull(deliverySubscriptionPaymentsTable.consumedAt),
      )).returning();
    if (!consumed.length) return "already_used" as const;
    const [agent] = await tx.select().from(deliveryAgentsTable).where(eq(deliveryAgentsTable.id, quote.agentId));
    // Renew from the current due date when still running, so early payers lose nothing.
    const base = agent?.subscriptionDueAt && agent.subscriptionDueAt.getTime() > now.getTime()
      ? agent.subscriptionDueAt.getTime() : now.getTime();
    await tx.update(deliveryAgentsTable).set({
      subscriptionLastPaidAt: now,
      subscriptionDueAt: new Date(base + DELIVERY_SUBSCRIPTION_DAYS * DAY),
    }).where(eq(deliveryAgentsTable.id, quote.agentId));
    return "activated" as const;
  });
}
