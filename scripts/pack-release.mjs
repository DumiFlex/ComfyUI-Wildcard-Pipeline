#!/usr/bin/env node
/**
 * pack-release.mjs — bundle the deployable file set into a zip for a
 * GitHub release asset. Called from `.releaserc.js` via the exec
 * plugin's `prepareCmd`. The result lives at
 *   dist/ComfyUI-Wildcard-Pipeline-v<version>.zip
 * and gets attached to the release by `@semantic-release/github`'s
 * `assets` config.
 *
 * Contents — everything ComfyUI needs to drop into custom_nodes/:
 *   - __init__.py           (extension entry)
 *   - pyproject.toml        (engine package)
 *   - engine/               (pure-python engine)
 *   - wp_nodes/             (V3 node definitions)
 *   - wp_api/               (HTTP routes the SPA hits)
 *   - js/                   (built extension chunk + lazy chunks)
 *   - web/             (built manager SPA)
 *   - public/               (favicons + doc images referenced by the SPA)
 *   - docs/help/            (per-node help markdown the canvas reads)
 *   - locales/              (node display names + settings labels ComfyUI reads)
 *   - README.md
 *   - LICENSE
 *
 * Explicitly excluded — dev-only or noisy:
 *   - node_modules/, .venv/, __pycache__/
 *   - tests/, src/ (source tree — build output ships, not source)
 *   - .github/, .husky/, .vscode/
 *   - docs/superpowers/ (per-contributor specs, gitignored anyway)
 *   - any *.map sourcemap files
 *
 * Usage: node scripts/pack-release.mjs <version>
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const version = process.argv[2];
if (!version) {
  console.error("usage: pack-release.mjs <version>");
  process.exit(1);
}

const root = process.cwd();
const distDir = join(root, "dist");
mkdirSync(distDir, { recursive: true });

const archiveName = `ComfyUI-Wildcard-Pipeline-v${version}.zip`;
const archivePath = join(distDir, archiveName);

// Ship list (top-level only — sub-tree walked recursively by zip CLI).
const SHIP_PATHS = [
  "__init__.py",
  "pyproject.toml",
  "README.md",
  "LICENSE",
  "engine",
  "wp_nodes",
  "wp_api",
  "js",
  "web",
  "public",
  "docs/help",
  // ComfyUI reads `custom_nodes/<pack>/locales/<lang>/` for node display
  // names, descriptions and settings labels (app/custom_node_manager.py).
  // The registry archive picks this up automatically because it ships
  // everything git-tracked that `.comfyignore` doesn't exclude; this list is
  // hand-maintained, so it did not. The two artifacts silently disagreed —
  // see DEV_ONLY below for the guard that now stops that recurring.
  "locales",
];

/**
 * Top-level tracked entries that deliberately do NOT ship.
 *
 * Exists to make the ship list total: every top-level path in git is either
 * shipped or listed here, and `assertShipListIsTotal` fails the release if a
 * new one appears in neither. Without it, adding a runtime directory and
 * forgetting this file produces a zip that installs and silently misbehaves —
 * which is exactly how `locales/` went missing.
 */
const DEV_ONLY = new Set([
  ".comfyignore", ".gitattributes", ".github", ".gitignore", ".husky", ".npmrc",
  ".releaserc.js", "CHANGELOG.md", "CLAUDE.md", "config", "conftest.py",
  "eslint.config.js", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "scripts", "src", "tests", "tsconfig.json", "tsconfig.node.json",
  "vite.config.mts", "vitest.config.ts",
]);

function assertShipListIsTotal() {
  const ls = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  if (ls.status !== 0) {
    console.warn("pack-release: `git ls-files` unavailable — skipping ship-list completeness check");
    return;
  }
  // A ship path may name a subtree (`docs/help`); its top-level segment is
  // what makes the parent directory "accounted for".
  const covered = new Set(SHIP_PATHS.map((p) => p.split("/")[0]));
  const tracked = new Set(
    ls.stdout.split("\n").map((line) => line.trim().split("/")[0]).filter(Boolean),
  );
  const unaccounted = [...tracked].filter((e) => !covered.has(e) && !DEV_ONLY.has(e)).sort();
  if (unaccounted.length > 0) {
    console.error("pack-release: top-level paths in git that are neither shipped nor dev-only:");
    for (const p of unaccounted) console.error(`  - ${p}`);
    console.error("Add each to SHIP_PATHS (ships to users) or DEV_ONLY (stays in the repo).");
    process.exit(1);
  }
}

assertShipListIsTotal();

// Sanity: every path must exist before zipping. If `js/` or `web/`
// is missing the release would ship a broken bundle — catch here so the
// release workflow fails fast rather than uploading a half-baked zip.
for (const p of SHIP_PATHS) {
  if (!existsSync(join(root, p))) {
    console.error(`pack-release: required path missing — ${p}`);
    console.error("Did the build step run? Expected `pnpm build` to populate js/ + web/.");
    process.exit(1);
  }
}

// Use the host's `zip` CLI (always present on the ubuntu-latest runner
// semantic-release runs from). Exclusion patterns kill sourcemaps +
// any python bytecode that slipped into the tree.
const excludes = [
  "*/__pycache__/*",
  "*.pyc",
  "*.map",
  "*/node_modules/*",
  "*/.pytest_cache/*",
];

const args = [
  "-r",
  "-q",
  archivePath,
  ...SHIP_PATHS,
  "-x",
  ...excludes,
];

const result = spawnSync("zip", args, { stdio: "inherit", cwd: root });
if (result.error?.code === "ENOENT") {
  // Windows has no `zip` by default, so a maintainer running this locally
  // otherwise gets a bare "exited with status null".
  console.error("pack-release: the `zip` CLI was not found on PATH.");
  console.error("The release workflow runs on ubuntu-latest where it is always present.");
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`pack-release: zip exited with status ${result.status}`);
  process.exit(result.status ?? 1);
}

const bytes = statSync(archivePath).size;
const mb = (bytes / (1024 * 1024)).toFixed(2);
console.log(`pack-release: wrote ${relative(root, archivePath)} (${mb} MB)`);
