#!/usr/bin/env node
/**
 * Spacing-token audit — flags raw `px` values in
 * padding / margin / gap / row-gap / column-gap inside manager SFCs.
 *
 * Allowed: 0, 1px, 2px hairlines (matches --wp-space-0..1) plus any
 * value already routed through a CSS variable.
 *
 * Scope:
 *   - src/manager/**\/*.vue   (scoped + global style blocks)
 *   - src/manager/styles/tokens.css (definitions only; consumers
 *     elsewhere flagged)
 *
 * Run: pnpm check:spacing
 * Exits 0 if clean, 1 if violations found.
 */
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { resolve, relative } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SCAN_GLOBS = [
  "src/manager/**/*.vue",
];
const RAW_PX_RE = /(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?\s*:\s*([^;{}\n]+)/gi;
const TOKEN_RE = /var\(--wp-space-/;
const ALLOWED_RAW = /^\s*(0|1px|2px)\s*$/;
// Pieces that contain no px at all are non-spacing values (auto, inherit, etc.) — not flagged.
const HAS_PX_RE = /\d+px/;
// After the match, the rest of the line may hold an audit-exempt comment.
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
    for (const match of body.matchAll(RAW_PX_RE)) {
      const declValue = match[3];
      // Skip declarations that contain no px values (e.g. margin: auto, margin: 0 auto).
      if (!HAS_PX_RE.test(declValue)) continue;
      if (TOKEN_RE.test(declValue)) continue;
      // Multi-token shorthand: split on whitespace, each piece either var() or allowed raw.
      const pieces = declValue.trim().split(/\s+/);
      const allOk = pieces.every(p => TOKEN_RE.test(p) || ALLOWED_RAW.test(p));
      if (allOk) continue;
      // Check for audit-exempt comment on the same line (after the match, before \n).
      const matchEnd = (match.index ?? 0) + match[0].length;
      const lineRemainder = body.slice(matchEnd, body.indexOf("\n", matchEnd));
      if (AUDIT_EXEMPT_RE.test(lineRemainder)) continue;
      // Also check if the value itself ends with an audit-exempt inline comment
      // (inside the captured value, before the semicolon).
      if (AUDIT_EXEMPT_RE.test(declValue)) continue;
      const idx = (match.index ?? 0) + offset;
      const line = src.slice(0, idx).split("\n").length;
      violations.push({
        file: relative(ROOT, abs).replaceAll("\\", "/"),
        line,
        prop: match[1],
        value: declValue.trim(),
      });
    }
  }
}

if (violations.length === 0) {
  console.log("[check:spacing] clean — all padding/margin/gap routed through --wp-space-*.");
  process.exit(0);
}

console.error(`[check:spacing] ${violations.length} violation(s):`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  ${v.prop}: ${v.value}`);
}
process.exit(1);
