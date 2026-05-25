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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type {
  ConstraintCell,
  ConstraintMatrix,
  ConstraintMode,
} from "../api/types";
import CellRulePopover from "../../components/context/editors/constraint/CellRulePopover.vue";
import MatrixLegend from "../../components/context/editors/constraint/MatrixLegend.vue";

type RuleState = "neutral" | "exclude" | "boost" | "reduce";

interface Props {
  rows: string[];      // source sub-categories
  cols: string[];      // target sub-categories
  modelValue: ConstraintMatrix;
  sourceName?: string; // wildcard name shown in the source axis tag
  targetName?: string; // wildcard name shown in the target axis tag
}
const props = withDefaults(defineProps<Props>(), {
  sourceName: "",
  targetName: "",
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
});
onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onDocumentMousedown);
  window.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("scroll", reanchorPopover, true);
  window.removeEventListener("resize", reanchorPopover);
});

defineExpose({ cellAt });
</script>

<template>
  <section class="wp-mx" data-test="constraint-matrix">
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

    <div class="wp-mx-grid">
      <table>
        <thead>
          <tr>
            <th class="wp-mx-corner" data-test="mx-corner">
              <span class="row-1">↓ source</span>
              <span class="row-2">→ target</span>
            </th>
            <th
              v-for="col in cols"
              :key="col"
              class="wp-mx-th-col"
            >{{ col }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row">
            <th class="wp-mx-th-row">{{ row }}</th>
            <td v-for="col in cols" :key="col" class="wp-mx-td">
              <div
                class="wp-mx-cell"
                :class="[
                  `s-${toState(cellAt(row, col).mode)}`,
                  { open: isOpenAt(row, col) },
                ]"
                :data-mode="cellAt(row, col).mode"
                :data-test="`cell-${row}-${col}`"
                :aria-label="cellAriaLabel(row, col)"
                role="button"
                tabindex="0"
                @click="openPopover(row, col, $event)"
                @keydown.enter.prevent="openPopover(row, col, $event as unknown as MouseEvent)"
                @keydown.space.prevent="openPopover(row, col, $event as unknown as MouseEvent)"
              >
                <span class="glyph">{{ MODE_ICON[cellAt(row, col).mode] }}</span>
                <span
                  v-if="cellAt(row, col).mode === 'boost' || cellAt(row, col).mode === 'reduce'"
                  class="factor"
                >×{{ fmtFactor(cellAt(row, col).factor) }}</span>
              </div>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td :colspan="cols.length + 1" class="wp-mx-empty">
              No source values yet — add options to the source wildcard first.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

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
  color: #d8b4fe;
  background: color-mix(in oklab, #c084fc 14%, transparent);
  border: 1px solid color-mix(in oklab, #c084fc 35%, transparent);
}
.wp-mx-axis--tgt {
  color: #67e8f9;
  background: color-mix(in oklab, #22d3ee 14%, transparent);
  border: 1px solid color-mix(in oklab, #22d3ee 35%, transparent);
}
.wp-mx-axis .arrow { font: 14px var(--wp-font-mono, monospace); line-height: 1; }

/* ── Grid frame ────────────────────────────────────────────── */
.wp-mx-grid {
  display: inline-block;
  background: var(--wp-bg-deep, var(--wp-bg-1, #0e1015));
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  padding: 6px;
  overflow-x: auto;
  max-width: 100%;
}
.wp-mx-grid table { border-collapse: separate; border-spacing: 4px; }
.wp-mx-grid th,
.wp-mx-grid td { padding: 0; vertical-align: middle; }

.wp-mx-corner {
  width: 96px;
  height: 32px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 9px;
  color: var(--wp-text-dim, var(--wp-text-muted));
  border-radius: 4px;
  text-align: left;
  padding: 0 8px !important;
  background: color-mix(in srgb, var(--wp-text) 4%, transparent);
}
.wp-mx-corner .row-1 { display: block; color: var(--wp-constraint-source-text); line-height: 1.3; }
.wp-mx-corner .row-2 { display: block; color: var(--wp-constraint-target-text); line-height: 1.3; }

.wp-mx-th-col {
  width: 64px;
  height: 28px;
  font: 700 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-constraint-target-text);
  background: color-mix(in oklab, var(--wp-constraint-target) 10%, transparent);
  border-radius: 4px;
  text-align: center;
}
.wp-mx-th-row {
  width: 96px;
  height: 36px;
  font: 700 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-constraint-source-text);
  background: color-mix(in oklab, var(--wp-constraint-source) 10%, transparent);
  border-radius: 4px;
  text-align: right;
  padding: 0 12px !important;
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
</style>
