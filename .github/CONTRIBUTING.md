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
| Lint | `pnpm lint` |
| Bundle-size gate | `pnpm size` |
| CSS isolation check | `pnpm check:css-isolation` |
| Python lint | `ruff check .` |
| Python types | `pyright` (see `[tool.pyright]` in `pyproject.toml`) |
| Engine-parity fixtures | `python scripts/dump_engine_shapes.py` after any payload shape change |
| Docs search index | `pnpm docs:index` after editing a docs page |

`CLAUDE.md` at the repo root lists the conventions the code relies on (engine
isolation, CSS prefixes, schema versions). Read it before a change that crosses
the engine, the nodes and the frontend.

## Commit messages

Conventional Commits, enforced by commitlint. Examples:

- `feat(engine): add wildcard module handler`
- `fix(widgets): restore chip hover state after re-render`
- `chore: bump vite to 5.4`

## Pull requests

- Branch from `dev` and open the PR against `dev`. Only `dev` → `main` merges
  cut a release.
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
