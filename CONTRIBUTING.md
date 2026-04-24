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

## Commit messages

Conventional Commits, enforced by commitlint. Examples:

- `feat(engine): add wildcard module handler`
- `fix(widgets): restore chip hover state after re-render`
- `chore: bump vite to 5.4`

## Pull requests

- Branch from `main`.
- One logical change per PR.
- All CI checks must pass (Python matrix + frontend + bundle-size gate).
