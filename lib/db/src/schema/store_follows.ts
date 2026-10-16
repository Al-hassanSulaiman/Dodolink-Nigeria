import { pgTable, text, integer, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { storesTable } from "./stores";

export const storeFollowsTable = pgTable("store_follows", {
  userId: text("user_id").notNull(),
  storeId: integer("store_id").notNull().references(() => storesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.userId, table.storeId] }),
  index("store_follows_store_idx").on(table.storeId),
]);
