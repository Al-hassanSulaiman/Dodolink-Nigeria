-- Delivery phase 2 (ratings, disputes, bank code). ADDITIVE ONLY and re-runnable:
-- one new column on the (new) delivery_agents table, and two new tables.
-- No existing store, chat, product or subscription table is touched.
BEGIN;

ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS bank_code text;

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
  decision text,
  admin_note text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_disputes_order_idx ON delivery_disputes(order_id);

COMMIT;
