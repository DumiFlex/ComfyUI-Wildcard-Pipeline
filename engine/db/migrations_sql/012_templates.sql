-- Prompt templates — reusable PromptAssembler template strings.
--
-- A template is just the assembler's `template` STRING ($var tokens).
-- Loading copies the string into a node's template widget with NO stored
-- back-reference, so (unlike bundles) templates can't drift — hence no
-- payload_hash / version columns. Referenced var names are derived from
-- the string on demand, never stored.
--
-- `category_id` FK mirrors bundles (ON DELETE SET NULL) — the API catches
-- sqlite3.IntegrityError on a bad category_id and returns 400. NOTE: the
-- migration runner splits on the semicolon char, so comments must avoid it.

CREATE TABLE IF NOT EXISTS templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  category_id     TEXT REFERENCES module_categories(id) ON DELETE SET NULL,
  tags            TEXT NOT NULL DEFAULT '[]',
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  template_string TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_name       ON templates(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_templates_category   ON templates(category_id);
CREATE INDEX IF NOT EXISTS idx_templates_updated_at ON templates(updated_at DESC);
