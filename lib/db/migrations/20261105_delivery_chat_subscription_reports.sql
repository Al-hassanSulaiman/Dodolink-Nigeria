-- Delivery chat like the normal chat, company ratings, subscription and "report a problem".
-- ADDITIVE ONLY: adds nullable/defaulted columns and creates new tables.
-- Nothing is dropped, renamed or rewritten. Safe to run more than once.
BEGIN;

-- 1. Reply-to-message in delivery chats (media_url already exists).
ALTER TABLE delivery_messages ADD COLUMN IF NOT EXISTS reply_to_message_id integer
  REFERENCES delivery_messages(id) ON DELETE SET NULL;
ALTER TABLE delivery_messages ADD COLUMN IF NOT EXISTS reply_preview jsonb;

-- 2. Subscription fields for delivery companies (all empty/false for existing rows).
ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS qualified_at timestamptz;
ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS subscription_due_at timestamptz;
ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS subscription_last_paid_at timestamptz;
ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS subscription_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE delivery_agents ADD COLUMN IF NOT EXISTS paystack_email text;

CREATE TABLE IF NOT EXISTS delivery_subscription_payments (
  reference text PRIMARY KEY,
  agent_id integer NOT NULL REFERENCES delivery_agents(id) ON DELETE CASCADE,
  quoted_amount_kobo integer NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. One star rating per customer per company (changeable), no finished job needed.
CREATE TABLE IF NOT EXISTS delivery_company_ratings (
  id serial PRIMARY KEY,
  agent_id integer NOT NULL REFERENCES delivery_agents(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  stars integer NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_company_ratings_pair_unique UNIQUE (agent_id, customer_id),
  CONSTRAINT delivery_company_ratings_stars_check CHECK (stars BETWEEN 1 AND 5)
);

-- 4. Reports of a problem in a store chat or a delivery chat.
CREATE TABLE IF NOT EXISTS chat_reports (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  conversation_id integer NOT NULL,
  reporter_id text NOT NULL,
  reporter_name text NOT NULL,
  other_party_name text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_note text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_reports_kind_check CHECK (kind IN ('store', 'delivery'))
);
CREATE INDEX IF NOT EXISTS chat_reports_status_idx ON chat_reports(status);

COMMIT;
