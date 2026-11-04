-- Delivery phase 2 (ratings, disputes, payments). ADDITIVE ONLY:
-- two new tables and a few new nullable/defaulted columns on the delivery_* tables
-- created yesterday. No existing store/chat/product/subscription table is touched.
-- Safe to run more than once.
BEGIN;

ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS bank_code text;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS transfer_code text;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS paystack_fee_kobo integer NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS refunded_kobo integer NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS code_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders ADD COLUMN IF NOT EXISTS payout_note text;

CREATE TABLE IF NOT EXISTS delivery_ratings (
  id serial PRIMARY KEY,
  order_id integer NOT NULL UNIQUE REFERENCES delivery_orders(id) ON DELETE CASCADE,
  agent_id integer NOT NULL REFERENCES delivery_agents(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  stars integer NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_ratings_stars_check CHECK (stars BETWEEN 1 AND 5)
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
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_disputes_order_idx ON delivery_disputes(order_id);

COMMIT;
