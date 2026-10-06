import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/** Additive startup migration also runs on publish against the deployment DB. */
export async function initializePortfolioAnalytics(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS portfolio_client_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS portfolio_visits (
    id uuid PRIMARY KEY,
    client_id uuid REFERENCES portfolio_client_links(id) ON DELETE CASCADE,
    started_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    seconds integer NOT NULL DEFAULT 0,
    sections jsonb NOT NULL DEFAULT '{}'::jsonb
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS portfolio_visits_started_idx ON portfolio_visits(started_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS portfolio_visits_client_idx ON portfolio_visits(client_id)`);
  await purgeOldPortfolioVisits();
}

export async function purgeOldPortfolioVisits(): Promise<void> {
  await db.execute(sql`DELETE FROM portfolio_visits WHERE started_at < now() - interval '90 days'`);
}
