-- Delivery feature, phase 1. ADDITIVE ONLY: creates four new tables and touches
-- no existing table, column or row. Safe to run more than once.
BEGIN;

CREATE TABLE IF NOT EXISTS delivery_agents (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  image_url text,
  bio text,
  linked_user_id text UNIQUE,
  delivery_type text NOT NULL CHECK (delivery_type IN ('intrastate', 'interstate', 'both')),
  home_state text,
  covered_states text[] NOT NULL DEFAULT '{}',
  nationwide boolean NOT NULL DEFAULT false,
  bank_name text,
  bank_account_number text,
  bank_account_name text,
  paystack_recipient_code text,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_conversations (
  id serial PRIMARY KEY,
  customer_id text NOT NULL,
  customer_name text NOT NULL,
  agent_id integer NOT NULL REFERENCES delivery_agents(id) ON DELETE CASCADE,
  last_message text,
  last_message_at timestamptz,
  customer_unread integer NOT NULL DEFAULT 0,
  agent_unread integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_conversations_pair_unique UNIQUE (customer_id, agent_id)
);
CREATE INDEX IF NOT EXISTS delivery_conversations_agent_idx ON delivery_conversations(agent_id);

CREATE TABLE IF NOT EXISTS delivery_messages (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES delivery_conversations(id) ON DELETE CASCADE,
  sender_id text NOT NULL,
  sender_name text NOT NULL,
  sender_type text NOT NULL,
  body text NOT NULL,
  media_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_messages_conversation_idx ON delivery_messages(conversation_id);

CREATE TABLE IF NOT EXISTS delivery_orders (
  id serial PRIMARY KEY,
  customer_id text NOT NULL,
  agent_id integer NOT NULL REFERENCES delivery_agents(id),
  conversation_id integer REFERENCES delivery_conversations(id) ON DELETE SET NULL,
  pickup_state text NOT NULL,
  drop_state text NOT NULL,
  description text,
  amount_kobo integer NOT NULL,
  platform_fee_kobo integer NOT NULL,
  agent_amount_kobo integer NOT NULL,
  paystack_reference text UNIQUE,
  status text NOT NULL DEFAULT 'requested',
  delivery_code_hash text,
  payout_status text NOT NULL DEFAULT 'none',
  transfer_reference text UNIQUE,
  paid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_orders_customer_idx ON delivery_orders(customer_id);
CREATE INDEX IF NOT EXISTS delivery_orders_agent_idx ON delivery_orders(agent_id);

COMMIT;
