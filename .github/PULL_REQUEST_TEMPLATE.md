<!--
Thanks for the PR! A few quick prompts to keep the review tight.
None of the sections are required by the bot — write what's useful
and skip the rest.
-->

## Summary

<!-- One paragraph: what changed + WHY. Reviewers should be able to
read this and reconstruct the motivation without opening the diff. -->

## Type of change

<!-- Tick all that apply. Conventional Commits rules in commitlint.config
mean the commit-type controls the next release version bump:
  - feat     → minor version bump
  - fix      → patch version bump
  - perf     → patch
  - refactor → patch
  - docs/style/test/build/ci/chore → no release
See .releaserc.js for the full filter. -->

- [ ] 🐛 `fix` — bug fix (patch release)
- [ ] ✨ `feat` — new feature (minor release)
- [ ] ⚡ `perf` — performance improvement (patch release)
- [ ] ♻️ `refactor` — internal rework, no behavioural change (patch release)
- [ ] 📖 `docs` — docs only (no release unless `docs(readme)`)
- [ ] 🧪 `test` — tests only
- [ ] 🛠️ `build` / `ci` — build system, CI workflows, tooling
- [ ] 🧹 `chore` — anything that doesn't fit above (no release)

## Related issues

<!-- "Closes #123, fixes #456" wires the PR to issue lifecycle. Drop
links to discussions / Discord threads if the discussion happened
elsewhere. -->

## Local verification

<!-- The pre-commit hook already runs lint + typecheck + vitest +
build + size + ruff + pytest. Confirm each landed green before push. -->

- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` clean (Vitest)
- [ ] `pnpm build:extension && pnpm size` within budget
- [ ] `pnpm build:manager` builds
- [ ] `ruff check .` clean
- [ ] `pytest -q` clean
- [ ] If touching engine: parity test (`pytest tests/syntax/test_determinism.py`) still passes

## Screenshots / before-after

<!-- For visible changes (canvas widgets, SPA views, docs pages) drop
in a before / after pair. The reviewer thanks you. -->

## Anything that could go wrong

<!-- Migration concerns? Workflow back-compat? A widget rename users
might trip over? Surface it here so the release notes can flag it. -->
