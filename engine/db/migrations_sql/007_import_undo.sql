-- Import undo metadata. Stores the snapshot bundle needed to reverse a
-- single `commit_import` call: which ids the commit inserted (so undo
-- deletes them) and the full pre-replace row for every id the commit
-- overwrote (so undo restores them).
--
-- One row per import. The row id is the `undo_id` returned by
-- `commit_import` and consumed by `undo_import`. There is no GC policy
-- in this migration — the wp_api layer (Task 14) decides when to evict
-- old undo entries (e.g. "keep last N" or "expire after T").
--
-- All three JSON columns are opaque to SQLite — the importer module
-- defines + reads the shapes. See `engine/importer.py` module docstring
-- for the schema.

CREATE TABLE IF NOT EXISTS import_undo (
    id                  TEXT PRIMARY KEY,
    created_at          TEXT NOT NULL,
    imported_records    TEXT NOT NULL,        -- JSON list[{kind, id}]
    replaced_snapshots  TEXT NOT NULL,        -- JSON dict[id, {kind, row}]
    rename_map          TEXT NOT NULL         -- JSON dict[old_id, new_id]
);

CREATE INDEX IF NOT EXISTS idx_import_undo_created_at ON import_undo(created_at DESC);
