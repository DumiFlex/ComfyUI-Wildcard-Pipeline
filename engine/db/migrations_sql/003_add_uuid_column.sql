-- 003_add_uuid_column.sql
--
-- Adds an explicit, indexed `uuid` column to the `modules` table.
-- Backfills existing rows by extracting the trailing 8 hex chars of the
-- generated id (`<prefix>_<slug>_<token_hex(4)>` per ModuleRepository._gen_id).
--
-- After this migration, server code that needs canonical UUID lookup
-- (engine catalog, embed-bundle, drift hashes) does indexed equality
-- queries against `uuid` instead of `LIKE '%_<8hex>'` string scans.

ALTER TABLE modules ADD COLUMN uuid TEXT;

UPDATE modules
SET uuid = substr(id, -8)
WHERE uuid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_uuid ON modules(uuid)
