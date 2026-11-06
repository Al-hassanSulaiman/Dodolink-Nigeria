import { pgTable, text, serial, timestamp, primaryKey, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// A user blocking another user. Blocked people cannot message the blocker and
// the blocker no longer sees their stores, products or chats.
export const userBlocksTable = pgTable("user_blocks", {
  blockerId: text("blocker_id").notNull(),
  blockedId: text("blocked_id").notNull(),
  blockedLabel: text("blocked_label").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.blockerId, table.blockedId] }),
  index("user_blocks_blocked_idx").on(table.blockedId),
]);

// "Report" on a store, a product or a person (also created when someone blocks).
export const contentReportsTable = pgTable("content_reports", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull(), // "store" | "product" | "user"
  targetId: text("target_id").notNull(),
  targetLabel: text("target_label").notNull().default(""),
  reporterId: text("reporter_id").notNull(),
  reporterName: text("reporter_name").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // "open" | "resolved"
  adminNote: text("admin_note"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("content_reports_status_idx").on(table.status),
  check("content_reports_type_check", sql`${table.targetType} in ('store', 'product', 'user')`),
]);
