import { pgTable, text, uuid, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portfolioClientLinksTable = pgTable("portfolio_client_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const portfolioVisitsTable = pgTable("portfolio_visits", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => portfolioClientLinksTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  seconds: integer("seconds").notNull().default(0),
  sections: jsonb("sections").$type<Record<string, number>>().notNull().default({}),
}, (table) => [
  index("portfolio_visits_started_idx").on(table.startedAt),
  index("portfolio_visits_client_idx").on(table.clientId),
]);

export const insertPortfolioClientLinkSchema = createInsertSchema(portfolioClientLinksTable).omit({ id: true, createdAt: true });
export const insertPortfolioVisitSchema = createInsertSchema(portfolioVisitsTable).omit({ startedAt: true, updatedAt: true });
export type InsertPortfolioClientLink = z.infer<typeof insertPortfolioClientLinkSchema>;
export type PortfolioClientLink = typeof portfolioClientLinksTable.$inferSelect;
export type InsertPortfolioVisit = z.infer<typeof insertPortfolioVisitSchema>;
export type PortfolioVisit = typeof portfolioVisitsTable.$inferSelect;
