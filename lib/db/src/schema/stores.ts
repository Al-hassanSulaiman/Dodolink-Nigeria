import { pgTable, text, serial, timestamp, real, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const storesTable = pgTable("stores", {
  id: serial("id").primaryKey(),
  ownerName: text("owner_name").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  location: text("location").notNull(),
  phone: text("phone").notNull(),
  imageUrl: text("image_url"),
  cacNumber: text("cac_number"),
  avgRating: real("avg_rating"),
  totalReviews: integer("total_reviews").notNull().default(0),
  verificationStatus: text("verification_status").notNull().default("pending"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedBy: text("verified_by"),
  rejectionReason: text("rejection_reason"),
  // Subscription / visibility fields
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  subscriptionStatus: text("subscription_status").notNull().default("inactive"),
  subscriptionDueAt: timestamp("subscription_due_at", { withTimezone: true }),
  subscriptionLastPaidAt: timestamp("subscription_last_paid_at", { withTimezone: true }),
  paystackCustomerCode: text("paystack_customer_code"),
  paystackAuthCode: text("paystack_auth_code"),
  paystackEmail: text("paystack_email"),
  autoPayEnabled: boolean("auto_pay_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStoreSchema = createInsertSchema(storesTable).omit({ id: true, createdAt: true, updatedAt: true, avgRating: true, totalReviews: true });
export type InsertStore = z.infer<typeof insertStoreSchema>;
export type Store = typeof storesTable.$inferSelect;
