<script setup lang="ts">
/**
 * Read-only grouped-axis constraint matrix preview.
 *
 * Ported from the sister project's interactive `ConstraintMatrix.vue` with all
 * editing interaction stripped: no click/keydown handlers, no CellRulePopover,
 * no Teleport, no sticky-band measurement, no defineExpose, no emit.
 *
 * Two rendering paths:
 *   - Grouped: when `targetGroups` or `sourceGroups` are non-empty the grid
 *     grows column-axis bands, per-axis row header chips, and a labelled
 *     "uncategorized" bucket. The `groupHue`/`groupLabel`/`isBucket` logic
 *     comes from `matrix-axis.ts` (Task 2, same repo).
 *   - Flat: when both group maps are empty the grid is the community's legacy
 *     single-row header layout (back-compat for old payloads that predate axis
 *     grouping). Source/target tint applied via CSS vars.
 *
 * Exceptions use `TokenizedValue` so `$var` / `@{ref}` tokens render as
 * coloured chips instead of raw strings. No `v-html`.
 *
 * CSS uses `.wp-cn-*` prefix (community namespace) throughout, with band/chip/
 * eyebrow rules ported from the sister `.wp-mx-*` rules and renamed.
 * Sticky frozen headers are omitted in favour of a simple `overflow-x: auto`
 * wrapper — correctness before complexity for a read-only preview.
 */
import { computed } from "vue";
import TokenizedValue from "./TokenizedValue.vue";
import {
  groupHue as tagHue,
  groupLabel,
  isBucket,
  orderByGroups,
  toGroups,
} from "./matrix-axis";

const props = defineProps<{
  rows: string[];
  cols: string[];
  matrix: Record<string, Record<string, { mode: string; factor: number }>>;
  sourceName: string;
  targetName: string;
  sourceGroups: Record<string, string[]>;
  targetGroups: Record<string, string[]>;
  exceptions: { source: string; target: string; mode: string; factor: number }[];
  targetSelect: string | null;
  refMap: ReadonlyMap<string, string>;
}>();

const orderedRows = computed(() => orderByGroups(props.rows, props.sourceGroups));
const orderedCols = computed(() => orderByGroups(props.cols, props.targetGroups));
const rowGroups = computed(() => toGroups(orderedRows.value));
const colGroups = computed(() => toGroups(orderedCols.value));
const hasColBands = computed(() => colGroups.value.some((g) => !isBucket(g)));
const hasRowGroups = computed(() => rowGroups.value.some((g) => !isBucket(g)));

// `only` (schema v6, linked picks): when the source fires, targets without a
// rule of their own in that row are excluded.
type CnMode = "allow" | "boost" | "reduce" | "exclude" | "only";
const MODE_GLYPH: Record<string, string> = {
  only: "✓",
  boost: "↑",
  reduce: "↓",
  exclude: "×",
  allow: "·",
};
const MODE_LABEL: Record<CnMode, string> = {
  boost: "Boost",
  reduce: "Reduce",
  exclude: "Exclude",
  allow: "Neutral",
  only: "Only",
};

function normalizeMode(raw: string | null | undefined): CnMode {
  return raw === "exclude" || raw === "boost" || raw === "reduce" || raw === "only" ? raw : "allow";
}

/** A row holding an `only` cell shuts out its neutral cells at runtime; the
 *  preview marks them so the link reads the same as in the extension. */
function isImpliedOut(row: string, col: string): boolean {
  if (cellAt(row, col).mode !== "allow") return false;
  return Object.values(props.matrix?.[row] ?? {}).some((c) => c?.mode === "only");
}

function cellAt(row: string, col: string): { mode: CnMode; factor: number } {
  const c = props.matrix?.[row]?.[col];
  return {
    mode: normalizeMode(c?.mode),
    factor: typeof c?.factor === "number" ? c.factor : 1,
  };
}

function fmtFactor(f: number): string {
  if (!Number.isFinite(f)) return "1";
  if (f >= 10) return f.toFixed(0);
  return f.toFixed(2).replace(/\.?0+$/, "");
}
</script>

<template>
  <div class="wp-cn">
    <!-- Axis header -->
    <div class="wp-cn-head">
      <span
        class="wp-cn-axis wp-cn-axis--src"
        data-test="cn-axis-src"
      >
        {{ sourceName }}
      </span>
      <i class="pi pi-arrow-right wp-cn-head__arrow" />
      <span
        class="wp-cn-axis wp-cn-axis--tgt"
        data-test="cn-axis-tgt"
      >
        {{ targetName }}
      </span>
      <span
        v-if="targetSelect"
        class="wp-cn-target-select"
        title="Library reach selector — which downstream target instances this constraint covers"
      >
        target: {{ targetSelect }}
      </span>
    </div>

    <!-- Matrix grid -->
    <div
      v-if="rows.length"
      class="wp-cn-grid-wrap"
    >
      <table class="wp-cn-table">
        <thead>
          <!-- Band row: axis names spanning their tags (grouped path only) -->
          <tr>
            <th
              class="wp-cn-corner"
              :rowspan="hasColBands ? 2 : 1"
            >
              <span class="chip">
                <span class="row-1">↓ source</span>
                <span class="row-2">→ target</span>
              </span>
            </th>
            <template v-if="hasColBands">
              <th
                v-for="(grp, gi) in colGroups"
                :key="`band-${gi}`"
                class="wp-cn-band"
                :class="{ 'wp-cn-band--bucket': isBucket(grp) }"
                :colspan="grp.tags.length"
                :style="{ '--ax': tagHue(grp, 'target', true) }"
                :title="groupLabel(grp)"
              >
                <span class="chip">{{ groupLabel(grp) }}</span>
              </th>
            </template>
            <!-- Flat path: single tag header row -->
            <template v-else>
              <th
                v-for="c in orderedCols"
                :key="c.tag"
                class="wp-cn-colhead"
                :style="{ '--ax': 'var(--wp-constraint-target)' }"
              >
                <span class="chip">{{ c.tag }}</span>
              </th>
            </template>
          </tr>
          <!-- Tag row (grouped path only): per-tag headers below the bands -->
          <tr v-if="hasColBands">
            <template
              v-for="(grp, gi) in colGroups"
              :key="`coltags-${gi}`"
            >
              <th
                v-for="(tag, ti) in grp.tags"
                :key="tag"
                class="wp-cn-colhead"
                :class="{ 'group-start': !isBucket(grp) && ti === 0 }"
                :style="{ '--ax': tagHue(grp, 'target', hasColBands) }"
              >
                <span class="chip">{{ tag }}</span>
              </th>
            </template>
          </tr>
        </thead>
        <tbody>
          <template
            v-for="(grp, gi) in rowGroups"
            :key="`rowgrp-${gi}`"
          >
            <!-- Group header chip: named multi-tag axis OR labelled uncategorized bucket -->
            <tr
              v-if="(!isBucket(grp) && grp.tags.length > 1) || (isBucket(grp) && hasRowGroups)"
              class="wp-cn-grp-row"
            >
              <th
                class="wp-cn-grp-head"
                :class="{ 'wp-cn-grp-head--bucket': isBucket(grp) }"
                :colspan="orderedCols.length + 1"
                :style="{ '--ax': tagHue(grp, 'source', true) }"
                :title="groupLabel(grp)"
              >
                <span class="chip">{{ groupLabel(grp) }}</span>
              </th>
            </tr>
            <!-- Tag rows -->
            <tr
              v-for="tag in grp.tags"
              :key="tag"
            >
              <th
                class="wp-cn-rowhead"
                :class="{
                  'group-start': !isBucket(grp) && tag === grp.tags[0],
                  solo: !isBucket(grp) && grp.tags.length === 1,
                }"
                :style="{ '--ax': tagHue(grp, 'source', hasRowGroups) }"
              >
                <!-- Solo named axis: fold axis name in as an eyebrow above the tag -->
                <span
                  v-if="!isBucket(grp) && grp.tags.length === 1"
                  class="chip"
                >
                  <span class="eye">{{ grp.axisName }}</span>
                  <span class="v">{{ tag }}</span>
                </span>
                <span
                  v-else
                  class="chip"
                >{{ tag }}</span>
              </th>
              <td
                v-for="c in orderedCols"
                :key="c.tag"
                class="wp-cn-td"
              >
                <span
                  class="wp-cn-cell"
                  :class="{ 'wp-cn-cell--implied-out': isImpliedOut(tag, c.tag) }"
                  :data-mode="cellAt(tag, c.tag).mode"
                >
                  <span class="wp-cn-cell__glyph">{{ isImpliedOut(tag, c.tag) ? "×" : MODE_GLYPH[cellAt(tag, c.tag).mode] }}</span>
                  <span
                    v-if="cellAt(tag, c.tag).mode === 'boost' || cellAt(tag, c.tag).mode === 'reduce'"
                    class="wp-cn-cell__factor"
                  >×{{ fmtFactor(cellAt(tag, c.tag).factor) }}</span>
                </span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Legend -->
    <div class="wp-cn-legend">
      <span><b data-mode="boost">↑</b> boost</span>
      <span><b data-mode="reduce">↓</b> reduce</span>
      <span><b data-mode="exclude">×</b> exclude</span>
      <span><b data-mode="neutral">·</b> neutral</span>
      <span><b data-mode="only">✓</b> only (links picks)</span>
    </div>

    <!-- Exceptions (library-only) -->
    <div
      v-if="exceptions.length"
      class="wp-cn-exceptions"
    >
      <div class="wp-cn-exceptions__label">
        Exceptions
      </div>
      <div
        v-for="(exc, i) in exceptions"
        :key="`exc-${i}`"
        class="wp-cn-exc-row"
        :class="`wp-cn-exc-row--${exc.mode}`"
        :data-test="`cn-exc-${i}`"
      >
        <span class="wp-cn-exc__pair">
          <span class="wp-cn-exc__src">
            <TokenizedValue
              :value="exc.source"
              :uuid-to-name="refMap"
            />
          </span>
          <i class="pi pi-arrow-right wp-cn-exc__arrow" />
          <span class="wp-cn-exc__tgt">
            <TokenizedValue
              :value="exc.target"
              :uuid-to-name="refMap"
            />
          </span>
        </span>
        <span
          class="wp-cn-exc__mode"
          :class="`wp-cn-exc__mode--${exc.mode}`"
        >
          <span class="wp-cn-exc__glyph">{{ MODE_GLYPH[exc.mode] }}</span>
          {{ MODE_LABEL[normalizeMode(exc.mode)] }}
        </span>
        <span
          v-if="exc.mode === 'boost' || exc.mode === 'reduce'"
          class="wp-cn-exc__factor"
        >×{{ fmtFactor(exc.factor) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Container ─────────────────────────────────────────────── */
.wp-cn {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ── Axis header ───────────────────────────────────────────── */
.wp-cn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wp-cn-head__arrow {
  font-size: 11px;
  color: var(--wp-text-dim);
}
.wp-cn-axis {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.wp-cn-axis--src {
  color: var(--wp-constraint-source-text);
  background: color-mix(in oklab, var(--wp-constraint-source) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-constraint-source) 35%, transparent);
}
.wp-cn-axis--tgt {
  color: var(--wp-constraint-target-text);
  background: color-mix(in oklab, var(--wp-constraint-target) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-constraint-target) 35%, transparent);
}
.wp-cn-target-select {
  font-size: 10.5px;
  color: var(--wp-text-muted);
  background: var(--wp-bg-3);
  padding: 2px 8px;
  border-radius: var(--wp-radius-cap, 999px);
  font-family: var(--wp-font-mono);
}

/* ── Grid wrapper (simple scroll, no sticky headers) ───────── */
/* Frame hugs the table (align-self instead of stretching to the card width)
   and scrolls on BOTH axes for wide/tall matrices — mirrors the sister's
   inline-block grid. */
.wp-cn-grid-wrap {
  align-self: flex-start;
  max-width: 100%;
  overflow: auto;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  padding: 0;
}
/* `separate` + zero spacing; the 4px inter-cell gap comes from th/td padding,
   so the columns the <th> headers form line up exactly with the body <td>s. */
.wp-cn-table {
  border-collapse: separate;
  border-spacing: 0;
}
.wp-cn-table th,
.wp-cn-table td {
  vertical-align: middle;
  padding: 2px;
}
/* The <td> stays a real table cell (so columns align); the inner
   .wp-cn-cell carries the fixed width + flex layout. Putting flex on the
   <td> itself pulls it out of the table formatting context and breaks
   alignment. */
.wp-cn-td {
  position: relative;
}

/* ── Corner chip ───────────────────────────────────────────── */
.wp-cn-corner {
  background: var(--wp-bg-2);
}
.wp-cn-corner .chip {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 96px;
  min-height: 36px;
  height: 100%;
  padding: 5px 8px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font-family: var(--wp-font-mono);
  font-size: 9px;
  line-height: 1.3;
  text-align: left;
  background: color-mix(in srgb, var(--wp-text) 4%, var(--wp-bg-2));
}
.wp-cn-corner .row-1 {
  color: var(--wp-constraint-source-text);
}
.wp-cn-corner .row-2 {
  color: var(--wp-constraint-target-text);
}

/* ── Column band — axis name spanning its tags ─────────────── */
.wp-cn-band .chip {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 8px;
  font: 700 9px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: min(4px, var(--wp-radius-cap, 999px)) min(4px, var(--wp-radius-cap, 999px)) 0 0;
  color: color-mix(in srgb, var(--ax) 82%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 15%, var(--wp-bg-2));
  border-bottom: 2px solid color-mix(in srgb, var(--ax) 55%, transparent);
}
/* Uncategorized bucket: dashed edge instead of solid axis accent */
.wp-cn-band--bucket .chip {
  border-bottom-style: dashed;
}
.wp-cn-grp-head--bucket .chip {
  border-left-style: dashed;
}

/* ── Column tag chip ───────────────────────────────────────── */
.wp-cn-colhead .chip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  min-height: 28px;
  padding: 3px 2px;
  font: 700 10px var(--wp-font-sans, sans-serif);
  border-radius: 0 0 min(4px, var(--wp-radius-cap, 999px)) min(4px, var(--wp-radius-cap, 999px));
  color: color-mix(in srgb, var(--ax) 72%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 9%, var(--wp-bg-2));
}
.wp-cn-colhead.group-start .chip {
  border-left: 2px solid color-mix(in srgb, var(--ax) 45%, transparent);
}
/* Flat path: col header with the default target tint */
.wp-cn-colhead {
  color: var(--wp-constraint-target-text);
}

/* ── Row group header chip — names the axis above its tags ─── */
.wp-cn-grp-row .wp-cn-grp-head {
  text-align: left;
  padding: 4px 0 1px;
}
.wp-cn-grp-head .chip {
  display: inline-flex;
  align-items: center;
  max-width: 220px;
  height: 22px;
  padding: 0 11px;
  font: 700 9px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 0 min(4px, var(--wp-radius-cap, 999px)) min(4px, var(--wp-radius-cap, 999px)) 0;
  color: color-mix(in srgb, var(--ax) 80%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 16%, var(--wp-bg-2));
  border-left: 3px solid var(--ax);
}

/* ── Row tag chip ──────────────────────────────────────────── */
.wp-cn-rowhead .chip {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 96px;
  height: 36px;
  padding: 0 10px;
  font: 700 10px var(--wp-font-sans, sans-serif);
  text-align: left;
  border-radius: 0 min(4px, var(--wp-radius-cap, 999px)) min(4px, var(--wp-radius-cap, 999px)) 0;
  color: color-mix(in srgb, var(--ax) 76%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 10%, var(--wp-bg-2));
  border-left: 2px solid color-mix(in srgb, var(--ax) 48%, transparent);
}
/* Solo named axis — eyebrow + value stacked */
.wp-cn-rowhead.solo .chip {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  border-left-width: 3px;
  border-left-color: var(--ax);
}
.wp-cn-rowhead.solo .eye {
  max-width: 78px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 700 7px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--ax) 72%, var(--wp-text-dim));
}
.wp-cn-rowhead.solo .v {
  font: 600 11px var(--wp-font-sans, sans-serif);
  color: var(--wp-text);
}

/* ── Matrix cells ──────────────────────────────────────────── */
/* Inner cell box — fixed 64×36 so every column lines up; read-only (no
   cursor, no hover lift). */
.wp-cn-cell {
  width: 64px;
  height: 36px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font-family: var(--wp-font-mono);
  font-size: 12px;
  font-weight: 600;
}
.wp-cn-cell__glyph {
  font-size: 13px;
  line-height: 1;
}
.wp-cn-cell__factor {
  font-size: 10.5px;
  font-weight: 700;
}
.wp-cn-cell[data-mode="neutral"],
.wp-cn-cell[data-mode="allow"] {
  color: var(--wp-text-dim);
  background: color-mix(in srgb, var(--wp-text) 5%, transparent);
  border: 1px dashed color-mix(in srgb, var(--wp-text) 10%, transparent);
}
.wp-cn-cell[data-mode="boost"] {
  color: var(--wp-success);
  background: color-mix(in srgb, var(--wp-success) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-success) 45%, transparent);
}
.wp-cn-cell[data-mode="reduce"] {
  color: var(--wp-warn);
  background: color-mix(in srgb, var(--wp-warn) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-warn) 45%, transparent);
}
.wp-cn-cell[data-mode="only"] {
  color: var(--wp-info);
  background: color-mix(in srgb, var(--wp-info) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-info) 45%, transparent);
}
.wp-cn-cell.wp-cn-cell--implied-out {
  color: color-mix(in srgb, var(--wp-danger) 60%, var(--wp-text-dim));
  border-color: color-mix(in srgb, var(--wp-danger) 30%, transparent);
}
.wp-cn-cell[data-mode="exclude"] {
  color: var(--wp-danger);
  background: color-mix(in srgb, var(--wp-danger) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-danger) 45%, transparent);
}

/* ── Legend ────────────────────────────────────────────────── */
.wp-cn-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 11px;
  color: var(--wp-text-muted);
}
.wp-cn-legend b {
  font-family: var(--wp-font-mono);
  color: var(--wp-text);
}
.wp-cn-legend b[data-mode="boost"] { color: var(--wp-success); }
.wp-cn-legend b[data-mode="reduce"] { color: var(--wp-warn); }
.wp-cn-legend b[data-mode="exclude"] { color: var(--wp-danger); }
.wp-cn-legend b[data-mode="neutral"] { color: var(--wp-text-dim); }
.wp-cn-legend b[data-mode="only"] { color: var(--wp-info); }

/* ── Exceptions ────────────────────────────────────────────── */
.wp-cn-exceptions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-cn-exceptions__label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim);
  margin-bottom: 2px;
}
.wp-cn-exc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  border-left: 3px solid transparent;
  background: var(--wp-bg-3);
}
.wp-cn-exc-row--boost {
  border-left-color: color-mix(in oklab, var(--wp-success) 60%, transparent);
  background: color-mix(in oklab, var(--wp-success) 6%, var(--wp-bg-3));
}
.wp-cn-exc-row--reduce {
  border-left-color: color-mix(in oklab, var(--wp-warn) 60%, transparent);
  background: color-mix(in oklab, var(--wp-warn) 6%, var(--wp-bg-3));
}
.wp-cn-exc-row--only {
  border-left-color: color-mix(in oklab, var(--wp-info) 60%, transparent);
  background: color-mix(in oklab, var(--wp-info) 6%, var(--wp-bg-3));
}
.wp-cn-exc-row--exclude {
  border-left-color: color-mix(in oklab, var(--wp-danger) 60%, transparent);
  background: color-mix(in oklab, var(--wp-danger) 6%, var(--wp-bg-3));
}
.wp-cn-exc__pair {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}
.wp-cn-exc__src,
.wp-cn-exc__tgt {
  padding: 1px 6px;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
}
.wp-cn-exc__src {
  color: var(--wp-constraint-source-text);
  background: color-mix(in oklab, var(--wp-constraint-source) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-constraint-source) 30%, transparent);
}
.wp-cn-exc__tgt {
  color: var(--wp-constraint-target-text);
  background: color-mix(in oklab, var(--wp-constraint-target) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-constraint-target) 30%, transparent);
}
.wp-cn-exc__arrow {
  font-size: 9px;
  color: var(--wp-text-dim);
}
.wp-cn-exc__mode {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  white-space: nowrap;
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
}
.wp-cn-exc__glyph {
  font-family: var(--wp-font-mono);
  font-size: 11px;
  line-height: 1;
}
.wp-cn-exc__mode--boost {
  color: var(--wp-success);
  background: color-mix(in oklab, var(--wp-success) 20%, transparent);
  border-color: color-mix(in oklab, var(--wp-success) 40%, transparent);
}
.wp-cn-exc__mode--reduce {
  color: var(--wp-warn);
  background: color-mix(in oklab, var(--wp-warn) 20%, transparent);
  border-color: color-mix(in oklab, var(--wp-warn) 40%, transparent);
}
.wp-cn-exc__mode--only {
  color: var(--wp-info);
  background: color-mix(in oklab, var(--wp-info) 20%, transparent);
  border-color: color-mix(in oklab, var(--wp-info) 40%, transparent);
}
.wp-cn-exc__mode--exclude {
  color: var(--wp-danger);
  background: color-mix(in oklab, var(--wp-danger) 20%, transparent);
  border-color: color-mix(in oklab, var(--wp-danger) 40%, transparent);
}
.wp-cn-exc__factor {
  font-family: var(--wp-font-mono);
  font-size: 10.5px;
  color: var(--wp-text-muted);
}
</style>
