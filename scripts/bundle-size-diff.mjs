#!/usr/bin/env node
// Diff two bundle-size manifests (produced by check-bundle-size.mjs --json)
// and emit a Markdown report on stdout. Used by the bundle-size-pr workflow
// to comment on PRs with the size delta.
//
//   node scripts/bundle-size-diff.mjs <base.json> <head.json> > report.md
//
// Output is compact: total + per-file delta table. Files unchanged are
// omitted; new files show as "+" and removed as "−".

import { readFileSync } from "node:fs";

const [basePath, headPath] = process.argv.slice(2);
if (!basePath || !headPath) {
  console.error("Usage: bundle-size-diff <base.json> <head.json>");
  process.exit(2);
}

const base = JSON.parse(readFileSync(basePath, "utf-8"));
const head = JSON.parse(readFileSync(headPath, "utf-8"));

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}
function fmtDelta(delta) {
  if (delta === 0) return "—";
  const sign = delta > 0 ? "+" : "−";
  const kb = Math.abs(delta) / 1024;
  return `${sign}${kb.toFixed(2)} KB`;
}

const allKeys = new Set([...Object.keys(base.files), ...Object.keys(head.files)]);
const rows = [];
for (const key of [...allKeys].sort()) {
  const b = base.files[key] ?? 0;
  const h = head.files[key] ?? 0;
  if (b === h) continue;
  const status = b === 0 ? "🆕 new" : h === 0 ? "🗑️ removed" : "📦 changed";
  rows.push({ key, base: b, head: h, delta: h - b, status });
}

const totalDelta = head.total - base.total;
const entryDelta = (head.entry ?? 0) - (base.entry ?? 0);

let md = "## Bundle size report\n\n";
md += `| | base | head | delta |\n`;
md += `|---|---:|---:|---:|\n`;
md += `| **Total (gzip)** | ${fmtKB(base.total)} | ${fmtKB(head.total)} | **${fmtDelta(totalDelta)}** |\n`;
md += `| **Entry (main.js)** | ${fmtKB(base.entry ?? 0)} | ${fmtKB(head.entry ?? 0)} | ${fmtDelta(entryDelta)} |\n`;

if (rows.length === 0) {
  md += `\n_No per-chunk changes._\n`;
} else {
  md += `\n### Per-chunk changes\n\n`;
  md += `| file | base | head | delta | |\n`;
  md += `|---|---:|---:|---:|---|\n`;
  for (const r of rows) {
    md += `| \`${r.key}\` | ${fmtKB(r.base)} | ${fmtKB(r.head)} | ${fmtDelta(r.delta)} | ${r.status} |\n`;
  }
}

console.log(md);
