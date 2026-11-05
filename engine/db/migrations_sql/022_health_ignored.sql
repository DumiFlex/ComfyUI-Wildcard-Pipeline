-- Library health: findings the user chose to ignore.
--
-- The Library health page lists problems, warnings and clutter across the
-- library. "Ignore" hides one finding for good. The key names the check and
-- the item (`unused:module:ab12cd34`), so a finding that comes back for a
-- different reason shows again. Local-only, never exported or published.
--
-- NOTE: the migration runner splits on the semicolon char, so comments
-- must avoid it.

CREATE TABLE IF NOT EXISTS health_ignored (
  key        TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
