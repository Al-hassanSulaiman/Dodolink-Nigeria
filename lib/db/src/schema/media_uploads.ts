import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
// Server-issued paths and authenticated uploader IDs, never client claims.
export const mediaUploadsTable = pgTable("media_uploads", {
  path: text("path").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
