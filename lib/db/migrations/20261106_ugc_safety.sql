-- Apple Guideline 1.2: blocking users, reporting content, and removing offenders.
-- ADDITIVE ONLY: three new tables. Nothing existing is changed. Safe to run more than once.
BEGIN;

CREATE TABLE IF NOT EXISTS user_blocks (
  id serial PRIMARY KEY,
  blocker_id text NOT NULL,
  blocked_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_pair_unique UNIQUE (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocker_idx ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks(blocked_id);

CREATE TABLE IF NOT EXISTS content_reports (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  target_id text NOT NULL,
  target_owner_id text,
  target_label text NOT NULL,
  reporter_id text NOT NULL,
  reporter_name text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  action text,
  admin_note text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_kind_check CHECK (kind IN ('store', 'product', 'review', 'user', 'block'))
);
CREATE INDEX IF NOT EXISTS content_reports_status_idx ON content_reports(status);

CREATE TABLE IF NOT EXISTS banned_users (
  user_id text PRIMARY KEY,
  reason text NOT NULL,
  banned_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
