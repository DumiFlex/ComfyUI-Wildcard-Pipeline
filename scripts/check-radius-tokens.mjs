#!/usr/bin/env node
/**
 * Radius-token audit — flags raw `border-radius:` (and its directional /
 * logical-property variants) in manager SFCs.
 *
 * Allowed (raw): 0, 50%, 9999px, 999px (full-circle/pill shapes), plus
 * any value already routed through `var(--wp-radius-*)`.
 *
 * Scope: src/manager/**\/*.vue style blocks.
 * Run: pnpm check:radius
 * Exits 0 if clean, 1 with violation list if not.
 *
 * NOT audited: corner-specific shorthand inside the `border` shorthand
 * (rare; out of scope). Use longhand `border-radius:` for the audit
 * to see your value.
 */
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCAN_GLOBS = [
  "src/manager/**/*.vue",
];

// Covers border-radius plus all directional/logical-property variants:
//   border-top-left-radius, border-top-right-radius,
//   border-bottom-left-radius, border-bottom-right-radius,
//   border-start-start-radius, border-start-end-radius,
//   border-end-start-radius, border-end-end-radius.
const DECL_RE = /(border-(?:(?:top|bottom)-(?:left|right)-|(?:start|end)-(?:start|end)-)?radius)\s*:\s*([^;{}\n]+)/gi;

// Token check: any reference to --wp-radius-* (or bare --wp-radius with/without fallback).
const TOKEN_RE = /var\(--wp-radius/;

// Whole-value var(--…) expression — catches fallback-bearing values like
// `var(--wp-radius-lg, 10px)` which would split incorrectly on whitespace.
// Matches when the trimmed value starts with `var(` and ends with `)`.
const WHOLE_VAR_RE = /^\s*var\(--[^)]*\)\s*$/;

// Allowed raw values: 0, 50%, 9999px, 999px (pill/circle shapes), and
// the defensive 50.0% form. These carry intentional design meaning.
const ALLOWED_RAW = /^\s*(0|50\.?0?%|9999px|999px)\s*$/;

// Performance guard: skip declarations with no `px` substring and no `%`.
// Declarations already using var(), or the keyword `0`, will be caught
// by ALLOWED_RAW or TOKEN_RE during the per-piece phase anyway, but
// skipping here avoids the split + loop overhead for most declarations.
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
      // CSS variable reference (--wp-radius*) or an explicitly allowed raw value.
      // NOTE: no early TOKEN_RE.test(declValue) short-circuit before per-piece check —
      // a mixed value like `var(--wp-radius-sm) 14px` would pass a full-value test
      // but the `14px` piece would be missed.
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
  console.log("[check:radius] clean.");
  process.exit(0);
}

console.error(`[check:radius] ${violations.length} violation(s):`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.prop}: ${v.value}`);
}
process.exit(1);
