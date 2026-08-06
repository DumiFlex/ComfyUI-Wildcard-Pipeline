#!/usr/bin/env node
// Record exactly which files a clean build produced, so the plugin can delete
// everything else on the next ComfyUI start.
//
// WHY THIS EXISTS. Our chunks are content-hashed, so every release emits new
// filenames. ComfyUI Manager updates by extracting the new package OVER the
// installed folder — it never removes files the new version dropped. The two
// behaviours are individually reasonable and together they leak: measured on a
// real 2.13.1 install (2026-08-06), `js/` held 237 chunks where 58 were live
// and `web/` held 1,256 files where 136 were, for 54.6 MB total.
//
// It goes unnoticed in development because `emptyOutDir` wipes the output
// directory on every local build. Only installs that UPDATE accumulate.
//
// The manifest lists paths relative to the directory it sits in. Written last,
// after the copy steps, so it captures docs and fonts as well as chunks.
//
// Usage: node scripts/write-asset-manifest.mjs <dir>

import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const target = process.argv[2];
if (!target) {
  console.error("usage: write-asset-manifest.mjs <dir>   (e.g. js, web)");
  process.exit(1);
}

const dir = join(ROOT, target);
const MANIFEST = ".wp-assets.json";

function walk(current) {
  const out = [];
  for (const name of readdirSync(current)) {
    const full = join(current, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

try {
  const files = walk(dir)
    // Always use forward slashes: the manifest is written on whatever machine
    // builds the release and read on the user's, which may not be the same OS.
    .map((p) => relative(dir, p).split(sep).join("/"))
    .filter((p) => p !== MANIFEST)
    .sort();
  writeFileSync(
    join(dir, MANIFEST),
    `${JSON.stringify({ files }, null, 0)}\n`,
    "utf8",
  );
  console.log(`  ${target}/${MANIFEST} — ${files.length} files recorded`);
} catch (err) {
  console.error("[write-asset-manifest] failed:", err);
  process.exit(1);
}
