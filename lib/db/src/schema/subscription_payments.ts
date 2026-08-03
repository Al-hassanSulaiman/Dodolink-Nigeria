import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Records the price quoted at checkout time for each subscription payment
 * reference. Verification checks the transaction against this stored quote,
 * so a store crossing an engagement tier mid-checkout cannot cause a
 * mismatch, and every billed amount is auditable.
 */
export const subscriptionPaymentsTable = pgTable("subscription_payments", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  storeId: integer("store_id").notNull(),
  quotedAmountKobo: integer("quoted_amount_kobo").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionPayment = typeof subscriptionPaymentsTable.$inferSelect;
