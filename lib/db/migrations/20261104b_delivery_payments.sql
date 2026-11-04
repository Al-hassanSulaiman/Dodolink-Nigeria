-- Delivery feature, phase 2 (ratings, disputes, payments, payouts).
-- ADDITIVE ONLY. Adds three new tables and a few new columns to the
-- delivery_* tables created yesterday (which hold no payment data yet).
-- No pre-existing DodoLink table (stores, chats, users, subscriptions) is touched.
-- Safe to run more than once.
BEGIN;

ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS bank_code text;

ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS refund_kobo integer NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS paystack_fee_kobo integer;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS code_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS payout_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS transfer_code text;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS payout_error text;

CREATE TABLE IF NOT EXISTS delivery_ratings (
  id serial PRIMARY KEY,
  order_id integer NOT NULL UNIQUE REFERENCES delivery_orders(id) ON DELETE CASCADE,
  agent_id integer NOT NULL REFERENCES delivery_agents(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_ratings_agent_idx ON delivery_ratings(agent_id);

CREATE TABLE IF NOT EXISTS delivery_disputes (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  opened_by text NOT NULL,
  opened_by_role text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  admin_note text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_disputes_one_open ON delivery_disputes(order_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS delivery_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

COMMIT;
