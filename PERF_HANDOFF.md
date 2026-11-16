# Performance pass: handoff (branch `perf/overall-smoothness`)

Temporary file for the test branch. **Delete it before merging into `dev`.**
Plan: `docs/superpowers/plans/2026-11-16-performance.md` (gitignored, local). Research
reports + scripts: `.tmp/perf-research/` (local, untracked).

## State
- Branch `perf/overall-smoothness` (pushed), based on `origin/dev` @ cf0ba11f. NOT merged
  into dev. Merge only after the user has tested it.
- Merged in: P0 guard, engine (P2), backend (P1, partial), canvas (P3, partial), manager
  (P4, partial), wp-kit (P6) via a temporary git pin.
- Final checks on the integrated branch (2026-11-16), all green:
  - pytest (CI-like py3.12 venv), 0 failures; ruff clean.
  - vitest 6567 passed.
  - typecheck clean; lint 0 errors (797 warnings, same as before).
  - css-isolation, build, size: main.js 6.3 KB gzip; total 738,626 / 741,376 B.
- Local quirks:
  - Node 26 here needs `NODE_OPTIONS=--no-experimental-webstorage` for vitest; CI uses Node 22.
  - ComfyUI's embedded Python lacks pytest-aiohttp, so use the venv: `uv venv --python 3.12`
    + `.[dev]` deps.
  - Pytest breaks in a worktree folder named `engine`/`backend` (the root `__init__.py` gets
    imported).

## Measured results (before → after)
| What | Before | After |
|---|---|---|
| Real queue on ComfyUI :8199, Context + Debug (heavy 45-module pipeline) | 186 ms | 38 ms |
| Real queue, 16-frame Context Loop + Context + Debug | 4,977 ms | 636 ms |
| WPContext.execute, cached catalog (bench) | ~312 ms | ~55 ms |
| Constraint apply, 500 options / 1000 exceptions | 121 ms | 1.1 ms |
| WP Debug payload | 279 KB | 158 KB |
| Canvas, our idle script, ex4 (65 nodes, Vue renderer) | 64 ms/s | 30 ms/s |
| Canvas, our idle script, 40-Context stress | 962 ms/s | 43 ms/s |
| Canvas, stress40 pan | 11.8 fps | 32.5 fps |
| Canvas, stress40 loaded heap | 461 MB | 249 MB |
| Manager boot JS (gzip) | 164 KB | 109 KB |
| Manager boot blocked main thread, 1× / 4× | 297 ms / 2.3 s | 183 ms / 1.4 s |
| Manager open 151-option wildcard, blocked, 1× / 4× | 0.75 s / 5.7 s | 0.27 s / 2.9 s |
| Manager typing in that editor p50, 1× / 4× | ~56 / 256 ms | 40 / 184 ms |
| Manager list search, bytes per search | 1–13.6 MB | 0 (client-side) |
| Manager search key p50 at 4× (Wildcards / All items) | 280 / 304 ms | 104 / 120 ms |
| Kit: forced layouts opening the 151-option editor | 155 | 3 |
| API event-loop stalls (tags status / export / preview / ai index / health) | 1.5–2.3 s / ~0.4 s / ~0.1 s / ~0.15 s / ~0.2 s | moved to worker threads (after numbers not re-measured) |

## Done (by area)
- **P0**
  - Determinism guard `tests/test_determinism_golden.py` + `tests/perf/synthetic.py` +
    golden `tests/fixtures/determinism-golden.json`. Covers single, chain and loop-with-holds.
    Must stay green without regenerating.
- **Engine (P2)**
  - Skips the tokenizer for strings without `@{`.
  - Builds the constraint exception index once per apply (private `_index` kwarg; public
    signature and multiply order unchanged).
  - Builds only the shown WP Debug option rows.
  - The hold base pass shares the read-only catalog (deepcopy memo).
  - Live-library catalog walk cached per (DB path, widget digest), up to 8 entries, with a
    re-validating hit (`engine/db/queries.py`).
  - WP Debug JSON is compact; the download is still pretty-printed.
  - Hold base pass reused across loop frames.
  - Opt-in bench `tests/perf/test_engine_bench.py` (`-m perf`).
- **Backend (P1, partial)**
  - Export stamp computed in one pass.
  - Exports and import commit/undo run off the event loop.
  - Tag list parsed in a worker thread once per build; `tags/status` reads
    `<taglist>.csv.status.json`.
  - Preview uses one connection, `migrate_once`, off the loop.
  - AI index rebuild skipped when the library is unchanged, and read off the loop.
  - Whole-library handlers run off the loop (`in_db_thread`; it runs inline when a test injects
    `wp_db`).
  - `synchronous=NORMAL` under WAL, `temp_store=MEMORY`, cached DB path.
- **Canvas (P3, partial)**
  - Poll results held in `shallowRef`.
  - Chain widget JSON parsed once per node (pairings, badges).
  - Memoised chain walks, pairings, producers and the assembler hash.
  - One shared poll scheduler; walkers recompute only when the graph revision moves.
  - Probe: `scripts/perf/canvas-measure.mjs` (+ `make-stress.mjs`).
  - Size `TOTAL_LIMIT` raised to 724 KB (dated note; +1.4 KB for the scheduler).
- **Manager (P4, partial)**
  - Row-validation lookup built once per catalog, with issues cached per row.
  - One shared library copy (`stores/libraryCache.ts`); list pages and searches filter it on
    the client.
  - Dashboard reads its counts from the catalogs (19 → 8 calls).
  - Health scanned once at boot; findings drawn 25 per group.
  - zod, the publish path and the AI chat moved out of the boot chunk.
  - Drift poll paused while the tab is hidden.
  - Probe: `scripts/perf/manager-measure.mjs` (+ sizes/compare/modules).
- **wp-kit (P6)**
  - Branch `perf/kit-layout` in DumiFlex/wp-kit (pushed, no PR). Commits:
    - 1201138: growable fields measured in one layout pass (`src/layout-batch.ts`).
    - 3d4df91: `v-bar-room` measured once per frame.
    - 07bbe71: fix for 0.20.1, where CSS-sized fields (RichTextInput) got a fixed height after
      font load, so wrapped options didn't grow. This is a visible behaviour change.
  - The app pins it temporarily: `package.json` `"@dumiflex/wp-kit":
    "github:DumiFlex/wp-kit#07bbe715…"` (commit 681bf05f).

## Behaviour changes to test
- List pages show the cached library. It revalidates after 60 s, or at once with Refresh, so a
  rename made in another tab shows up late.
- Drift/library polling pauses while the tab is hidden and catches up when it becomes visible.
- Health findings are drawn 25 per group.
- Option text fields grow when the text wraps (kit fix).
- WP Debug payload is compact JSON (the viewer download stays pretty-printed).
- Canvas: chips, conflict badges, pickers and subgraph badges now update through the shared
  scheduler. **Not hand-tested in either renderer.** Check edits, wiring, undo, subgraphs,
  workflow switching, and the classic (non-Vue) renderer.

## Known issues / regressions seen (verify)
- Canvas, stress40 after load: long tasks total 7.0 s → 11.9 s (86 tasks), although the load
  call is faster (3.7 s → 1.2 s). The load-time ×4 recompute collapse (P3.4b) wasn't done;
  probably related.
- Canvas, ex4 pan: 40.5 → 32.5 fps in one run (likely noise; re-measure).
- Manager boot still fetches `/modules` and `/bundles` twice (probably the drift-hash watch).
- `canvas-facts.test.ts` failed once under load in the manager worktree; passes alone and in the
  final full run.

## Deferred (not started)
- **Backend**
  - Lazy AI route imports.
  - Startup: first backup check on the backup thread, `VACUUM INTO` backups (DB is 93% free
    pages), and an asset-prune stamp.
  - Migration 024 (stored `payload_hash` column) and gzip for `/wp/api` JSON.
  - Switch `wp_nodes/context_node.py:_migrate_once` to `engine.db.migrations.migrate_once`
    (two tests patch `context_node._MIGRATED`).
- **Engine**
  - `build_resolve_ctx` / combine whole-ctx copies (~3%).
  - Explain only when a WP_Debug is downstream.
  - Per-frame SQLite open (~5 ms) and widget `json.loads` (~5 ms).
- **Canvas**
  - Collapse the load-time ×4 recompute.
  - Bookmarks: per-frame hook skipped when there are none; dock adaptive poll; drift-store
    hidden-tab pause on the canvas side.
  - Heap retention of removed WP nodes (21 MB/cycle measured now vs ~100 before; still
    present).
  - Page-wide MutationObservers, `dom-clip.ts`, and the subgraph badge 800 ms scans.
  - Boot chunk: lazy bookmark code, inline the fonts CSS, Options API flag.
  - `pnpm test:coverage` not run.
- **Manager**
  - P5.1: editor per-row components and cheap dirty tracking instead of two JSON
    serialisations per keystroke; broken-`@` memo; option windowing.
  - P5.4: AI drawer streaming re-render.
  - Duplicate boot fetch.
  - Coverage not run.
- **wp-kit**
  - Popover re-placement coalescing.

## Before merging into dev
1. User testing on this branch. The isolated dev ComfyUI at http://127.0.0.1:8199 runs it on a
   library copy (`.tmp/perf-research/comfy-user`).
2. Release wp-kit:
   1. PR `perf/kit-layout` → wp-kit `dev`, then dev → main.
   2. release-please tags it.
   3. A maintainer approves the staged npm version with 2FA.
   4. Replace the git pin with `^0.21.x` (`pnpm add -w @dumiflex/wp-kit@^0.21.0`).
3. Add `docs/release-notes/next.md` lines. Proposed:
   - "Faster runs: a WP Context with a big library is up to 5× faster and a 16-frame Context
     Loop about 7× faster (same picks for the same seed); WP Debug sends ~40% less data."
   - "Smoother canvas: big Context chains no longer keep the browser busy while idle."
   - "Snappier manager: lists search without reloading the library, a smaller first load,
     faster editors with many options; ComfyUI no longer freezes while the tag list loads or
     an export builds."
4. CLAUDE.md lines (proposed):
   - "Engine run caches — WP_Context caches the live-library catalog walk per (DB path, widget
     digest) and hands each run fresh copies; a hit re-reads the rows the walk used, so library
     edits re-walk (`engine/db/queries.py`). Loop frames reuse the hold base pass
     (`HOLD_BASE_MEMO_KEY`). Runs never write `ctx["__wp_catalog__"]`
     (`tests/engine/test_catalog_read_only.py`)."
   - "Library stores hold shallow catalogs (`stores/libraryCache.ts`); never mutate rows in
     place, replace the array."
   - Update the "Reactivity" bullet for the shared poll scheduler + graph revision.
   - Note `in_db_thread` for whole-library API handlers.
5. Delete this file, open a PR `perf/overall-smoothness` → `dev`, and squash-merge.

## Local cleanup
Worktrees under `E:\ComfyUIDev\wp-perf\` (backend, engine, canvas, manager, kit-verify with
local uncommitted alias edits), plus `wp-kit` clone, `venv312`, `kit-orig`, and kit scratch
dirs. Remove with `git worktree remove --force <path>` + delete the folder. The dev ComfyUI
on :8199 runs as a background job of the agent session.
