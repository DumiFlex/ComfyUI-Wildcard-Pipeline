#!/usr/bin/env node
/**
 * Writes eslint-baseline.json: for each rule in RATCHET, the files that still
 * break it. eslint.config.js makes those rules errors in every other file,
 * so new code can't add to the pile while the old warnings are burned down.
 *
 *   pnpm lint:baseline      # after fixing warnings, to drop fixed files
 *
 * Only run it to SHRINK the lists; a file that newly breaks a rule should
 * be fixed, not added.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "eslint-baseline.json");
const { RATCHET } = JSON.parse(readFileSync(out, "utf8"));

// Lint with the ratchet off, so files that are now errors still report.
const raw = execFileSync("npx", ["eslint", "src", "-f", "json"], {
  cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, WP_LINT_BASELINE: "off" },
});
const files = Object.fromEntries(RATCHET.map((r) => [r, new Set()]));
for (const f of JSON.parse(raw)) {
  for (const m of f.messages) {
    if (files[m.ruleId]) files[m.ruleId].add(path.relative(root, f.filePath).split(path.sep).join("/"));
  }
}
const baseline = { RATCHET, files: Object.fromEntries(RATCHET.map((r) => [r, [...files[r]].sort()])) };
writeFileSync(out, JSON.stringify(baseline, null, 2) + "\n");
for (const r of RATCHET) console.log(`${r}: ${baseline.files[r].length} files`);
