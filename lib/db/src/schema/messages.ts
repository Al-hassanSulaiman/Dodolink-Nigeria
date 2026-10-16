import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { conversationsTable } from "./conversations";

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  senderName: text("sender_name").notNull(),
  senderType: text("sender_type").notNull(), // "customer" | "retailer"
  body: text("body").notNull(),
  mediaUrl: text("media_url"),
  replyToMessageId: integer("reply_to_message_id").references(
    (): AnyPgColumn => messagesTable.id, { onDelete: "set null" },
  ),
  replyPreview: jsonb("reply_preview").$type<{
    id: number; senderId: string; senderName: string; body: string; mediaUrl: string | null;
  }>(),
  productId: integer("product_id"),
  productPreview: jsonb("product_preview").$type<{
    id: number; name: string; price: number; imageUrl: string | null;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
