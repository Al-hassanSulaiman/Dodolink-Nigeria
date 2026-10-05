import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

// Durable retry queue. Completed entries expire after a day, once old session
// tokens are no longer usable. The temporary notification email is cleared on
// completion; names and payment credentials are never stored in this queue.
export const accountDeletionsTable = pgTable("account_deletions", {
  userId: text("user_id").primaryKey(),
  mediaPaths: jsonb("media_paths").$type<string[]>().notNull().default([]),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  contactEmail: text("contact_email"),
  uploadsExpireAt: timestamp("uploads_expire_at", { withTimezone: true }),
});
