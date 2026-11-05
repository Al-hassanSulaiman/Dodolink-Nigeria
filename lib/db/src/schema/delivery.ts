import { pgTable, text, serial, timestamp, integer, boolean, index, unique, check, jsonb } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Delivery people. Rows are created only by an admin (never by self sign-up).
// deliveryType: "intrastate" | "interstate" | "both"
export const deliveryAgentsTable = pgTable("delivery_agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  imageUrl: text("image_url"),
  bio: text("bio"),
  linkedUserId: text("linked_user_id").unique(), // his own DodoLink (Clerk) account, so he can chat
  deliveryType: text("delivery_type").notNull(), // also enforced by a CHECK in the migration
  homeState: text("home_state"),
  coveredStates: text("covered_states").array().notNull().default([]),
  nationwide: boolean("nationwide").notNull().default(false),
  bankName: text("bank_name"),
  bankCode: text("bank_code"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountName: text("bank_account_name"),
  paystackRecipientCode: text("paystack_recipient_code"),
  active: boolean("active").notNull().default(true),
  // Subscription, same idea as stores: starts once enough customers chat with the company.
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  subscriptionDueAt: timestamp("subscription_due_at", { withTimezone: true }),
  subscriptionLastPaidAt: timestamp("subscription_last_paid_at", { withTimezone: true }),
  subscriptionExempt: boolean("subscription_exempt").notNull().default(false),
  paystackEmail: text("paystack_email"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryConversationsTable = pgTable("delivery_conversations", {
  id: serial("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  agentId: integer("agent_id").notNull().references(() => deliveryAgentsTable.id, { onDelete: "cascade" }),
  lastMessage: text("last_message"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  customerUnread: integer("customer_unread").notNull().default(0),
  agentUnread: integer("agent_unread").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("delivery_conversations_pair_unique").on(table.customerId, table.agentId),
  index("delivery_conversations_agent_idx").on(table.agentId),
]);

export const deliveryMessagesTable = pgTable("delivery_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => deliveryConversationsTable.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  senderName: text("sender_name").notNull(),
  senderType: text("sender_type").notNull(), // "customer" | "agent"
  body: text("body").notNull(),
  mediaUrl: text("media_url"),
  replyToMessageId: integer("reply_to_message_id").references(
    (): AnyPgColumn => deliveryMessagesTable.id, { onDelete: "set null" },
  ),
  replyPreview: jsonb("reply_preview").$type<{
    id: number; senderId: string; senderName: string; body: string; mediaUrl: string | null;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("delivery_messages_conversation_idx").on(table.conversationId),
]);

// Jobs and money. Created now, used by the payment phase (not by phase 1 code).
export const deliveryOrdersTable = pgTable("delivery_orders", {
  id: serial("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  agentId: integer("agent_id").notNull().references(() => deliveryAgentsTable.id),
  conversationId: integer("conversation_id").references(() => deliveryConversationsTable.id, { onDelete: "set null" }),
  pickupState: text("pickup_state").notNull(),
  dropState: text("drop_state").notNull(),
  description: text("description"),
  amountKobo: integer("amount_kobo").notNull(),
  platformFeeKobo: integer("platform_fee_kobo").notNull(),
  agentAmountKobo: integer("agent_amount_kobo").notNull(),
  paystackReference: text("paystack_reference").unique(),
  status: text("status").notNull().default("requested"),
  deliveryCodeHash: text("delivery_code_hash"),
  payoutStatus: text("payout_status").notNull().default("none"),
  transferReference: text("transfer_reference").unique(),
  transferCode: text("transfer_code"),
  paystackFeeKobo: integer("paystack_fee_kobo").notNull().default(0),
  refundedKobo: integer("refunded_kobo").notNull().default(0),
  codeAttempts: integer("code_attempts").notNull().default(0),
  payoutNote: text("payout_note"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("delivery_orders_customer_idx").on(table.customerId),
  index("delivery_orders_agent_idx").on(table.agentId),
]);

export type DeliveryAgent = typeof deliveryAgentsTable.$inferSelect;

// One rating per delivered job, written by the customer.
export const deliveryRatingsTable = pgTable("delivery_ratings", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().unique().references(() => deliveryOrdersTable.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").notNull().references(() => deliveryAgentsTable.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull(),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("delivery_ratings_agent_idx").on(table.agentId),
  check("delivery_ratings_stars_check", sql`${table.stars} between 1 and 5`),
]);

// A problem raised on a job. While open, the payout is held until an admin decides.
export const deliveryDisputesTable = pgTable("delivery_disputes", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => deliveryOrdersTable.id, { onDelete: "cascade" }),
  openedBy: text("opened_by").notNull(),
  openedByRole: text("opened_by_role").notNull(), // "customer" | "agent"
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // "open" | "resolved"
  resolution: text("resolution"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("delivery_disputes_order_idx").on(table.orderId),
]);

// A customer's star rating of a company: one per customer per company, changeable.
export const deliveryCompanyRatingsTable = pgTable("delivery_company_ratings", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => deliveryAgentsTable.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull(),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("delivery_company_ratings_pair_unique").on(table.agentId, table.customerId),
  check("delivery_company_ratings_stars_check", sql`${table.stars} between 1 and 5`),
]);

// Price quoted for a company's subscription payment, checked when the payment is verified.
export const deliverySubscriptionPaymentsTable = pgTable("delivery_subscription_payments", {
  reference: text("reference").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => deliveryAgentsTable.id, { onDelete: "cascade" }),
  quotedAmountKobo: integer("quoted_amount_kobo").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Report a problem" on any chat. kind: "store" (normal chat) | "delivery".
export const chatReportsTable = pgTable("chat_reports", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  conversationId: integer("conversation_id").notNull(),
  reporterId: text("reporter_id").notNull(),
  reporterName: text("reporter_name").notNull(),
  otherPartyName: text("other_party_name").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // "open" | "resolved"
  adminNote: text("admin_note"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("chat_reports_status_idx").on(table.status),
  check("chat_reports_kind_check", sql`${table.kind} in ('store', 'delivery')`),
]);
