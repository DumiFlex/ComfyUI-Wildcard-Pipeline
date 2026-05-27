#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const JS_DIR = fileURLToPath(new URL("../js", import.meta.url));

// `--json <path>` writes a machine-readable manifest alongside the human
// console report. Used by .github/workflows/bundle-size-pr.yml to compute
// the delta between base and head.
const args = process.argv.slice(2);
const jsonIdx = args.indexOf("--json");
const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

// Budgets (gzipped bytes) — tune only with explicit review
// 2026-05-10: total bumped 250 → 256 KB to fit Phase B duplicate/fork
// system (per-kind save-to-library fork handlers + supporting helpers
// + flash/shake CSS). Cycle was explicitly scoped + approved.
// 2026-05-12: total bumped 256 → 300 KB to fit Batch 2 bundle drag/drop
// overhaul + headroom for follow-up batches without per-task contortion.
// Cycle was explicitly scoped + approved.
// 2026-05-20: total bumped 300 → 312 KB to fit RichTextInput atomic-chip
// editor reused inside the canvas combine TemplateSection (lazy chunk
// ~9 KB gzipped). The textarea-with-pills pattern was replaced with the
// SPA's chip editor so canvas + SPA share one $var/@ref editing surface.
// Explicitly approved feature request.
const ENTRY_LIMIT = 30 * 1024;      // 30 KB
// 316 KB — bumped from 312 KB during the nested-bundle drag redesign.
// The container-scoped resolver (drop-zone.ts), pure applier (drop.ts),
// floating indicator SFC (BundleDropBar.vue), zoom-aware offsetTop
// walker, and moving-range filter for bundle drags added ~1 KB net.
// Bump approved alongside the feature land.
// 321 KB — bumped from 316 KB for the bundle edit modal
// (BundleInstanceModal + IdentitySection + RuntimeSection). Modal is
// lazy-loaded so the entry chunk is unaffected; total grows ~5 KB
// gzipped for the once-per-bundle edit surface (display name + frame
// color + master Lock/Hide cascades + Save/Reset-to-library footer).
// Mirrors the per-kind module modal shell users already know.
// 323 KB — bumped from 321 KB to fit the HSV color popover inside
// the bundle modal (shared HsvPicker.vue + hsv.ts moved to
// `src/components/shared/` so SPA's ColorPicker / TweaksPanel and
// the canvas bundle modal both drive one picker). Adds ~2 KB
// gzipped in the lazy modal chunk; entry stays untouched.
// 324 KB — bumped from 323 KB for the bundle-modal polish round:
// SPA link in footer, popover Teleport + viewport-aware positioning,
// always-on "clear color" affordance, stableStringify-based bundle
// fingerprint that folds meta + instance overrides into the MOD
// signal, and child-uid preservation on reset-to-library so the
// outer bundle's MOD evaluates against its existing snapshot rather
// than flipping to "modified" via spurious uid churn. ~0.5 KB net.
// 325 KB — bumped from 324 KB for the bundle detach + master toggle
// rework + true-duplicate-with-local-edits. Adds `setBundleInternal`
// / `setBundleLock` helpers that delegate to inner-bundle masters
// (skipping inner-owned rows + recursing into them) and the smart
// OFF cascade, plus the per-instance deep-clone duplicate that
// rewrites bundle_origin + parent_uid through a uid map. Net
// growth ~0.2 KB gzip.
// 327 KB — bumped from 325 KB for the rule matrix redesign. Replaces
// the 4-state click-cycle + cog-anchored CellFactorPopover with a
// click-driven CellRulePopover (4 labeled state buttons + numeric
// factor input) plus a new collapsible MatrixLegend. Net growth
// ~1.2 KB gzip across the lazy ContextWidget chunk; entry untouched.
// 328 KB — bumped from 327 KB for the rule matrix polish pass: popover
// now Teleports to body (escapes the cell's hover / clipping context),
// adds a reset-to-library button + native-styled stepper input (mirror
// of OptionRow's spinner), and the watcher narrows so factor typing
// no longer select-all-clobbers each keystroke. ~0.4 KB net gzip in
// the lazy ContextWidget chunk; entry stays put.
// 330 KB — bumped from 328 KB for the null-wildcard-option feature
// (2026-05-24). Adds `is_null` option flag + "+ Add null" button on
// the wildcard editor, pi-ban chip rendering across canvas OptionRow
// + ExceptionsSection + TestRunner + WildcardEditor, "Include null"
// checkbox on the nested-ref sub-cat picker, new is_empty /
// is_not_empty derivation operators + flipped "is empty" tick UI,
// and engine-side validation + nested-ref filter keyword support.
// ~0.7 KB net gzip across the lazy ContextWidget chunk; entry stays
// put. See docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md.
// 340 KB — bumped from 330 KB during the polish-cleanup cycle.
// Absorbs the count-aware cross-node downstream scanner + per-instance
// wildcard uuid collection (graph.ts), library-fallback RichTextPreview
// wired into the preview-resolver cache (so constraint-modal exception
// chips + the test-runner constraint table resolve `@{uuid}` against
// the wildcard library, not just the local node), sync `consumedBy`
// claim that fixes the cross-node MOVE-becomes-COPY race in
// ContextWidget's onDrop, plus the constraint pairing badge work
// landing alongside on the same branch. Approved with the bundle of
// bug fixes — see the polish-cleanup PR description.
// 360 KB — bumped from 340 KB for the WP_PromptCleaner widget
// (2026-05-25). Adds the CleanerWidget spectrum-dial SFC, the
// BlocklistModal body-teleported editor, the cleaner mount glue
// chunk, and shared types/intensity helpers. ~9 KB net gzip across
// the lazy cleaner chunks; entry stays put. See
// docs/superpowers/specs/2026-05-25-prompt-cleaner-node-design.md.
// Bumped 360 -> 380 KB on 2026-05-26 to accommodate the WP_VarToInt /
// WP_VarToFloat / WP_VarToBool converter nodes. New chunks: var-picker
// SFC + TS parser mirror + widget glue. ~4 KB net gzip across the lazy
// chunks; entry stays put. See
// docs/superpowers/specs/2026-05-26-converter-nodes-design.md.
// Bumped 380 -> 385 KB on 2026-05-27 for the prompt-template-library
// round-trip modals. LoadTemplateModal gains the ModulePicker-style
// chrome (search + category/tags filter popover + scrollable rows) and
// SaveTemplateModal gains the push-to-library layout (category select +
// Update-existing / Save-as-new dual action). ~3 KB net gzip across the
// two lazy assembler modal chunks; entry stays put.
// Bumped 385 -> 395 KB on 2026-05-27 for the in-SPA Documentation tab.
// New lazy `Docs` chunk: registry + doc primitives (DocPage/PropTable/
// PipelineDiagram/…) + ~26 authored content pages (every node, module
// kind, and interaction concept). All hand-authored Vue, no markdown dep;
// entry `main.js` untouched. See
// docs/superpowers/specs/2026-05-27-spa-documentation-tab-design.md.
const TOTAL_LIMIT = 395 * 1024;     // 395 KB

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
const manifest = { entry: null, total: 0, files: {} };
console.log(`\nBundle size report (gzipped):\n`);
for (const file of files) {
  const size = gzipSize(file);
  total += size;
  const rel = file.substring(JS_DIR.length + 1);
  // Strip the rolled-up content hash so PR ↔ base file names match. Vite
  // emits `assets/<name>-<hash>.js` per chunk; the hash changes with any
  // content edit and would otherwise show every chunk as added/removed.
  // Normalize Windows backslashes so the manifest diffs cleanly against
  // CI runs (which always emit forward slashes on Linux).
  const stable = rel.replace(/-[A-Za-z0-9_-]{8,}\.js$/, ".js").replaceAll("\\", "/");
  manifest.files[stable] = size;
  console.log(`  ${rel.padEnd(40)}  ${(size / 1024).toFixed(2).padStart(7)} KB`);
}
manifest.total = total;
console.log(`  ${"TOTAL".padEnd(40)}  ${(total / 1024).toFixed(2).padStart(7)} KB`);

const entry = files.find((f) => f.endsWith("main.js"));
if (entry) {
  const entrySize = gzipSize(entry);
  manifest.entry = entrySize;
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

if (jsonPath) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote size manifest to ${jsonPath}`);
}

process.exit(failed ? 1 : 0);
