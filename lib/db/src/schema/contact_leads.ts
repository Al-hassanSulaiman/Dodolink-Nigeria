import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contactLeadsTable = pgTable("contact_leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  description: text("description").notNull(),
  budget: text("budget").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContactLeadSchema = createInsertSchema(contactLeadsTable).omit({ id: true, submittedAt: true });
export type InsertContactLead = z.infer<typeof insertContactLeadSchema>;
export type ContactLead = typeof contactLeadsTable.$inferSelect;
