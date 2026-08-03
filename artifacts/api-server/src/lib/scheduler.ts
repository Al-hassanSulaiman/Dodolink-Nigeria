import cron from "node-cron";
import { and, eq, gte, lt, lte } from "drizzle-orm";
import { db, storesTable, pushTokensTable, conversationsTable } from "@workspace/db";
import { notifyTokens } from "./push";
import { logger } from "./logger";
import { clerkClient } from "@clerk/express";

const RENEWAL_REMINDER_TITLE = "Subscription Expiry Reminder";
const RENEWAL_REMINDER_BODY =
  "Dear Valued Retailer, your monthly subscription will expire in 3 days. " +
  "Renew before it expires to keep your Verified Retailer Status, Store Visibility, " +
  "Customer Messaging, and Secure Marketplace Access. " +
  "Subscription Fee: ₦2,000/month (₦5,000/month for high-engagement stores). " +
  "Thank you for choosing DodoLink. — Al-Hassan Sulaiman, Founder & CEO.";

async function sendRenewalReminders(): Promise<void> {
  const now = new Date();
  // Window: subscriptionDueAt is between 2 days 23h from now and 3 days 1h from now
  // This catches stores whose renewal falls "in 3 days" regardless of exact run time
  const windowStart = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

  const stores = await db
    .select({
      id: storesTable.id,
      ownerUserId: storesTable.ownerUserId,
      name: storesTable.name,
    })
    .from(storesTable)
    .where(
      and(
        eq(storesTable.subscriptionStatus, "active"),
        eq(storesTable.autoPayEnabled, false),
        gte(storesTable.subscriptionDueAt, windowStart),
        lte(storesTable.subscriptionDueAt, windowEnd)
      )
    );

  if (stores.length === 0) {
    logger.info("Renewal reminder: no stores due in ~3 days");
    return;
  }

  logger.info({ count: stores.length }, "Sending renewal reminder notifications");

  for (const store of stores) {
    const tokens = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(eq(pushTokensTable.userId, store.ownerUserId));

    await notifyTokens(
      tokens.map((t) => t.token),
      RENEWAL_REMINDER_TITLE,
      RENEWAL_REMINDER_BODY,
      { type: "subscription_renewal_reminder", storeId: store.id }
    );
  }
}

/**
 * One-time startup backfill: update customerName for any conversation where
 * the stored name is not already the customer's Clerk email address.
 * Runs asynchronously in the background — failures are logged but never
 * crash the server.
 */
export async function backfillCustomerNames(): Promise<void> {
  logger.info("customerName backfill: starting");

  // Fetch all conversations that still have a non-email customerName.
  // A simple heuristic: if the name contains "@" it was already resolved.
  const convs = await db.select().from(conversationsTable);
  const toUpdate = convs.filter((c) => !c.customerName.includes("@"));

  if (toUpdate.length === 0) {
    logger.info("customerName backfill: nothing to update");
    return;
  }

  logger.info({ count: toUpdate.length }, "customerName backfill: conversations to fix");

  // Deduplicate by customerId so we only call Clerk once per user.
  const uniqueCustomerIds = [...new Set(toUpdate.map((c) => c.customerId))];
  const emailByUserId = new Map<string, string>();

  for (const userId of uniqueCustomerIds) {
    try {
      const clerkUser = await clerkClient.users.getUser(userId);
      const primaryId = clerkUser.primaryEmailAddressId;
      const primary = clerkUser.emailAddresses.find((e: { id: string }) => e.id === primaryId);
      const email =
        (primary as any)?.emailAddress ??
        clerkUser.emailAddresses[0]?.emailAddress ??
        null;
      if (email) emailByUserId.set(userId, email);
    } catch (err) {
      logger.warn({ userId, err }, "customerName backfill: Clerk lookup failed, skipping user");
    }
  }

  let updated = 0;
  for (const conv of toUpdate) {
    const email = emailByUserId.get(conv.customerId);
    if (!email || email === conv.customerName) continue;
    try {
      await db
        .update(conversationsTable)
        .set({ customerName: email })
        .where(eq(conversationsTable.id, conv.id));
      updated++;
    } catch (err) {
      logger.warn({ conversationId: conv.id, err }, "customerName backfill: update failed");
    }
  }

  logger.info({ updated }, "customerName backfill: complete");
}

async function expireOverdueSubscriptions(): Promise<void> {
  const now = new Date();
  const result = await db
    .update(storesTable)
    .set({ subscriptionStatus: "past_due" })
    .where(
      and(
        eq(storesTable.subscriptionStatus, "active"),
        lt(storesTable.subscriptionDueAt, now)
      )
    )
    .returning({ id: storesTable.id, name: storesTable.name });

  if (result.length > 0) {
    logger.info({ count: result.length, stores: result.map((s) => s.id) }, "Subscription expiry: marked stores past_due");
  } else {
    logger.info("Subscription expiry: no overdue stores");
  }
}

export function startScheduler(): void {
  // Run daily at 9:00 AM server time
  cron.schedule("0 9 * * *", () => {
    sendRenewalReminders().catch((err) => {
      logger.error({ err }, "Renewal reminder job failed");
    });
    expireOverdueSubscriptions().catch((err) => {
      logger.error({ err }, "Subscription expiry job failed");
    });
  });

  logger.info("Scheduler started — renewal reminders and expiry checks run daily at 09:00");

  // Best-effort one-time backfill to fix pre-existing conversation names.
  backfillCustomerNames().catch((err) => {
    logger.error({ err }, "customerName backfill failed");
  });
}
