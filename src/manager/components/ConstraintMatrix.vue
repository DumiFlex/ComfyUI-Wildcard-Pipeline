<script setup lang="ts">
/**
 * ConstraintMatrix (SPA) — library-authoring grid for a constraint
 * module. Visual / interaction model mirrors the canvas extension's
 * `MatrixSection`:
 *   - Purple `↓ SOURCE · <wildcard>` and cyan `→ TARGET · <wildcard>`
 *     axis tags above the grid.
 *   - Uniform cells (icon + factor for boost/reduce, dot for neutral,
 *     × for exclude) — no compact / wide variants.
 *   - Click cell → CellRulePopover (teleported to body) with four state
 *     buttons, stepper factor input, reset, and outside-click / Escape
 *     to close. State picks and factor edits keep the popover open.
 *   - Collapsible MatrixLegend below the grid.
 *
 * Single popover lives in a body portal so it never picks up the cell's
 * hover / clipping context — same fix the canvas grid applies.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  ConstraintCell,
  ConstraintMatrix,
  ConstraintMode,
} from "../api/types";
import CellRulePopover from "../../components/context/editors/constraint/CellRulePopover.vue";
import MatrixLegend from "../../components/context/editors/constraint/MatrixLegend.vue";
import {
  groupHue as tagHue,
  groupLabel,
  isBucket,
  orderByGroups,
  toGroups,
} from "../../components/shared/matrix-axis";

type RuleState = "neutral" | "exclude" | "boost" | "reduce";

interface Props {
  rows: string[];      // source sub-categories
  cols: string[];      // target sub-categories
  modelValue: ConstraintMatrix;
  sourceName?: string; // wildcard name shown in the source axis tag
  targetName?: string; // wildcard name shown in the target axis tag
  /** Sub-category axes (tag_groups) of the source/target wildcards:
   *  axis name → member tags. When present, the matrix orders its rows /
   *  cols by axis and colors each group via `axisHueAt` (mirrors the
   *  wildcard editor's per-axis chip hues). Empty → flat, source/target-
   *  tinted headers as before. */
  sourceGroups?: Record<string, string[]>;
  targetGroups?: Record<string, string[]>;
  // Read-only recovery view: the source/target wildcard was deleted, so the
  // configured rules are shown for understanding only. Cells don't open the
  // rule popover; reattach a live wildcard to edit.
  readonly?: boolean;
}
const props = withDefaults(defineProps<Props>(), {
  sourceName: "",
  targetName: "",
  sourceGroups: () => ({}),
  targetGroups: () => ({}),
  readonly: false,
});
const emit = defineEmits<{ "update:modelValue": [value: ConstraintMatrix] }>();

const MODE_DEFAULT_FACTOR: Record<ConstraintMode, number> = {
  allow: 1,
  exclude: 0,
  boost: 1.5,
  reduce: 0.5,
};
const MODE_ICON: Record<ConstraintMode, string> = {
  allow: "·",
  exclude: "×",
  boost: "↑",
  reduce: "↓",
};
const MODE_LABEL: Record<ConstraintMode, string> = {
  allow: "Neutral",
  exclude: "Exclude",
  boost: "Boost",
  reduce: "Reduce",
};

/** Storage uses "allow"; popover speaks "neutral". Translate at boundary. */
function toState(mode: ConstraintMode): RuleState {
  return mode === "allow" ? "neutral" : mode;
}
function toMode(state: RuleState): ConstraintMode {
  return state === "neutral" ? "allow" : state;
}

function rawCellAt(row: string, col: string): ConstraintCell | null {
  return props.modelValue?.[row]?.[col] ?? null;
}

function cellAt(row: string, col: string): ConstraintCell {
  const raw = rawCellAt(row, col);
  if (!raw) return { mode: "allow", factor: 1 };
  const mode = (raw.mode ?? "allow") as ConstraintMode;
  const factor =
    typeof raw.factor === "number" ? raw.factor : MODE_DEFAULT_FACTOR[mode] ?? 1;
  return { mode, factor };
}

function cloneMatrix(src: ConstraintMatrix): ConstraintMatrix {
  const out: ConstraintMatrix = {};
  for (const [r, byCol] of Object.entries(src ?? {})) {
    out[r] = {};
    for (const [c, cell] of Object.entries(byCol ?? {})) {
      out[r][c] = { mode: cell.mode, factor: cell.factor };
    }
  }
  return out;
}

function writeCell(row: string, col: string, cell: ConstraintCell) {
  const next = cloneMatrix(props.modelValue);
  if (cell.mode === "allow") {
    // Drop the row/col entry to keep payload sparse.
    if (next[row]) {
      delete next[row][col];
      if (Object.keys(next[row]).length === 0) delete next[row];
    }
  } else {
    if (!next[row]) next[row] = {};
    next[row][col] = { mode: cell.mode, factor: cell.factor };
  }
  emit("update:modelValue", next);
}

function fmtFactor(f: number): string {
  if (!Number.isFinite(f)) return "1";
  if (f >= 10) return f.toFixed(0);
  return f.toFixed(2).replace(/\.?0+$/, "");
}

// ── Axis grouping (target = columns, source = rows). Ordering, grouping,
// bucket detection + hues come from the shared matrix-axis module so this grid
// and the canvas MatrixSection stay identical. ──────────────────
const orderedRows = computed(() => orderByGroups(props.rows, props.sourceGroups));
const orderedCols = computed(() => orderByGroups(props.cols, props.targetGroups));
const rowGroups = computed(() => toGroups(orderedRows.value));
const colGroups = computed(() => toGroups(orderedCols.value));
/** True when at least one column / row axis is a NAMED group — then the header
 *  grows a band/chip and the leftover bucket is worth labelling. A fully-flat
 *  matrix keeps the legacy source/target tint and grows no band/chip. */
const hasColBands = computed(() => colGroups.value.some((g) => !isBucket(g)));
const hasRowGroups = computed(() => rowGroups.value.some((g) => !isBucket(g)));

// The column band row's height is measured at runtime so the tag row beneath
// it can stick at the right `top` offset, independent of font sizing.
const gridEl = ref<HTMLElement | null>(null);
function measureBands(): void {
  const grid = gridEl.value;
  if (!grid) return;
  const band = grid.querySelector<HTMLElement>(".wp-mx-th-band");
  grid.style.setProperty("--wp-mx-band-h", `${band?.offsetHeight ?? 0}px`);
}
watch(colGroups, () => void nextTick(measureBands));

function cellAriaLabel(row: string, col: string): string {
  const c = cellAt(row, col);
  const factor = (c.mode === "boost" || c.mode === "reduce") ? ` ×${fmtFactor(c.factor)}` : "";
  return `Rule: ${row} → ${col}, current state ${MODE_LABEL[c.mode]}${factor}. Click to edit.`;
}

// ── Popover state ───────────────────────────────────────────────
interface PopoverPos {
  row: string;
  col: string;
  left: number;
  top: number;
}
const popover = ref<PopoverPos | null>(null);

function isOpenAt(row: string, col: string): boolean {
  return popover.value?.row === row && popover.value?.col === col;
}

function rectForCell(row: string, col: string): { left: number; top: number } | null {
  const sel = `[data-test="cell-${cssEscape(row)}-${cssEscape(col)}"]`;
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const POP_W = 260;
  const left = Math.min(
    window.innerWidth - POP_W - 12,
    Math.max(12, r.left + r.width / 2 - POP_W / 2),
  );
  const top = r.bottom + 8;
  return { left, top };
}
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function openPopover(row: string, col: string, ev: MouseEvent): void {
  ev.stopPropagation();
  // Read-only recovery view (deleted source/target): cells are inert.
  if (props.readonly) return;
  if (isOpenAt(row, col)) {
    popover.value = null;
    return;
  }
  const pos = rectForCell(row, col) ?? { left: 12, top: 12 };
  popover.value = { row, col, left: pos.left, top: pos.top };
}

function closePopover(): void {
  popover.value = null;
}

function reanchorPopover(): void {
  const cur = popover.value;
  if (!cur) return;
  const pos = rectForCell(cur.row, cur.col);
  if (!pos) {
    closePopover();
    return;
  }
  popover.value = { ...cur, left: pos.left, top: pos.top };
}

const popoverCell = computed<ConstraintCell | null>(() => {
  if (!popover.value) return null;
  return cellAt(popover.value.row, popover.value.col);
});

// The SPA grid IS the library — there's nothing to reset *to*. The
// canvas/extension surface uses the reset button to drop a per-instance
// override and fall back to library; here, picking NEUTRAL already
// clears the cell (sparse delete in `writeCell`). Same goes for the
// dashed "modified" outline — every authored cell is library data,
// nothing to mark as a divergence. Both UI affordances stay off.

function onPopoverState(next: RuleState): void {
  if (!popover.value) return;
  const cur = cellAt(popover.value.row, popover.value.col);
  const mode = toMode(next);
  const factor =
    mode === cur.mode ? cur.factor : MODE_DEFAULT_FACTOR[mode] ?? 1;
  writeCell(popover.value.row, popover.value.col, { mode, factor });
}

function onPopoverFactor(value: number): void {
  if (!popover.value) return;
  if (!Number.isFinite(value) || value <= 0) return;
  const cur = cellAt(popover.value.row, popover.value.col);
  writeCell(popover.value.row, popover.value.col, { mode: cur.mode, factor: value });
}

function onDocumentMousedown(ev: MouseEvent): void {
  if (!popover.value) return;
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  if (target.closest(".pop")) return;             // inside the popover
  if (target.closest(".wp-mx-cell")) return;      // a matrix cell
  closePopover();
}
function onDocumentKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && popover.value) {
    ev.preventDefault();
    closePopover();
  }
}

onMounted(() => {
  window.addEventListener("mousedown", onDocumentMousedown);
  window.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener("scroll", reanchorPopover, true);
  window.addEventListener("resize", reanchorPopover);
  window.addEventListener("resize", measureBands);
  void nextTick(measureBands);
});
onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onDocumentMousedown);
  window.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("scroll", reanchorPopover, true);
  window.removeEventListener("resize", reanchorPopover);
  window.removeEventListener("resize", measureBands);
});

defineExpose({ cellAt });
</script>

<template>
  <section class="wp-mx" :class="{ 'wp-mx--readonly': readonly }" data-test="constraint-matrix">
    <!-- Axis tags — same purple-source / cyan-target language the
         canvas grid uses. Helps users keep "rows are source" vs
         "columns are target" straight when wildcard names are short
         or visually similar. -->
    <div class="wp-mx-axes">
      <span class="wp-mx-axis wp-mx-axis--src" data-test="mx-axis-src">
        <span class="arrow" aria-hidden="true">↓</span>
        <span>Source · {{ sourceName || "source" }}</span>
      </span>
      <span class="wp-mx-axis wp-mx-axis--tgt" data-test="mx-axis-tgt">
        <span class="arrow" aria-hidden="true">→</span>
        <span>Target · {{ targetName || "target" }}</span>
      </span>
    </div>

    <div ref="gridEl" class="wp-mx-grid">
      <table>
        <thead>
          <tr>
            <th class="wp-mx-corner" :rowspan="hasColBands ? 2 : 1" data-test="mx-corner">
              <span class="chip">
                <span class="row-1">↓ source</span>
                <span class="row-2">→ target</span>
              </span>
            </th>
            <!-- Grouped cols: a band row names each axis, spanning its tags. -->
            <template v-if="hasColBands">
              <th
                v-for="(grp, gi) in colGroups"
                :key="`band-${gi}`"
                class="wp-mx-th-band"
                :class="{ 'wp-mx-th-band--bucket': isBucket(grp) }"
                :colspan="grp.tags.length"
                :style="{ '--ax': tagHue(grp, 'target', true) }"
                :title="groupLabel(grp)"
              >
                <span class="chip">{{ groupLabel(grp) }}</span>
              </th>
            </template>
            <!-- Flat cols: tag headers sit directly in the single header row. -->
            <template v-else>
              <th
                v-for="c in orderedCols"
                :key="c.tag"
                class="wp-mx-th-col"
                :style="{ '--ax': 'var(--wp-constraint-target)' }"
              ><span class="chip">{{ c.tag }}</span></th>
            </template>
          </tr>
          <tr v-if="hasColBands">
            <template v-for="(grp, gi) in colGroups" :key="`coltags-${gi}`">
              <th
                v-for="(tag, ti) in grp.tags"
                :key="tag"
                class="wp-mx-th-col"
                :class="{ 'group-start': !isBucket(grp) && ti === 0 }"
                :style="{ '--ax': tagHue(grp, 'target', hasColBands) }"
              ><span class="chip">{{ tag }}</span></th>
            </template>
          </tr>
        </thead>
        <tbody>
          <template v-for="(grp, gi) in rowGroups" :key="`rowgrp-${gi}`">
            <!-- Header chip: a named multi-tag axis, OR the labelled
                 uncategorized bucket (when the matrix has any named axis). A
                 named solo axis folds into an eyebrow instead (below). -->
            <tr
              v-if="(!isBucket(grp) && grp.tags.length > 1) || (isBucket(grp) && hasRowGroups)"
              class="wp-mx-grp-row"
            >
              <th
                class="wp-mx-grp-head"
                :class="{ 'wp-mx-grp-head--bucket': isBucket(grp) }"
                :colspan="orderedCols.length + 1"
                :style="{ '--ax': tagHue(grp, 'source', true) }"
                :title="groupLabel(grp)"
              ><span class="chip">{{ groupLabel(grp) }}</span></th>
            </tr>
            <tr v-for="tag in grp.tags" :key="tag">
              <th
                class="wp-mx-th-row"
                :class="{
                  'group-start': !isBucket(grp) && tag === grp.tags[0],
                  solo: !isBucket(grp) && grp.tags.length === 1,
                }"
                :style="{ '--ax': tagHue(grp, 'source', hasRowGroups) }"
              >
                <span v-if="!isBucket(grp) && grp.tags.length === 1" class="chip">
                  <span class="eye">{{ grp.axisName }}</span>
                  <span class="v">{{ tag }}</span>
                </span>
                <span v-else class="chip">{{ tag }}</span>
              </th>
              <td v-for="c in orderedCols" :key="c.tag" class="wp-mx-td">
                <div
                  class="wp-mx-cell"
                  :class="[
                    `s-${toState(cellAt(tag, c.tag).mode)}`,
                    { open: isOpenAt(tag, c.tag) },
                  ]"
                  :data-mode="cellAt(tag, c.tag).mode"
                  :data-test="`cell-${tag}-${c.tag}`"
                  :aria-label="cellAriaLabel(tag, c.tag)"
                  role="button"
                  tabindex="0"
                  @click="openPopover(tag, c.tag, $event)"
                  @keydown.enter.prevent="openPopover(tag, c.tag, $event as unknown as MouseEvent)"
                  @keydown.space.prevent="openPopover(tag, c.tag, $event as unknown as MouseEvent)"
                >
                  <span class="glyph">{{ MODE_ICON[cellAt(tag, c.tag).mode] }}</span>
                  <span
                    v-if="cellAt(tag, c.tag).mode === 'boost' || cellAt(tag, c.tag).mode === 'reduce'"
                    class="factor"
                  >×{{ fmtFactor(cellAt(tag, c.tag).factor) }}</span>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="orderedRows.length === 0">
            <td :colspan="orderedCols.length + 1" class="wp-mx-empty">
              No source values yet — add options to the source wildcard first.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p
      v-if="readonly"
      class="wp-mx-readonly-hint"
      data-test="matrix-readonly-hint"
    >
      Reattach the source to edit these rules.
    </p>

    <MatrixLegend />

    <!-- Popover teleports to body so its hover state stays isolated
         from the source cell + any table-level clipping. -->
    <Teleport to="body">
      <div
        v-if="popover && popoverCell"
        class="wp-mx-pop-anchor"
        data-test="cell-rule-popover"
        :style="{
          position: 'fixed',
          left: popover.left + 'px',
          top: popover.top + 'px',
          width: '260px',
          zIndex: 9999,
        }"
        @mousedown.stop
      >
        <CellRulePopover
          :state="toState(popoverCell.mode)"
          :factor="popoverCell.factor"
          :src-label="popover.row"
          :tgt-label="popover.col"
          :can-reset="false"
          @update:state="onPopoverState"
          @update:factor="onPopoverFactor"
          @close="closePopover"
        />
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.wp-mx {
  padding: 12px 16px;
  background: var(--wp-bg-2, var(--wp-bg));
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}

/* ── Axis tags ─────────────────────────────────────────────── */
.wp-mx-axes {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.wp-mx-axis {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
}
.wp-mx-axis--src {
  color: var(--wp-constraint-source-text);
  background: color-mix(in oklab, var(--wp-constraint-source) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-constraint-source) 35%, transparent);
}
.wp-mx-axis--tgt {
  color: var(--wp-constraint-target-text);
  background: color-mix(in oklab, var(--wp-constraint-target) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-constraint-target) 35%, transparent);
}
.wp-mx-axis .arrow { font: 14px var(--wp-font-mono, monospace); line-height: 1; }

/* ── Grid frame — scrolls on BOTH axes; headers + corner freeze ── */
.wp-mx-grid {
  display: inline-block;
  background: var(--wp-bg-deep, var(--wp-bg-1, #0e1015));
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  padding: 6px;
  overflow: auto;
  max-width: 100%;
  max-height: 60vh;
}
/* `separate` + zero spacing (NOT `collapse`) — sticky header cells with
 * border-collapse have a Chromium paint bug where scrolled cells bleed through
 * the frozen row/column. The 4px inter-cell gap still comes from th/td padding,
 * so the layout is unchanged. */
.wp-mx-grid table { border-collapse: separate; border-spacing: 0; }
/* 2px cell padding = the 4px inter-cell gap. Sticky headers fill with the
 * OPAQUE grid bg so scrolled cells can't bleed through them; that fill also
 * paints the padding strip, which is what reads as the gap. */
.wp-mx-grid th,
.wp-mx-grid td { padding: 2px; vertical-align: middle; }
.wp-mx-grid thead th,
.wp-mx-grid tbody th {
  position: sticky;
  background: var(--wp-bg-deep, var(--wp-bg-1, #0e1015));
}
.wp-mx-grid thead th { top: 0; z-index: 2; }
.wp-mx-grid tbody th { left: 0; z-index: 1; }
/* Band row pins to the very top; the tag row sticks just beneath it (offset =
 * the measured band height). Corner outranks both so it stays in the angle. */
.wp-mx-grid thead th.wp-mx-th-band { top: 0; z-index: 3; }
.wp-mx-grid thead th.wp-mx-th-col { top: var(--wp-mx-band-h, 0px); z-index: 2; }
.wp-mx-grid thead th.wp-mx-corner { top: 0; left: 0; z-index: 5; }  /* both axes */

/* Inner chips carry the rounded visual + per-axis tint (--ax, set inline);
 * the <th> itself stays an opaque grid-bg backing for the sticky fill. */
.wp-mx-corner .chip {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 96px;
  min-height: 36px;
  height: 100%;
  padding: 5px 8px;
  border-radius: 4px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 9px;
  line-height: 1.3;
  text-align: left;
  background: color-mix(in srgb, var(--wp-text) 4%, var(--wp-bg-1));
}
.wp-mx-corner .row-1 { color: var(--wp-constraint-source-text); }
.wp-mx-corner .row-2 { color: var(--wp-constraint-target-text); }

/* Column band — axis name spanning its tags, sitting atop the tag row. */
.wp-mx-th-band .chip {
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
  border-radius: 4px 4px 0 0;
  color: color-mix(in srgb, var(--ax) 82%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 15%, var(--wp-bg-1));
  border-bottom: 2px solid color-mix(in srgb, var(--ax) 55%, transparent);
}
/* The uncategorized bucket reads as a catch-all, not a real axis: same neutral
 * tint (via --ax) but a dashed edge instead of the solid axis accent. */
.wp-mx-th-band--bucket .chip { border-bottom-style: dashed; }
.wp-mx-grp-head--bucket .chip { border-left-style: dashed; }

/* Column tag chip — the per-tag header below the band (or the only header row
 * when columns are ungrouped). */
.wp-mx-th-col .chip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  min-height: 28px;
  padding: 3px 2px;
  font: 700 10px var(--wp-font-sans, sans-serif);
  border-radius: 0 0 4px 4px;
  color: color-mix(in srgb, var(--ax) 72%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 9%, var(--wp-bg-1));
}
.wp-mx-th-col.group-start .chip {
  border-left: 2px solid color-mix(in srgb, var(--ax) 45%, transparent);
}

/* Row group header chip — names the axis above its tags, pinned to the left
 * edge so it stays visible while cells scroll horizontally. The <th> spans the
 * row but stays transparent; only the chip is visible + sticky. */
.wp-mx-grp-row .wp-mx-grp-head {
  position: relative;          /* override the sticky tbody th; the chip pins */
  z-index: 1;
  background: transparent;
  padding: 4px 0 1px;
  text-align: left;
}
.wp-mx-grp-head .chip {
  position: sticky;
  left: 0;
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
  border-radius: 0 4px 4px 0;
  color: color-mix(in srgb, var(--ax) 80%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 16%, var(--wp-bg-1));
  border-left: 3px solid var(--ax);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--wp-bg) 55%, transparent);
}

/* Row tag chip — one per source sub-category, left accent in the axis hue. */
.wp-mx-th-row .chip {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 96px;
  height: 36px;
  padding: 0 10px;
  font: 700 10px var(--wp-font-sans, sans-serif);
  text-align: left;
  border-radius: 0 4px 4px 0;
  color: color-mix(in srgb, var(--ax) 76%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 10%, var(--wp-bg-1));
  border-left: 2px solid color-mix(in srgb, var(--ax) 48%, transparent);
}
/* Solo grouped axis — no header chip row; fold the axis name in as an eyebrow. */
.wp-mx-th-row.solo .chip {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  border-left-width: 3px;
  border-left-color: var(--ax);
}
.wp-mx-th-row.solo .eye {
  max-width: 78px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 700 7px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--ax) 72%, var(--wp-text-dim));
}
.wp-mx-th-row.solo .v {
  font: 600 11px var(--wp-font-sans, sans-serif);
  color: var(--wp-text);
}
.wp-mx-td { position: relative; }

.wp-mx-empty {
  text-align: center;
  color: var(--wp-text-dim);
  padding: var(--wp-space-7) var(--wp-space-5);
  font-size: var(--wp-text-sm);
}

/* ── Body cells ────────────────────────────────────────────── */
.wp-mx-cell {
  width: 64px;
  height: 36px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.08s, box-shadow 0.1s, background 0.1s;
  position: relative;
}
.wp-mx-cell:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--wp-text) 22%, transparent),
              0 2px 6px color-mix(in srgb, var(--wp-text) 20%, transparent);
}
.wp-mx-cell.open {
  box-shadow: 0 0 0 2px var(--wp-accent, #c4b5fd),
              0 4px 12px color-mix(in srgb, var(--wp-text) 25%, transparent);
}
.wp-mx-cell.s-neutral {
  background: color-mix(in srgb, var(--wp-text) 5%, transparent);
  color: var(--wp-text-dim, var(--wp-text-muted, #595c66));
  border: 1px dashed color-mix(in srgb, var(--wp-text) 10%, transparent);
}
.wp-mx-cell.s-exclude {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 22%, transparent);
  color: var(--wp-danger);
  border: 1px solid color-mix(in srgb, var(--wp-danger, #ef4444) 45%, transparent);
}
.wp-mx-cell.s-boost {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 22%, transparent);
  color: var(--wp-success);
  border: 1px solid color-mix(in srgb, var(--wp-success, #22c55e) 45%, transparent);
}
.wp-mx-cell.s-reduce {
  background: color-mix(in srgb, var(--wp-warn, #f97316) 22%, transparent);
  color: var(--wp-warn);
  border: 1px solid color-mix(in srgb, var(--wp-warn, #f97316) 45%, transparent);
}
.glyph { font-size: 14px; line-height: 1; }
.factor { font-size: 11px; font-weight: 700; }

/* ── Read-only recovery view (deleted source/target) ───────────
 *    Cells are inert: no pointer, no hover lift, no focus ring —
 *    they're a snapshot of the configured rules, not editable. The
 *    grid frame turns DASHED and the colored cells drop to ~1/3 of
 *    their editable intensity (8% bg / 18% border, text softened toward
 *    the dim grey) so the snapshot reads as "look, don't touch" while
 *    the boost/reduce/exclude hues stay legible. */
.wp-mx--readonly .wp-mx-grid {
  border: 1px dashed color-mix(in srgb, var(--wp-text) 16%, transparent);
}
.wp-mx--readonly .wp-mx-cell { cursor: default; }
.wp-mx--readonly .wp-mx-cell:hover {
  transform: none;
  box-shadow: none;
}
.wp-mx--readonly .wp-mx-cell.s-boost {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-success, #22c55e) 18%, transparent);
  color: color-mix(in srgb, var(--wp-success, #22c55e) 70%, var(--wp-text-dim));
}
.wp-mx--readonly .wp-mx-cell.s-reduce {
  background: color-mix(in srgb, var(--wp-warn, #f97316) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-warn, #f97316) 18%, transparent);
  color: color-mix(in srgb, var(--wp-warn, #f97316) 70%, var(--wp-text-dim));
}
.wp-mx--readonly .wp-mx-cell.s-exclude {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-danger, #ef4444) 18%, transparent);
  color: color-mix(in srgb, var(--wp-danger, #ef4444) 70%, var(--wp-text-dim));
}
.wp-mx-readonly-hint {
  margin: 8px 0 0;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim, var(--wp-text-muted));
}
</style>
