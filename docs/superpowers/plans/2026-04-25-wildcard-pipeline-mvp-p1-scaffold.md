# P1 — Project Scaffold & Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the empty but fully-tooled `ComfyUI-WildcardPipeline` repo — git, pnpm, Vite, pytest, ruff, semantic-release, commitlint, husky, GitHub Actions, bundle-size gate, and a minimal extension entry that builds and loads in ComfyUI without errors.

**Architecture:** The project lives at `E:\ComfyUIDev\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-WildcardPipeline\`. That directory is currently inside ComfyUI's outer git work tree (worktree-artifact); this plan initializes a fresh nested git repo there and excludes the folder from the outer tree. The `.claude/` and `docs/` trees already exist and are preserved. Two Vite build targets are set up from day one (`extension` → `js/main.js`, `manager` → `web_dist/`), with the manager target producing only a stub HTML. All tooling is validated by command-line runs (build, test, size gate, commitlint).

**Tech Stack:** Python ≥ 3.10 (ruff + pytest), Node 20 + pnpm (Vite 5 + Vue 3 + vue-tsc + Vitest + ESLint), husky v9, commitlint, semantic-release, GitHub Actions.

**Project root (absolute):** `E:\ComfyUIDev\ComfyUI-Easy-Install\ComfyUI\custom_nodes\ComfyUI-WildcardPipeline`

Throughout this plan, `$PROJECT_ROOT` refers to the absolute path above. Commands are run from that directory unless stated otherwise.

---

## Task 1: Initialize nested git repo and exclude from outer tree

**Files:**
- Create: `$PROJECT_ROOT/.gitignore`
- Modify: `E:\ComfyUIDev\ComfyUI-Easy-Install\ComfyUI\.git\info\exclude` (append a line)

- [ ] **Step 1: Verify outer ComfyUI repo currently tracks our folder**

Run from `$PROJECT_ROOT`:
```bash
git -C "E:/ComfyUIDev/ComfyUI-Easy-Install/ComfyUI" ls-files --error-unmatch -- custom_nodes/ComfyUI-WildcardPipeline 2>&1 | head -5 || echo "not tracked"
```

Expected: either a list of already-tracked files (means we must untrack) or `not tracked`.

- [ ] **Step 2: If any files are tracked by outer repo, remove them from the index (keep on disk)**

Only run if Step 1 listed files:
```bash
git -C "E:/ComfyUIDev/ComfyUI-Easy-Install/ComfyUI" rm -r --cached custom_nodes/ComfyUI-WildcardPipeline
git -C "E:/ComfyUIDev/ComfyUI-Easy-Install/ComfyUI" commit -m "chore: exclude ComfyUI-WildcardPipeline from outer tree (nested repo)"
```

- [ ] **Step 3: Append exclusion rule to outer repo's local exclude**

Add the line `custom_nodes/ComfyUI-WildcardPipeline/` to
`E:\ComfyUIDev\ComfyUI-Easy-Install\ComfyUI\.git\info\exclude`.

Verify:
```bash
grep -n "ComfyUI-WildcardPipeline" "E:/ComfyUIDev/ComfyUI-Easy-Install/ComfyUI/.git/info/exclude"
```
Expected: one line match.

- [ ] **Step 4: Initialize a new git repo inside `$PROJECT_ROOT`**

```bash
cd "$PROJECT_ROOT"
git init -b main
```

Expected: `Initialized empty Git repository in .../ComfyUI-WildcardPipeline/.git/`.

- [ ] **Step 5: Create `.gitignore`**

Write `$PROJECT_ROOT/.gitignore`:
```gitignore
# Python
__pycache__/
*.pyc
*.pyo
.pytest_cache/
.ruff_cache/
.venv/
*.egg-info/

# Node / pnpm
node_modules/
pnpm-debug.log
.pnpm-store/

# Build outputs
js/
web_dist/
coverage/

# Editor / OS
.vscode/
.idea/
.DS_Store
Thumbs.db

# Claude / Superpowers workspace artifacts
.superpowers/
.claude/worktrees/

# Semantic release
.releaserc.local.js
```

- [ ] **Step 6: First commit (empty infrastructure commit)**

```bash
cd "$PROJECT_ROOT"
git add .gitignore
git commit -m "chore: init repo with .gitignore"
```

Expected: commit succeeds on `main` branch.

- [ ] **Step 7: Verify outer repo no longer shows our folder**

```bash
git -C "E:/ComfyUIDev/ComfyUI-Easy-Install/ComfyUI" status --short custom_nodes/ComfyUI-WildcardPipeline
```
Expected: empty output.

---

## Task 2: Write `pyproject.toml` (package metadata + ruff + pytest)

**Files:**
- Create: `$PROJECT_ROOT/pyproject.toml`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "comfyui-wildcard-pipeline"
version = "0.0.0"
description = "Modular procedural prompt generation for ComfyUI — wildcards, constraints, derivations, and context pipelines."
readme = "README.md"
requires-python = ">=3.10"
license = { text = "GPL-3.0-or-later" }
authors = [{ name = "DumiFlex" }]
keywords = ["comfyui", "wildcards", "prompt-generation", "stable-diffusion"]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Intended Audience :: End Users/Desktop",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
]
dependencies = []

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "ruff>=0.5",
]

[project.urls]
Homepage = "https://github.com/DumiFlex/ComfyUI-WildcardPipeline"
Repository = "https://github.com/DumiFlex/ComfyUI-WildcardPipeline"
Issues = "https://github.com/DumiFlex/ComfyUI-WildcardPipeline/issues"

[tool.comfy]
PublisherId = "dumiflex"
DisplayName = "Wildcard Pipeline"
Icon = ""

[tool.ruff]
line-length = 100
target-version = "py310"
extend-exclude = ["js", "web_dist", "node_modules"]

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
ignore = []

[tool.pytest.ini_options]
minversion = "8.0"
testpaths = ["tests"]
addopts = "-ra -q"
python_files = ["test_*.py"]
python_classes = ["Test*"]
python_functions = ["test_*"]
asyncio_mode = "auto"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"
```

- [ ] **Step 2: Verify ruff can load config**

With ruff installed in a venv or on PATH:
```bash
cd "$PROJECT_ROOT"
ruff check --select E9 . 2>&1 || true
```
Expected: no config parse errors (only possibly "No Python files found").

- [ ] **Step 3: Verify pytest can load config**

```bash
cd "$PROJECT_ROOT"
pytest --collect-only 2>&1 | head -20 || true
```
Expected: no ini-file errors. Exit with "no tests ran" or "collected 0 items" is fine at this stage.

- [ ] **Step 4: Commit**

```bash
cd "$PROJECT_ROOT"
git add pyproject.toml
git commit -m "chore: add pyproject.toml with ruff and pytest config"
```

---

## Task 3: Write `package.json`, `pnpm-workspace.yaml`, install deps

**Files:**
- Create: `$PROJECT_ROOT/package.json`
- Create: `$PROJECT_ROOT/pnpm-workspace.yaml`
- Create: `$PROJECT_ROOT/.npmrc`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "comfyui-wildcard-pipeline",
  "version": "0.0.0-dev",
  "private": true,
  "description": "Modular procedural prompt generation for ComfyUI",
  "author": "DumiFlex",
  "license": "GPL-3.0-or-later",
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "dev": "vite build --watch --mode extension",
    "build:extension": "vite build --mode extension",
    "build:manager": "vite build --mode manager",
    "build": "pnpm build:extension && pnpm build:manager",
    "typecheck": "vue-tsc --noEmit",
    "lint": "eslint \"src/**/*.{ts,vue}\"",
    "size": "node scripts/check-bundle-size.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:py": "pytest",
    "prepare": "husky"
  },
  "dependencies": {
    "vue": "^3.5.12"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "@vitejs/plugin-vue": "^5.1.4",
    "@vue/tsconfig": "^0.5.1",
    "eslint": "^9.14.0",
    "eslint-plugin-vue": "^9.31.0",
    "husky": "^9.1.6",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4",
    "vue-tsc": "^2.1.10"
  }
}
```

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - .
```

- [ ] **Step 3: Write `.npmrc`**

```
engine-strict=true
```

- [ ] **Step 4: Install dependencies**

```bash
cd "$PROJECT_ROOT"
pnpm install
```

Expected: lockfile `pnpm-lock.yaml` generated, `node_modules/` populated, no peer-dep errors that halt the install.

- [ ] **Step 5: Commit**

```bash
cd "$PROJECT_ROOT"
git add package.json pnpm-workspace.yaml .npmrc pnpm-lock.yaml
git commit -m "chore: add package.json with pnpm and core dev deps"
```

Note: `node_modules/` is already gitignored — do not stage it.

---

## Task 4: Write `tsconfig.json` with strict mode and path alias

**Files:**
- Create: `$PROJECT_ROOT/tsconfig.json`
- Create: `$PROJECT_ROOT/tsconfig.node.json`
- Create: `$PROJECT_ROOT/src/env.d.ts`
- Create: `$PROJECT_ROOT/src/typings/comfyui.d.ts`

- [ ] **Step 1: Write `tsconfig.json`**

```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "#comfyui/app": ["src/typings/comfyui.d.ts"]
    },
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "src/**/*.vue", "src/**/*.d.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 2: Write `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.mts", "scripts/**/*.mjs"]
}
```

- [ ] **Step 3: Write `src/env.d.ts`**

```ts
/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
```

- [ ] **Step 4: Write minimal `src/typings/comfyui.d.ts` (will grow during P3/P4)**

```ts
// Stubs for ComfyUI's frontend globals, extended as needed.
declare module "#comfyui/app" {
  export interface ComfyApp {
    graph: unknown;
    registerExtension(ext: {
      name: string;
      getCustomWidgets?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
      beforeRegisterNodeDef?: (nodeType: unknown, nodeData: unknown) => Promise<void> | void;
    }): void;
  }
  export const app: ComfyApp;
}
```

- [ ] **Step 5: Run typecheck — should succeed with no Vue/TS files yet**

```bash
cd "$PROJECT_ROOT"
pnpm typecheck
```

Expected: no type errors. If errors mention missing `@vue/tsconfig` types, re-run `pnpm install`.

- [ ] **Step 6: Commit**

```bash
cd "$PROJECT_ROOT"
git add tsconfig.json tsconfig.node.json src/env.d.ts src/typings/comfyui.d.ts
git commit -m "chore: add TypeScript config with strict mode and path aliases"
```

---

## Task 5: Write `vite.config.mts` with two build modes + stub entry

**Files:**
- Create: `$PROJECT_ROOT/vite.config.mts`
- Create: `$PROJECT_ROOT/src/main.ts`
- Create: `$PROJECT_ROOT/src/manager.ts`
- Create: `$PROJECT_ROOT/src/manager.html`

- [ ] **Step 1: Write `vite.config.mts`**

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// Two build targets controlled by --mode flag:
//   pnpm build:extension → js/main.js  (ComfyUI web extension, critical-path bundle)
//   pnpm build:manager   → web_dist/   (standalone SPA, post-MVP)

export default defineConfig(({ mode }) => {
  const isExtension = mode === "extension" || mode === "development";

  const common = {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
        vue: "vue/dist/vue.runtime.esm-bundler.js",
      },
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  };

  if (isExtension) {
    return {
      ...common,
      build: {
        lib: {
          entry: resolve(__dirname, "src/main.ts"),
          formats: ["es"] as const,
          fileName: "main",
        },
        rollupOptions: {
          external: ["#comfyui/app"],
          output: {
            dir: "js",
            entryFileNames: "main.js",
            chunkFileNames: "assets/[name]-[hash].js",
            assetFileNames: "assets/[name]-[hash][extname]",
          },
        },
        minify: "esbuild",
        sourcemap: "hidden",
        cssCodeSplit: true,
        reportCompressedSize: true,
        emptyOutDir: true,
      },
      test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
      },
    };
  }

  // Manager SPA — post-MVP, built as empty stub
  return {
    ...common,
    base: "/wildcard-pipeline/",
    build: {
      outDir: "web_dist",
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, "src/manager.html"),
      },
    },
  };
});
```

- [ ] **Step 2: Write minimal `src/main.ts`**

```ts
import { app } from "#comfyui/app";

app.registerExtension({
  name: "wildcard-pipeline",
});

console.info("[wildcard-pipeline] extension loaded");
```

- [ ] **Step 3: Write stub `src/manager.ts`**

```ts
const root = document.getElementById("app");
if (root) {
  root.textContent = "Wildcard Pipeline Manager — placeholder (post-MVP)";
}
```

- [ ] **Step 4: Write `src/manager.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Wildcard Pipeline Manager</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/manager.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Build extension — verify output**

```bash
cd "$PROJECT_ROOT"
pnpm build:extension
```

Expected: `js/main.js` exists, very small (expect < 1 KB — it's just a one-line registerExtension call).
```bash
ls -la "$PROJECT_ROOT/js/"
```

- [ ] **Step 6: Build manager — verify output**

```bash
cd "$PROJECT_ROOT"
pnpm build:manager
```

Expected: `web_dist/index.html` and a small JS chunk exist.

- [ ] **Step 7: Commit**

```bash
cd "$PROJECT_ROOT"
git add vite.config.mts src/main.ts src/manager.ts src/manager.html
git commit -m "chore: add Vite config with extension and manager build modes"
```

---

## Task 6: Write bundle-size gate script

**Files:**
- Create: `$PROJECT_ROOT/scripts/check-bundle-size.mjs`

- [ ] **Step 1: Write `scripts/check-bundle-size.mjs`**

```js
#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const JS_DIR = new URL("../js", import.meta.url).pathname;

// Budgets (gzipped bytes) — tune only with explicit review
const ENTRY_LIMIT = 30 * 1024;      // 30 KB
const TOTAL_LIMIT = 250 * 1024;     // 250 KB

function gzipSize(path) {
  return gzipSync(readFileSync(path)).length;
}

function allJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...allJsFiles(full));
    } else if (name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

let failed = false;

const files = allJsFiles(JS_DIR);
let total = 0;
console.log(`\nBundle size report (gzipped):\n`);
for (const file of files) {
  const size = gzipSize(file);
  total += size;
  const rel = file.substring(JS_DIR.length + 1);
  console.log(`  ${rel.padEnd(40)}  ${(size / 1024).toFixed(2).padStart(7)} KB`);
}
console.log(`  ${"TOTAL".padEnd(40)}  ${(total / 1024).toFixed(2).padStart(7)} KB`);

const entry = files.find((f) => f.endsWith("main.js"));
if (entry) {
  const entrySize = gzipSize(entry);
  if (entrySize > ENTRY_LIMIT) {
    console.error(`\n✗ Entry main.js gzip ${entrySize} bytes exceeds budget ${ENTRY_LIMIT}`);
    failed = true;
  } else {
    console.log(`\n✓ Entry within budget (${entrySize} / ${ENTRY_LIMIT} bytes gzipped)`);
  }
}

if (total > TOTAL_LIMIT) {
  console.error(`✗ Total js/ gzip ${total} bytes exceeds budget ${TOTAL_LIMIT}`);
  failed = true;
} else {
  console.log(`✓ Total within budget (${total} / ${TOTAL_LIMIT} bytes gzipped)`);
}

process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Create scripts directory and make script visible**

```bash
cd "$PROJECT_ROOT"
mkdir -p scripts
# (file already created in Step 1 above via Write tool)
```

- [ ] **Step 3: Run size gate against current build**

```bash
cd "$PROJECT_ROOT"
pnpm size
```

Expected: both checks pass (tiny stub entry). Output shows the report.

- [ ] **Step 4: Commit**

```bash
cd "$PROJECT_ROOT"
git add scripts/check-bundle-size.mjs
git commit -m "chore: add bundle-size gate script"
```

---

## Task 7: Write `conftest.py` sys.path shim

**Files:**
- Create: `$PROJECT_ROOT/conftest.py`
- Create: `$PROJECT_ROOT/tests/__init__.py`
- Create: `$PROJECT_ROOT/tests/test_sanity.py`

- [ ] **Step 1: Write `conftest.py`**

```python
"""Root conftest — lets pytest import engine/nodes without installing the package.

Also collects-ignores ComfyUI-dependent directories when comfy_api is absent.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

collect_ignore: list[str] = []

try:
    import comfy_api  # noqa: F401
except ImportError:
    # Tests for node wrappers require comfy_api; skip them when unavailable.
    collect_ignore.append("tests/test_nodes.py")
```

- [ ] **Step 2: Write `tests/__init__.py`** (empty file, marks directory as package)

```python
```

- [ ] **Step 3: Write `tests/test_sanity.py`**

```python
"""One trivial test to verify pytest discovery + conftest shim work."""

from __future__ import annotations


def test_pytest_runs():
    assert 1 + 1 == 2
```

- [ ] **Step 4: Run pytest**

```bash
cd "$PROJECT_ROOT"
pytest
```

Expected: `1 passed` (and no collection errors).

- [ ] **Step 5: Commit**

```bash
cd "$PROJECT_ROOT"
git add conftest.py tests/__init__.py tests/test_sanity.py
git commit -m "test: add conftest sys.path shim and sanity test"
```

---

## Task 8: Write `.releaserc.js` for semantic-release

**Files:**
- Create: `$PROJECT_ROOT/.releaserc.js`

- [ ] **Step 1: Write `.releaserc.js`**

```js
export default {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      { changelogFile: "CHANGELOG.md" },
    ],
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          "node -e \"const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version='${nextRelease.version}';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\\n');const t=fs.readFileSync('pyproject.toml','utf8').replace(/^version = \\\".+?\\\"/m,'version = \\\"${nextRelease.version}\\\"');fs.writeFileSync('pyproject.toml',t);\"",
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json", "pyproject.toml"],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    "@semantic-release/github",
  ],
};
```

- [ ] **Step 2: Add semantic-release devDeps**

```bash
cd "$PROJECT_ROOT"
pnpm add -D semantic-release @semantic-release/changelog @semantic-release/exec @semantic-release/git
```

- [ ] **Step 3: Verify config parses (dry-run semantic-release locally — will noop without a remote)**

```bash
cd "$PROJECT_ROOT"
pnpm exec semantic-release --dry-run --no-ci 2>&1 | tail -20 || true
```

Expected: semantic-release loads the config without parse errors. It may exit non-zero because of "no git remote" — that's fine for this step. The important check is no `Error: Cannot find module` or YAML/JS parse error.

- [ ] **Step 4: Commit**

```bash
cd "$PROJECT_ROOT"
git add .releaserc.js package.json pnpm-lock.yaml
git commit -m "chore: configure semantic-release"
```

---

## Task 9: Configure commitlint + husky hooks

**Files:**
- Create: `$PROJECT_ROOT/commitlint.config.js`
- Create: `$PROJECT_ROOT/.husky/pre-commit`
- Create: `$PROJECT_ROOT/.husky/commit-msg`

- [ ] **Step 1: Write `commitlint.config.js`**

```js
export default {
  extends: ["@commitlint/config-conventional"],
};
```

- [ ] **Step 2: Initialize husky**

```bash
cd "$PROJECT_ROOT"
pnpm exec husky init
```

This creates `.husky/` directory with a sample `pre-commit` file. We will overwrite both hooks in the next steps.

- [ ] **Step 3: Overwrite `.husky/pre-commit`**

```sh
# Lint + typecheck + frontend tests
pnpm lint || exit 1
pnpm typecheck || exit 1
pnpm test || exit 1

# Python checks — only if ruff/pytest reachable on PATH
if command -v ruff >/dev/null 2>&1; then
  ruff check . || exit 1
fi
if command -v pytest >/dev/null 2>&1; then
  pytest -q || exit 1
fi
```

Make it executable:
```bash
chmod +x "$PROJECT_ROOT/.husky/pre-commit"
```

- [ ] **Step 4: Write `.husky/commit-msg`**

```sh
pnpm exec commitlint --edit "$1"
```

Make executable:
```bash
chmod +x "$PROJECT_ROOT/.husky/commit-msg"
```

- [ ] **Step 5: Verify commitlint rejects bad commit message**

```bash
cd "$PROJECT_ROOT"
echo "bad commit message" | pnpm exec commitlint
```

Expected: non-zero exit, message mentions `type-empty` or `subject-empty`.

- [ ] **Step 6: Verify commitlint accepts good commit message**

```bash
cd "$PROJECT_ROOT"
echo "chore: add tooling" | pnpm exec commitlint
```

Expected: exit 0, no output.

- [ ] **Step 7: Commit (must itself be a conventional commit)**

```bash
cd "$PROJECT_ROOT"
git add commitlint.config.js .husky/pre-commit .husky/commit-msg
git commit -m "chore: add commitlint and husky hooks"
```

If the pre-commit hook errors on `pnpm lint` (no ESLint config yet), temporarily set `HUSKY=0` for this single commit:
```bash
HUSKY=0 git commit -m "chore: add commitlint and husky hooks"
```

ESLint config is added in Task 10, which will satisfy the hook on subsequent commits.

---

## Task 10: Add minimal ESLint config (satisfies pre-commit hook)

**Files:**
- Create: `$PROJECT_ROOT/eslint.config.js`

- [ ] **Step 1: Install Vue/TS ESLint parser plugins**

```bash
cd "$PROJECT_ROOT"
pnpm add -D @typescript-eslint/parser @typescript-eslint/eslint-plugin vue-eslint-parser
```

- [ ] **Step 2: Write `eslint.config.js` (flat config)**

```js
import vue from "eslint-plugin-vue";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import vueParser from "vue-eslint-parser";

export default [
  {
    ignores: ["js/**", "web_dist/**", "node_modules/**", "dist/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: { vue },
    rules: {
      ...vue.configs["vue3-recommended"].rules,
    },
  },
];
```

- [ ] **Step 3: Run lint — should pass (no src files yet beyond main.ts/manager.ts)**

```bash
cd "$PROJECT_ROOT"
pnpm lint
```

Expected: exit 0. If `main.ts` / `manager.ts` trigger the `no-unused-vars` rule, fix inline or adjust rule severity.

- [ ] **Step 4: Commit**

```bash
cd "$PROJECT_ROOT"
git add eslint.config.js package.json pnpm-lock.yaml
git commit -m "chore: add ESLint flat config for TS and Vue"
```

---

## Task 11: GitHub Actions — `ci.yml` and `release.yml`

**Files:**
- Create: `$PROJECT_ROOT/.github/workflows/ci.yml`
- Create: `$PROJECT_ROOT/.github/workflows/release.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  python:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        python-version: ["3.10", "3.11", "3.12"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      - run: pip install -e ".[dev]"
      - run: ruff check .
      - run: pytest

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build:extension
      - run: pnpm size
      - run: pnpm build:manager
```

- [ ] **Step 2: Write `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm size
      - env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm exec semantic-release
```

- [ ] **Step 3: Validate YAML locally (optional, uses `actionlint` if installed)**

```bash
cd "$PROJECT_ROOT"
which actionlint && actionlint .github/workflows/*.yml || echo "actionlint not installed — skipping"
```

- [ ] **Step 4: Commit**

```bash
cd "$PROJECT_ROOT"
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "ci: add CI and release workflows"
```

---

## Task 12: Repo documents (README, CONTRIBUTING, CODE_OF_CONDUCT, LICENSE, CODEOWNERS)

**Files:**
- Create: `$PROJECT_ROOT/README.md`
- Create: `$PROJECT_ROOT/CONTRIBUTING.md`
- Create: `$PROJECT_ROOT/CODE_OF_CONDUCT.md`
- Create: `$PROJECT_ROOT/LICENSE`
- Create: `$PROJECT_ROOT/CODEOWNERS`

- [ ] **Step 1: Write `README.md` (minimal, placeholder for MVP)**

```markdown
# ComfyUI-WildcardPipeline

Modular procedural prompt generation for ComfyUI — wildcards, constraints, derivations, and context pipelines.

**Status:** early development (walking skeleton).

## Install

Clone into `ComfyUI/custom_nodes/`:

\`\`\`bash
cd ComfyUI/custom_nodes
git clone https://github.com/DumiFlex/ComfyUI-WildcardPipeline.git
\`\`\`

No Python dependencies required beyond ComfyUI itself.

## Nodes (MVP)

- `WP_Context` — runs an ordered list of modules, emits a typed context.
- `WP_PromptAssembler` — fills `$var` placeholders in a template.
- `WP_Debug` — inspects the context at any point in the chain.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
```

Note: escape backticks in the above by using `\`\`\``-less raw blocks when copying from the plan; the intent is a normal Markdown fenced block in the file.

- [ ] **Step 2: Write `CONTRIBUTING.md`**

```markdown
# Contributing

## Dev environment

Two supported paths:

**Recommended:** system Python ≥ 3.10 in a venv.

\`\`\`bash
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
pnpm install
\`\`\`

**Zero-install:** ComfyUI-Easy-Install embedded Python.

\`\`\`bash
"E:\ComfyUIDev\ComfyUI-Easy-Install\python_embeded\python.exe" -m pip install pytest ruff
pnpm install
\`\`\`

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
```

- [ ] **Step 3: Write `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1 short reference)**

Copy the full text from <https://www.contributor-covenant.org/version/2/1/code_of_conduct/> verbatim. If offline, write a placeholder and flag for later:

```markdown
# Contributor Covenant Code of Conduct

This project adopts the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

Contact: open an issue on GitHub or email `@DumiFlex`.
```

- [ ] **Step 4: Write `LICENSE`**

Copy the GNU GPL-3.0-or-later license text verbatim from <https://www.gnu.org/licenses/gpl-3.0.txt>. It is ~35 KB. If pasting fails in the agent's editor, use:

```bash
cd "$PROJECT_ROOT"
curl -fsSL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE
```

Verify file size:
```bash
wc -c "$PROJECT_ROOT/LICENSE"
```
Expected: ~35 000 bytes.

- [ ] **Step 5: Write `CODEOWNERS`**

```
# Default owner
*   @DumiFlex
```

- [ ] **Step 6: Commit**

```bash
cd "$PROJECT_ROOT"
git add README.md CONTRIBUTING.md CODE_OF_CONDUCT.md LICENSE CODEOWNERS
git commit -m "docs: add README, CONTRIBUTING, CoC, LICENSE, CODEOWNERS"
```

---

## Task 13: Write initial `CLAUDE.md`

**Files:**
- Create: `$PROJECT_ROOT/CLAUDE.md`

- [ ] **Step 1: Write `CLAUDE.md`**

```markdown
# CLAUDE.md — project conventions

This file teaches future Claude (and human) contributors the load-bearing conventions of this codebase. Keep it short and honest.

## Stack

- Python ≥ 3.10 (target 3.10/3.11/3.12 in CI; embedded runtime is 3.12.10).
- ComfyUI V3 API (`comfy_api.latest`) — no V1 `NODE_CLASS_MAPPINGS`.
- Vue 3 + Vite 5 + pnpm. Strict TypeScript.
- Vitest for frontend, pytest for Python.

## Directory contract

- `engine/` — pure Python, **zero ComfyUI imports**. Testable with vanilla pytest.
- `nodes/` — ComfyUI V3 nodes. All ComfyUI imports wrapped in `try/except ImportError` so the package remains importable outside ComfyUI for tests.
- `src/` — Vue/TS frontend. Two Vite targets: `extension` (critical path, budget-gated) and `manager` (post-MVP SPA).
- `tests/` — Python tests. Uses `conftest.py` sys.path shim.
- `scripts/` — Node helpers (bundle-size gate, release helpers).
- `docs/superpowers/{specs,plans}/` — design docs and implementation plans.

## Commands

\`\`\`bash
pnpm build:extension   # produces js/main.js
pnpm build:manager     # produces web_dist/
pnpm test              # Vitest
pnpm typecheck         # vue-tsc --noEmit
pnpm lint              # ESLint flat config
pnpm size              # bundle-size gate
pytest                 # Python unit tests
ruff check .           # Python lint
\`\`\`

## Load-bearing conventions

- **Engine isolation** — never import anything from `nodes/`, `comfy_api`, or `torch` in `engine/`. Engine is dict-free of ComfyUI globals. Breaking this breaks tests.
- **Internal keys** — context keys starting with `__` are engine-internal; strip them at socket boundaries (see `nodes/types.py:strip_internals`).
- **Module IDs** — 8-hex-char short UUIDs. Matches the wildcard `@{uuid}` reference syntax planned for the next spec.
- **V3 node IDs** — prefix `WP_`, category `wildcard-pipeline`.
- **Custom widget types** — `WP_CONTEXT_MODULES`, `WP_DEBUG_VIEWER`. Registered via `app.registerExtension({ getCustomWidgets })`. The Assembler helper widget is injected via `beforeRegisterNodeDef → onNodeCreated`, not `getCustomWidgets`, because it sits alongside a native STRING template widget.
- **Conflict scanner** — advisory only; never block execution. Runtime is last-write-wins.
- **Bundle-size gate** — entry `main.js` must stay ≤ 30 KB gzipped; total `js/` ≤ 250 KB. Raising the budget requires explicit PR discussion.
- **Caching** — `WP_Context` and `WP_Debug` set `not_idempotent=True` so seed cycling always re-executes.
- **Conventional Commits** — enforced by commitlint. semantic-release reads the log to cut versions.

## Anti-patterns (inherited from reference project `ComfyUI-Wildcard-Pipeline`)

- Never use V1 `NODE_CLASS_MAPPINGS` / `EXTENSION_WEB_DIRS`.
- Never `console.log` for user warnings — use the ComfyUI toast API.
- Never use `getInputNode()` / `findInputSlot()` — walk via `node.inputs[].link → app.graph.links[linkId] → graph.getNodeById(link.origin_id)`.
- Never use `requestAnimationFrame` in `onConnectionsChange`; the link is already established when the callback fires.
- Never register an SPA catch-all route before API routes.
- Never suppress types with `as any`, `@ts-ignore`, `@ts-expect-error`.
- Never `cssInjectedByJsPlugin` on the extension bundle — inflates critical-path load.
```

Note: the triple-backtick code blocks above are escaped in this plan; write them as normal fenced blocks in `CLAUDE.md`.

- [ ] **Step 2: Commit**

```bash
cd "$PROJECT_ROOT"
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with stack, commands, and load-bearing conventions"
```

---

## Task 14: End-to-end scaffold validation

- [ ] **Step 1: Clean rebuild and run every check**

```bash
cd "$PROJECT_ROOT"
rm -rf js web_dist
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build:extension
pnpm size
pnpm build:manager
pytest
```

Expected: every command exits 0.

- [ ] **Step 2: Sanity-load the extension in ComfyUI**

Start ComfyUI (from the user's usual launcher). Open the browser console in the ComfyUI page. Confirm:

```
[wildcard-pipeline] extension loaded
```

appears, and no registration-error stack traces mention `wildcard-pipeline`.

- [ ] **Step 3: Push to GitHub (first push)**

```bash
cd "$PROJECT_ROOT"
git remote add origin https://github.com/DumiFlex/ComfyUI-WildcardPipeline.git
git push -u origin main
```

Expected: repo appears on GitHub; CI workflow triggers and passes. The `release.yml` workflow will also run but will exit cleanly since there are no release-triggering commits yet (all commits are `chore:` / `docs:` / `test:` / `ci:`).

- [ ] **Step 4: Final commit (if anything dirty from Step 1)**

No commit needed unless artifacts changed.

---

## Self-Review Checklist

**Spec coverage (§8 tooling section of the design doc):**
- [x] Repo layout (§8.1) — Task 12 + Task 13 + implicit via all file creations.
- [x] Package manager + scripts (§8.2) — Task 3.
- [x] Python tooling (§8.3) — Task 2 + Task 7.
- [x] Dev-runtime separation (§8.4) — documented in CONTRIBUTING.md (Task 12).
- [x] Open-source tooling (§8.5) — Tasks 8, 9, 11, 12.
- [x] Tests (§8.6) — pytest (Task 7) + vitest scaffolded (Task 5).
- [x] CLAUDE.md (§8.7) — Task 13.
- [x] Bundle-size gate (§6.6) — Task 6.

**Placeholders scanned:** No TBD/TODO/FIXME. Every config file has actual content. LICENSE referenced via URL because pasting 35 KB of boilerplate is not a productive use of a plan step; `curl` fallback provided.

**Type consistency:** N/A — no application code yet.

**Gaps noted:** none material. Future plans (P2/P3/P4) add code under the directories this plan creates.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-wildcard-pipeline-mvp-p1-scaffold.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
