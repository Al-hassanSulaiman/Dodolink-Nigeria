-- Additive, backwards-compatible. Apply to the target database before releasing
-- API code that selects these columns. Cloud Build's DB is disposable CI only;
-- it does not migrate the external production Cloud SQL database.
BEGIN;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_preview jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS product_id integer;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS product_preview jsonb;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'messages'::regclass
      AND conname = 'messages_reply_to_message_id_messages_id_fk'
  ) THEN
    ALTER TABLE messages ADD CONSTRAINT messages_reply_to_message_id_messages_id_fk
      FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL;
  END IF;
END $$;
COMMIT;
