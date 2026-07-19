import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supportMessagesTable = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  userEmail: text("user_email"),
  senderRole: text("sender_role").notNull(), // "user" | "admin"
  body: text("body").notNull(),
  readByAdmin: boolean("read_by_admin").notNull().default(false),
  readByUser: boolean("read_by_user").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupportMessageSchema = createInsertSchema(supportMessagesTable).omit({ id: true, createdAt: true });
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;
export type SupportMessage = typeof supportMessagesTable.$inferSelect;
