-- Bundles — library-tracked groupings of modules.
--
-- A bundle is a deep-cloned snapshot package: when the user "Save as
-- bundle", the full payloads + instance overrides of every contained
-- module are serialized into this table's `children` column as a JSON
-- array. On insert into a Context, the frontend deserializes that
-- JSON, regenerates uuids, and splices into modules[].
--
-- Bundles are intentionally frozen — library updates to the original
-- wildcards / combines / etc do NOT propagate into existing bundles.
-- Drift detection happens at the child instance level via existing
-- per-kind logic (each spliced child carries its own library_id +
-- payload_hash).
--
-- `color` is the user-picked hex for the frame around the bundle's
-- range in ContextWidget. When NULL/empty, the UI falls back to the
-- default `#46566B` token.
--
-- `payload_hash` is the content hash of `children` (and any other
-- fields that affect runtime behavior). Each inserted instance
-- captures this at insert time as `inserted_at_hash` so the UI can
-- show an informational "library updated" hint when the live entry's
-- hash diverges. This is NOT a conflict — bundles are frozen by
-- design.

CREATE TABLE IF NOT EXISTS bundles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  color        TEXT,
  category_id  TEXT REFERENCES module_categories(id) ON DELETE SET NULL,
  tags         TEXT NOT NULL DEFAULT '[]',
  is_favorite  INTEGER NOT NULL DEFAULT 0,
  children     TEXT NOT NULL DEFAULT '[]',
  payload_hash TEXT NOT NULL DEFAULT '',
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bundles_name       ON bundles(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_bundles_category   ON bundles(category_id);
CREATE INDEX IF NOT EXISTS idx_bundles_updated_at ON bundles(updated_at DESC);
