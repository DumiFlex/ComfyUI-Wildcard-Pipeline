-- Cascade-edit undo. One row per cascade-apply transaction.
-- snapshot_before / snapshot_after are JSON arrays of entity rows
-- captured pre- and post-mutation, used to atomically restore on undo.

CREATE TABLE IF NOT EXISTS cascade_undo (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  target_kind     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  action          TEXT NOT NULL,
  snapshot_before TEXT NOT NULL,
  snapshot_after  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cascade_undo_created_at ON cascade_undo(created_at DESC);
