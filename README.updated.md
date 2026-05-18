<p align="center">
  <img src="public/images/favicon.svg" width="120" alt="wildcard-pipeline logo" />
</p>

<h1 align="center">wildcard-pipeline</h1>

<p align="center"><em>Composable prompt context for ComfyUI.</em></p>

A modular prompt-construction system for ComfyUI. Build prompts from reusable
named variables — wildcards, fixed values, expressions, constraints, bundles —
managed through a built-in library SPA and composed inline in your workflow.

## What it does

Instead of writing one long prompt string per workflow, you author small reusable
**modules** that each emit one or more `$variable` bindings. A `WP_Context` node
holds an ordered list of modules; downstream, a `WP_PromptAssembler` fills
`$name` placeholders in your template using whatever those modules resolved to
on the current run.

The library lives in an embedded SQLite database, edited via a Vue SPA mounted
inside ComfyUI's web UI. Every module kind has its own editor screen, supports
categories, tags, and favorites, and surfaces drift when a module on a workflow
has diverged from its library state.

## Install

Clone into `ComfyUI/custom_nodes/`:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/DumiFlex/ComfyUI-WildcardPipeline.git
```

Restart ComfyUI. No extra Python dependencies — the engine is pure-Python and
the frontend ships pre-built JavaScript inside the repo.

## Quick start

1. Add a **`WP_Context`** node to your graph.
2. Open the library — there's a **"Open library"** button on the Context widget
   header. The SPA opens in a side panel. Create a wildcard module called
   `outfit` with a few options (e.g. `"red dress"`, `"blue suit"`).
3. Back on the graph, click **"+ Module"** on the Context widget and pick your
   `outfit` wildcard. The Context now produces a `$outfit` binding.
4. Wire `WP_Context.context` into a **`WP_PromptAssembler`** node.
5. Set the template on the assembler to something like
   `a photo of a person wearing $outfit, studio lighting`. The assembler resolves
   `$outfit` against the Context on every run.

## Nodes

| Node | Purpose |
|------|---------|
| `WP_Context` | Orchestrator. Holds an ordered list of modules, runs them in sequence, emits a typed context with the resolved `$variable` bindings. |
| `WP_ContextInjector` | Promotes arbitrary ComfyUI outputs (strings, ints, floats, anything) into named `$variable` bindings on a Context, alongside the regular module kinds. Drag any node output onto an injector socket, give it a name, use it like any other binding. |
| `WP_PromptAssembler` | Fills `$name` placeholders in a template using the resolved Context. Outputs a string ready for CLIPTextEncode or similar. |
| `WP_Debug` | Inspects a Context at any point in the chain. Shows resolved variables, drift state, conflicts. Handy mid-debug-graph. |

All nodes live under the `wildcard-pipeline` category and have id prefix `WP_`.
They use ComfyUI's V3 API.

## Module kinds

The Context widget accepts six kinds of modules. Each has its own editor in the
library SPA:

| Kind | What it does |
|------|--------------|
| **Wildcard** | Weighted random selection. Pick one option from a list each run. Options can reference other modules with `@{uuid}` syntax for nested resolution. |
| **Fixed Values** | One-to-many named string mapping. Set `$key1 = "value1"`, `$key2 = "value2"`, all bound in one module. Useful for locking prompts to known strings. |
| **Combine** | Template merge. Reads several `$inputs`, runs them through a small template (e.g. `"$adjective $color $object"`), stores the result into a new `$output`. |
| **Derivation** | JavaScript expression. Compute a value from other variables using a sandboxed eval (`$a.toUpperCase() + " " + $b`). |
| **Constraint** | Conditional rule. If condition A holds, set/override variable B. Layered on top of other modules to enforce relationships. |
| **Bundle** | Group of modules treated as a reusable unit. Wrap a contiguous range of modules in a bundle to package + share them as one library entry. Children are stored as frozen snapshots — library updates do NOT propagate to in-flight workflows. |

## Library manager (SPA)

The SPA is a full single-page app mounted at `/wp/` inside ComfyUI's server.
Sections:

- **Dashboard** — recent activity, quick links
- **Pipelines, Wildcards, Fixed Values, Combines, Derivations, Constraints,
  Bundles** — one list view + one editor per kind. Filter by category /
  favorites / tags. Drag-to-reorder where applicable.
- **Categories** — colored tags shared across kinds for grouping
- **Import / Export** — full library round-trip via a JSON bundle file
- **Test Runner** — exercise a module's resolution against random seeds, see
  the histogram
- **Settings** — display preferences (kind icons vs chips, indicator style,
  border highlight, etc), conflict scanner mode, default-new-disabled toggle

The Context widget on the graph stays in sync with the library: edit a wildcard
in the SPA → the Context widget shows a "drifted" badge on any matching row,
and a one-click **Refresh from library** option in the right-click menu pulls
the new state in.

## Bundle system

Bundles are library-tracked groups of modules. Creating one:

1. Right-click any unbundled row on a Context → **Wrap into new bundle**.
   The row gets wrapped + a new library entry is created (auto-named from the
   row's display name; you can rename it later in the SPA).
2. Drag more modules into the bundle's frame to extend the range.
3. Use the **bundle picker** (`+ Bundle` button on Context) to insert the same
   bundle into other Contexts. Each insert deep-clones the children and remaps
   uuids so the same bundle can be used twice in one Context without collision.

Bundles store **frozen snapshots** of their children at insert time. Library
updates don't propagate automatically — instead, the bundle right-click menu
exposes:

- **Reset to library snapshot** — discard local edits, pull the library state
- **Save changes to library** — push current children back, overwriting the
  library entry

Per-bundle color (default `#46566B`, user-overridable in the SPA editor),
collapse/expand, disable-cascade-to-children, and per-child reset paths are all
supported.

## Architecture

```
engine/         — pure Python, zero ComfyUI imports. Pytest-runnable in isolation.
wp_nodes/       — ComfyUI V3 node definitions. Wraps the engine for the graph runtime.
wp_api/         — aiohttp routes (/wp/api/*) backing the SPA. Mounts on ComfyUI's server.
src/            — Vue 3 + Vite frontend. Two build targets:
  ├─ extension  — js/main.js + lazy chunks injected into ComfyUI's graph UI
  └─ manager    — web_dist/ SPA bundle served at /wp/
tests/          — pytest. Engine is testable without ComfyUI.
scripts/        — Node helpers (bundle-size gate, docs sync, release tooling)
docs/help/      — per-node markdown help pages, copied into js/docs at build
```

The engine is engine-isolated: nothing in `engine/` imports from `wp_nodes`,
`comfy_api`, or `torch`. The pipeline orchestrator works on plain dicts, which
makes it cheap to unit-test and easy to keep deterministic.

## Development

Requires Python 3.10+ and Node 20+. pnpm is the package manager.

```bash
# Install JS deps
pnpm install

# Build the extension (ships into js/)
pnpm build:extension

# Build the SPA (ships into web_dist/)
pnpm build:manager

# Build everything
pnpm build

# Run tests
pnpm test         # Vitest (frontend)
pnpm test:py      # Pytest (engine + API)
pytest -q         # also works

# Typecheck + lint
pnpm typecheck    # vue-tsc --noEmit
pnpm lint         # eslint flat config
ruff check .      # Python lint

# Bundle-size gate
pnpm size

# Watch mode for development
pnpm dev          # rebuilds extension on save
```

Pre-commit runs typecheck + lint + tests + build + size + ruff + pytest. All
must pass. Conventional Commits are enforced by commitlint (`feat:`, `fix:`,
`refactor:`, etc, lowercase subject, ≤100 char header).

Per-project conventions are in [`CLAUDE.md`](./CLAUDE.md). Contributor guide is
in [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md).

## Status

**Version**: 1.7.0 (alpha → beta, daily-driver usable for prompt construction).

Recent milestones:
- Bundle system end-to-end (library, picker, wrap-from-Context, drag/drop, reset/save)
- Instance overrides (per-row config that doesn't mutate library state)
- Drift detection across all kinds with per-row badges + refresh paths
- ContextInjector (promote any ComfyUI graph output into a `$variable`)
- Display preferences (icon vs chip rendering, indicator style, border accents)
- Conflict scanner (advisory warnings for shadowed vars, missing template vars)
- SPA categories, favorites, tags, test runner, import/export

In progress:
- Bundle drag/drop polish (frame motion, FLIP-move on reorder)
- SPA editor layout consistency
- Legacy pipeline-kind removal
- Icon refresh across the SPA

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
