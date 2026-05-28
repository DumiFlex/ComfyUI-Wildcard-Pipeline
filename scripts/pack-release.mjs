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
 *   - web_dist/             (built manager SPA)
 *   - public/               (favicons + doc images referenced by the SPA)
 *   - docs/help/            (per-node help markdown the canvas reads)
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
  "web_dist",
  "public",
  "docs/help",
];

// Sanity: every path must exist before zipping. If `js/` or `web_dist/`
// is missing the release would ship a broken bundle — catch here so the
// release workflow fails fast rather than uploading a half-baked zip.
for (const p of SHIP_PATHS) {
  if (!existsSync(join(root, p))) {
    console.error(`pack-release: required path missing — ${p}`);
    console.error("Did the build step run? Expected `pnpm build` to populate js/ + web_dist/.");
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
if (result.status !== 0) {
  console.error(`pack-release: zip exited with status ${result.status}`);
  process.exit(result.status ?? 1);
}

const bytes = statSync(archivePath).size;
const mb = (bytes / (1024 * 1024)).toFixed(2);
console.log(`pack-release: wrote ${relative(root, archivePath)} (${mb} MB)`);
