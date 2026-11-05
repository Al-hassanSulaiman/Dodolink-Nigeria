import { pgTable, text, serial, timestamp, integer, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// One person blocking another. Hides the blocked person's stores, products and reviews from the
// blocker and stops either of them messaging the other.
export const userBlocksTable = pgTable("user_blocks", {
  id: serial("id").primaryKey(),
  blockerId: text("blocker_id").notNull(),
  blockedId: text("blocked_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("user_blocks_pair_unique").on(table.blockerId, table.blockedId),
  index("user_blocks_blocker_idx").on(table.blockerId),
  index("user_blocks_blocked_idx").on(table.blockedId),
  check("user_blocks_not_self", sql`${table.blockerId} <> ${table.blockedId}`),
]);

// Reports of a store, product, review or person, and records of blocks (so the team is told).
export const contentReportsTable = pgTable("content_reports", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // "store" | "product" | "review" | "user" | "block"
  targetId: text("target_id").notNull(), // store/product/review id, or the person's user id
  targetOwnerId: text("target_owner_id"), // the person who made the content (for removal and bans)
  targetLabel: text("target_label").notNull(), // readable name for the admin list
  reporterId: text("reporter_id").notNull(),
  reporterName: text("reporter_name").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // "open" | "resolved"
  action: text("action"), // "dismissed" | "removed" | "banned"
  adminNote: text("admin_note"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("content_reports_status_idx").on(table.status),
  check("content_reports_kind_check", sql`${table.kind} in ('store', 'product', 'review', 'user', 'block')`),
]);

// People removed for breaking the rules. They can no longer use the app.
export const bannedUsersTable = pgTable("banned_users", {
  userId: text("user_id").primaryKey(),
  reason: text("reason").notNull(),
  bannedBy: text("banned_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
