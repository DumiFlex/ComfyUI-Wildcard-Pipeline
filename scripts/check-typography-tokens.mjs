#!/usr/bin/env node
/**
 * Typography-token audit — flags raw `px` font-size / line-height values
 * in manager SFCs that have not been migrated to --wp-text-* / --wp-line-*
 * tokens.
 *
 * Allowed without flagging:
 *   - Values routed through var(--wp-text-…) or var(--wp-line-…)
 *   - 0, inherit, unset, normal
 *   - em/rem/% values (e.g. 1.4em, 1rem, 120%)
 *   - Unitless numbers (e.g. 1.45 — valid CSS line-height)
 *   - Lines with a trailing /* audit-exempt: … *\/ comment
 *
 * Scope:
 *   - src/manager/**\/*.vue  (scoped + global style blocks)
 *
 * Run: pnpm check:typography
 * Exits 0 if clean, 1 if violations found.
 */
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCAN_GLOBS = [
  "src/manager/**/*.vue",
];

// Capture (property, value) pairs — property group 1, value group 2.
const DECL_RE = /(font-size|line-height)\s*:\s*([^;{}\n]+)/gi;
// Specifically requires a --wp-text-* or --wp-line-* token for the typography scale.
const TOKEN_RE = /var\(--wp-(text|line)-/;
// Whole-value var(--…) expression — catches fallback-bearing values like
// `var(--wp-input-h, 34px)` which would split incorrectly on whitespace.
// Matches when the trimmed value starts with `var(` and ends with `)`.
const WHOLE_VAR_RE = /^\s*var\(--[^)]*\)\s*$/;
// Allowed raw values: 0, inherit, unset, normal, em/rem/% units, unitless decimal.
const ALLOWED_RAW = /^\s*(0|inherit|unset|normal|[\d.]+(em|rem|%)|\d+(\.\d+)?)\s*$/;
// Performance guard: skip processing declarations that contain no raw `px` value.
// Declarations already using var(), keyword, em/rem/% values will have no `px`
// substring and can be bypassed without entering the per-piece check.
const HAS_RAW_PX_RE = /\d+px/;
// Inline audit-exempt comment.
const AUDIT_EXEMPT_RE = /\/\*\s*audit-exempt/;

const violations = [];

for await (const file of glob(SCAN_GLOBS, { cwd: ROOT })) {
  const abs = resolve(ROOT, file);
  const src = await readFile(abs, "utf8");
  // Only style blocks in .vue files.
  const styleBlocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => ({
    body: m[1],
    offset: m.index + m[0].indexOf(">") + 1,
  }));
  for (const { body, offset } of styleBlocks) {
    for (const match of body.matchAll(DECL_RE)) {
      const prop = match[1];
      const declValue = match[2];
      // Performance guard: bypass declarations with no raw px values.
      if (!HAS_RAW_PX_RE.test(declValue)) continue;
      // If the entire value is a single var(--…) expression (possibly with fallback),
      // allow it without splitting — splitting would misparse the fallback px value.
      if (WHOLE_VAR_RE.test(declValue)) continue;
      // Per-piece check: each whitespace-separated token must either be a
      // CSS variable reference or an explicitly allowed raw value.
      const pieces = declValue.trim().split(/\s+/);
      const allOk = pieces.every(p => TOKEN_RE.test(p) || ALLOWED_RAW.test(p));
      if (allOk) continue;
      // Check for audit-exempt comment on the same line (after the match end, before \n).
      const matchEnd = (match.index ?? 0) + match[0].length;
      const lineRemainder = body.slice(matchEnd, body.indexOf("\n", matchEnd));
      if (AUDIT_EXEMPT_RE.test(lineRemainder)) continue;
      // Also allow audit-exempt inside the captured value (before the semicolon).
      if (AUDIT_EXEMPT_RE.test(declValue)) continue;
      const idx = (match.index ?? 0) + offset;
      const line = src.slice(0, idx).split("\n").length;
      violations.push({
        file: relative(ROOT, abs).replaceAll("\\", "/"),
        line,
        prop,
        value: declValue.trim(),
      });
    }
  }
}

if (violations.length === 0) {
  console.log("[check:typography] clean — all font-size/line-height routed through --wp-text-*/--wp-line-*.");
  process.exit(0);
}

console.error(`[check:typography] ${violations.length} violation(s):`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.prop}: ${v.value}`);
}
process.exit(1);
