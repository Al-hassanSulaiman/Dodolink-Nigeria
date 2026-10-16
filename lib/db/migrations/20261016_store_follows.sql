BEGIN;
CREATE TABLE IF NOT EXISTS store_follows (
  user_id text NOT NULL,
  store_id integer NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);
CREATE INDEX IF NOT EXISTS store_follows_store_idx ON store_follows(store_id);
COMMIT;
