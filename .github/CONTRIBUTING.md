# Contributing

## Dev environment

Two supported paths:

**Recommended:** system Python ≥ 3.10 in a venv.

```bash
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
pnpm install
```

**Zero-install:** ComfyUI-Easy-Install embedded Python.

```bash
"E:\ComfyUIDev\ComfyUI-Easy-Install\python_embeded\python.exe" -m pip install pytest ruff
pnpm install
```

## Common commands

| Task | Command |
|---|---|
| Build extension | `pnpm build:extension` |
| Build manager | `pnpm build:manager` |
| Frontend tests | `pnpm test` |
| Python tests | `pytest` |
| Type check | `pnpm typecheck` |
| Lint | `pnpm lint` (a11y rules and `!` assertions are errors outside `eslint-baseline.json`; after fixing old warnings run `pnpm lint:baseline` to drop those files) |
| Bundle-size gate | `pnpm size` |
| CSS isolation check | `pnpm check:css-isolation` |
| Python lint | `ruff check .` |
| Python types | `pyright engine wp_nodes wp_api` (settings in `[tool.pyright]` in `pyproject.toml`; CI runs it) |
| Engine-parity fixtures | `python scripts/dump_engine_shapes.py` after any payload shape change |
| Docs search index | `pnpm docs:index` after editing a docs page |
| Kit guard baseline | `pnpm kit:baseline` after replacing hand-rolled controls with kit ones |

`CLAUDE.md` at the repo root lists the conventions the code relies on (engine
isolation, CSS prefixes, schema versions). Read it before a change that crosses
the engine, the nodes and the frontend.

## UI: use the component kit

Open **Settings › Advanced › Component kit** (`/wp/kit`) before building a
screen. It shows every shared control live in the current theme, with when to
use it and how to write it. Use those. When nothing fits, make the new
component in `src/manager/components/ui/` (manager) or `src/components/shared/`
(canvas and manager), and add its entry to `src/manager/kit/registry.ts` and a
demo to `src/manager/views/Kit.vue` in the same PR. Two tests hold this:
`kit-coverage.test.ts` fails on a kit-folder component without an entry, and
`scripts/kit-guard.test.mjs` fails when a file adds a native select, number,
checkbox or range input, an inline `<svg>`, its own `role="dialog"`, a raw
`<button>` in the manager or a raw hex colour. When a file gets fewer, run
`pnpm kit:baseline` and commit the lower baseline.

## Commit messages

Conventional Commits, enforced by commitlint. Examples:

- `feat(engine): add wildcard module handler`
- `fix(widgets): restore chip hover state after re-render`
- `chore: bump vite to 5.4`

## Pull requests

- Branch from `dev` and open the PR against `dev`. Only `dev` → `main` merges
  cut a release; pushing `dev` to `beta` cuts a GitHub prerelease for testing.
- One logical change per PR.
- All CI checks must pass (Python matrix + frontend + bundle-size gate).
- A visible change comes with a screenshot, and a feature updates the in-app
  docs (`src/manager/docs/pages/`) and `docs/release-notes/next.md` (one short
  paragraph; detail goes to the wiki).
- The bundle gate warns above the budget and fails 5% past it. If your change
  needs more room, raise `TOTAL_LIMIT` in `scripts/check-bundle-size.mjs` with
  a line saying why.

## Security

Please report vulnerabilities privately; see [SECURITY.md](../SECURITY.md).
