-- App Store guideline 1.2: block users and report content. Additive only.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id text NOT NULL,
  blocked_id text NOT NULL,
  blocked_label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx ON user_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS content_reports (
  id serial PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  target_label text NOT NULL DEFAULT '',
  reporter_id text NOT NULL,
  reporter_name text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_note text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reports_type_check CHECK (target_type in ('store', 'product', 'user'))
);
CREATE INDEX IF NOT EXISTS content_reports_status_idx ON content_reports (status);
