#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const JS_DIR = fileURLToPath(new URL("../js", import.meta.url));

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
