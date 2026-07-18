import cron from "node-cron";
import { and, eq, gte, lte, eq as drizzleEq } from "drizzle-orm";
import { db, storesTable, pushTokensTable } from "@workspace/db";
import { notifyTokens } from "./push";
import { logger } from "./logger";

const RENEWAL_REMINDER_TITLE = "Subscription Expiry Reminder";
const RENEWAL_REMINDER_BODY =
  "Dear Valued Retailer, your monthly subscription will expire in 3 days. " +
  "Renew before it expires to keep your Verified Retailer Status, Store Visibility, " +
  "Customer Messaging, and Secure Marketplace Access. " +
  "Subscription Fee: ₦5,000/month. " +
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

export function startScheduler(): void {
  // Run daily at 9:00 AM server time
  cron.schedule("0 9 * * *", () => {
    sendRenewalReminders().catch((err) => {
      logger.error({ err }, "Renewal reminder job failed");
    });
  });

  logger.info("Scheduler started — renewal reminders run daily at 09:00");
}
