-- Test Runner scenarios — saved stacks the Test Runner re-runs on demand.
--
-- A scenario references library modules and bundles LIVE by id (the stack
-- JSON holds `{module: id}` / `{bundle: id}` items), so editing a module
-- changes the next run. That is the point: a stored baseline lets the
-- runner say which variables moved since. Local-only by design, never
-- exported or published.
--
-- Columns:
--   stack      JSON list of stack items, run top to bottom
--   pins       JSON object of pinned $var values (stand-ins for upstream)
--   seeds      JSON seed spec (from+count, random+count, or list)
--   output_var the variable the runner treats as the prompt, or NULL
--   baseline   JSON snapshot of a run to compare against, or NULL
--   last_run   JSON summary of the most recent run, or NULL
--
-- NOTE: the migration runner splits on the semicolon char, so comments
-- must avoid it.

CREATE TABLE IF NOT EXISTS test_scenarios (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  stack       TEXT NOT NULL DEFAULT '[]',
  pins        TEXT NOT NULL DEFAULT '{}',
  seeds       TEXT NOT NULL DEFAULT '{"from": 0, "count": 100}',
  output_var  TEXT,
  baseline    TEXT,
  last_run    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_test_scenarios_updated_at ON test_scenarios(updated_at DESC);
