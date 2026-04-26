#!/usr/bin/env node
// Copy markdown help pages from docs/help/ to js/docs/ so ComfyUI's
// node-help-page system can serve them under /extensions/<package>/docs/.
// ComfyUI auto-scans `${WEB_DIRECTORY}/docs/<NodeId>.md` (plus optional
// `<NodeId>/<locale>.md` overrides) — see
// https://docs.comfy.org/custom-nodes/help_page
//
// Run as part of `pnpm build:extension` so a fresh `js/` always has the
// latest docs alongside the bundled JS chunks.

import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "docs", "help");
const DST = join(ROOT, "js", "docs");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

try {
  rmSync(DST, { recursive: true, force: true });
  const files = walk(SRC);
  for (const file of files) {
    const rel = relative(SRC, file);
    const target = join(DST, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    copyFileSync(file, target);
    console.log(`  docs/help/${rel} → js/docs/${rel}`);
  }
  console.log(`Copied ${files.length} help file(s).`);
} catch (err) {
  console.error("[copy-help-docs] failed:", err);
  process.exit(1);
}
