#!/usr/bin/env node
/**
 * CSS isolation audit — flags top-level class selectors in extension
 * CSS that aren't `.wp-*` or `.var-N` prefixed.
 *
 * Why this matters: unprefixed selectors can collide with ComfyUI's
 * own CSS, PrimeVue utility classes, or another custom node's styles.
 * The `.wp-*` namespace + `@layer wp-extension` wrap are our two
 * layers of defense; this script catches the convention violation
 * before it ships.
 *
 * Scope:
 * - src/components/**\/*.{vue,css}
 * - src/extension/**\/*.css
 * - src/widgets/**\/*.css
 *
 * NOT included: src/manager/** (separate bundle with its own scope —
 * Tailwind utilities + global tokens.css are intentional there).
 *
 * Run: pnpm check:css-isolation
 * Exits 0 if clean, 1 if violations found.
 */
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const ALLOWED_PREFIXES = [
  /^\.wp-/,           // primary namespace
  /^\.var-[1-8]\b/,   // variable color helpers
];

/** Known legacy BEM-style class roots that pre-date the `wp-*`
 *  convention. Each entry is paired with a TODO note — renaming these
 *  to `wp-*` is a follow-up; meanwhile the audit silences them so
 *  CI stays green. Add to this list ONLY for existing classes that
 *  need a tracked rename; new code must use `wp-*` from the start. */
const LEGACY_ALLOWLIST = new Set([
  // (empty — all previous entries have been properly prefixed)
]);

const SCOPES = [
  "src/components/**/*.vue",
  "src/components/**/*.css",
  "src/extension/**/*.css",
  "src/widgets/**/*.css",
];

/** Strip Vue `<style scoped>` block contents from a .vue file.
 *  Scoped blocks are inherently isolated via [data-v-hash] attribute
 *  selectors, so we skip them. We only audit unscoped <style> blocks
 *  + plain .css. */
function extractUnscopedStyles(vueSource) {
  const blocks = [];
  const styleRe = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = styleRe.exec(vueSource)) !== null) {
    const attrs = m[1] ?? "";
    const isScoped = /\bscoped\b/.test(attrs);
    if (isScoped) continue;
    blocks.push(m[2]);
  }
  return blocks;
}

/** Find top-level class selectors. Match `.classname` at the start of
 *  a rule (after `}`, newline, or block start). */
const TOP_LEVEL_CLASS_RE = /(?:^|[}\n])\s*(\.[a-zA-Z][\w-]*)/g;

function violationsIn(content) {
  const violations = [];
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "");
  const matches = stripped.matchAll(TOP_LEVEL_CLASS_RE);
  for (const m of matches) {
    const selector = m[1];
    if (ALLOWED_PREFIXES.some((re) => re.test(selector))) continue;
    if (LEGACY_ALLOWLIST.has(selector)) continue;
    const offset = m.index;
    const line = stripped.slice(0, offset).split("\n").length;
    violations.push({ selector, line });
  }
  return violations;
}

async function main() {
  const files = new Set();
  for (const pattern of SCOPES) {
    for await (const p of glob(pattern, { cwd: ROOT })) {
      files.add(resolve(ROOT, p));
    }
  }
  const sortedFiles = [...files].sort();

  let totalViolations = 0;
  for (const file of sortedFiles) {
    const source = await readFile(file, "utf8");
    const blocks = file.endsWith(".vue") ? extractUnscopedStyles(source) : [source];
    for (const block of blocks) {
      const vs = violationsIn(block);
      if (vs.length > 0) {
        const rel = file.replace(ROOT + "/", "").replace(/\\/g, "/");
        for (const v of vs) {
          console.error(`${rel}:${v.line}  unprefixed top-level selector: ${v.selector}`);
          totalViolations++;
        }
      }
    }
  }

  if (totalViolations > 0) {
    console.error(
      `\n${totalViolations} unprefixed top-level class selector(s) found.\n` +
      "Every class in extension CSS must start with .wp-* (or be a .var-N helper).\n" +
      "See CLAUDE.md 'Extension isolation' for the why.",
    );
    process.exit(1);
  }
  console.log(`PASS: CSS isolation check (${sortedFiles.length} files scanned)`);
}

main().catch((err) => {
  console.error("check-css-isolation crashed:", err);
  process.exit(2);
});
