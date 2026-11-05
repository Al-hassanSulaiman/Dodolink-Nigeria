-- Lets the owner choose which admin pages each admin may open.
-- ADDITIVE: one nullable column. Existing admins stay NULL = full access, so nothing changes for them.
ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions text[];
