-- 003_add_uuid_column.sql
--
-- Adds an explicit, indexed `uuid` column to the `modules` table.
-- Backfills existing rows by extracting the trailing 8 hex chars of the
-- generated id (`<prefix>_<slug>_<token_hex(4)>` per ModuleRepository._gen_id).
--
-- After this migration, server code that needs canonical UUID lookup
-- (engine catalog, embed-bundle, drift hashes) does indexed equality
-- queries against `uuid` instead of `LIKE '%_<8hex>'` string scans.
--
-- Partial-apply note: SQLite's Python binding implicitly commits DDL
-- before the surrounding `with conn:` block can roll back. If the final
-- CREATE UNIQUE INDEX fails because two pre-existing rows share the same
-- trailing 8-hex chars (collision probability ~10^-6 for libraries with
-- <1000 modules), the column is added but the migrations table is not
-- bumped, and a retry would fail with `duplicate column name: uuid`.
-- Recovery is manual: rename one of the colliding ids in the modules
-- table, then re-run migrate(). This is acceptable for a forward-only
-- one-shot migration on a per-user library DB. Collisions in practice
-- are vanishingly rare and recoverable.

ALTER TABLE modules ADD COLUMN uuid TEXT;

UPDATE modules
SET uuid = substr(id, -8)
WHERE uuid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_uuid ON modules(uuid);
