import { pgTable, text, serial, timestamp, integer, boolean, index, unique, check } from "drizzle-orm/pg-core";
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
