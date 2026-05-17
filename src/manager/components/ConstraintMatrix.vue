<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "./ui/Button.vue";
import Input from "./ui/Input.vue";
import type {
  ConstraintCell,
  ConstraintMatrix,
  ConstraintMode,
} from "../api/types";

interface Props {
  rows: string[]; // source values
  cols: string[]; // target sub-categories
  modelValue: ConstraintMatrix;
}
const props = defineProps<Props>();
const emit = defineEmits<{ "update:modelValue": [value: ConstraintMatrix] }>();

const MODE_ORDER: Record<ConstraintMode, ConstraintMode> = {
  allow: "exclude",
  exclude: "boost",
  boost: "reduce",
  reduce: "allow",
};
const MODE_DEFAULT_FACTOR: Record<ConstraintMode, number> = {
  allow: 1,
  exclude: 0,
  boost: 2,
  reduce: 0.5,
};
const MODE_ICON: Record<ConstraintMode, string> = {
  allow: "·",
  exclude: "×",
  boost: "↑",
  reduce: "↓",
};
const MODE_LABEL: Record<ConstraintMode, string> = {
  allow: "Allow",
  exclude: "Exclude",
  boost: "Boost",
  reduce: "Reduce",
};

function cellAt(row: string, col: string): ConstraintCell {
  const raw = props.modelValue?.[row]?.[col];
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

function cycleCell(row: string, col: string) {
  const cur = cellAt(row, col);
  const nextMode = MODE_ORDER[cur.mode];
  writeCell(row, col, {
    mode: nextMode,
    factor: MODE_DEFAULT_FACTOR[nextMode],
  });
}

function setCellFactor(row: string, col: string, factor: number) {
  const cur = cellAt(row, col);
  writeCell(row, col, { mode: cur.mode, factor });
}

function fmtFactor(f: number): string {
  if (!Number.isFinite(f)) return "1";
  if (f >= 10) return f.toFixed(0);
  return f.toFixed(2).replace(/\.?0+$/, "");
}

// ----- Tune popover state ------------------------------------------------
interface TuneState {
  row: string;
  col: string;
  left: number;
  top: number;
}
const tune = ref<TuneState | null>(null);

function isOpenAt(row: string, col: string) {
  return tune.value?.row === row && tune.value?.col === col;
}

function openTune(row: string, col: string, ev: MouseEvent) {
  ev.stopPropagation();
  if (isOpenAt(row, col)) {
    tune.value = null;
    return;
  }
  const wrap = (ev.currentTarget as HTMLElement).closest(
    ".wp-matrix-cell-wrap",
  ) as HTMLElement | null;
  const rect = wrap?.getBoundingClientRect();
  const POP_W = 260;
  const left = rect
    ? Math.min(
        window.innerWidth - POP_W - 12,
        Math.max(12, rect.left + rect.width / 2 - POP_W / 2),
      )
    : 12;
  const top = rect ? rect.bottom + 8 : 12;
  tune.value = { row, col, left, top };
}

function closeTune() {
  tune.value = null;
}

function onDocumentMousedown(ev: MouseEvent) {
  if (!tune.value) return;
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  if (target.closest(".wp-tune-pop")) return;
  if (target.closest(".wp-matrix-cell-wrap")) return;
  closeTune();
}

onMounted(() => {
  window.addEventListener("mousedown", onDocumentMousedown);
  window.addEventListener("scroll", closeTune, true);
  window.addEventListener("resize", closeTune);
});
onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onDocumentMousedown);
  window.removeEventListener("scroll", closeTune, true);
  window.removeEventListener("resize", closeTune);
});

const tuneCell = computed<ConstraintCell | null>(() => {
  if (!tune.value) return null;
  return cellAt(tune.value.row, tune.value.col);
});

const presets = computed(() => {
  if (!tuneCell.value) return [];
  return tuneCell.value.mode === "boost"
    ? [1.5, 2, 3, 5]
    : tuneCell.value.mode === "reduce"
      ? [0.75, 0.5, 0.25, 0.1]
      : [];
});

function applyPreset(p: number) {
  if (!tune.value) return;
  setCellFactor(tune.value.row, tune.value.col, p);
}

function onTuneInput(value: string | number) {
  if (!tune.value) return;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return;
  setCellFactor(tune.value.row, tune.value.col, n);
}

defineExpose({ cellAt, cycleCell });
</script>

<template>
  <div class="matrix-wrap">
    <table class="wp-matrix" data-test="constraint-matrix">
      <thead>
        <tr>
          <th class="wp-matrix__corner">
            <span class="font-mono text-[10px] uppercase tracking-wide">source ↓</span>
            <span class="font-mono text-[10px] uppercase tracking-wide">target →</span>
          </th>
          <th
            v-for="col in cols"
            :key="col"
            class="wp-matrix__col-h"
          >
            {{ col }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row">
          <td class="wp-matrix__row-h">{{ row }}</td>
          <td v-for="col in cols" :key="col" class="wp-matrix__cell-td">
            <div class="wp-matrix-cell-wrap">
              <button
                type="button"
                class="wp-matrix-cell"
                :data-mode="cellAt(row, col).mode"
                :data-test="`cell-${row}-${col}`"
                :aria-label="`Cell ${row} × ${col}: ${MODE_LABEL[cellAt(row, col).mode]}${cellAt(row, col).mode === 'boost' || cellAt(row, col).mode === 'reduce' ? ' ×' + fmtFactor(cellAt(row, col).factor) : ''}`"
                @click="cycleCell(row, col)"
              >
                <span class="wp-matrix-cell__icon">{{ MODE_ICON[cellAt(row, col).mode] }}</span>
                <span
                  v-if="cellAt(row, col).mode === 'boost' || cellAt(row, col).mode === 'reduce'"
                  class="wp-matrix-cell__factor"
                >×{{ fmtFactor(cellAt(row, col).factor) }}</span>
              </button>
              <button
                v-if="cellAt(row, col).mode === 'boost' || cellAt(row, col).mode === 'reduce'"
                type="button"
                class="wp-matrix-cell__tune"
                :aria-label="`Tune factor for ${row} × ${col}`"
                @click="openTune(row, col, $event)"
              >
                <i class="pi pi-cog" aria-hidden="true" />
              </button>
            </div>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="cols.length + 1" class="wp-matrix__empty">
            No source values yet — add options to the source wildcard first.
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Tune popover (absolute positioning so it escapes the table overflow ctx) -->
    <div
      v-if="tune && tuneCell && (tuneCell.mode === 'boost' || tuneCell.mode === 'reduce')"
      class="wp-tune-pop"
      data-test="tune-popover"
      role="dialog"
      :aria-label="`Tune ${tuneCell.mode} factor`"
      :style="{ left: tune.left + 'px', top: tune.top + 'px' }"
      @mousedown.stop
    >
      <div class="wp-tune-pop__head">
        <span class="font-mono text-xs" :class="tuneCell.mode === 'boost' ? 'text-wp-success' : 'text-wp-warn'">
          {{ MODE_LABEL[tuneCell.mode] }} factor
        </span>
        <span class="font-mono text-sm text-wp-text">×{{ fmtFactor(tuneCell.factor) }}</span>
      </div>
      <div class="wp-tune-pop__row">
        <Input
          :model-value="tuneCell.factor"
          type="number"
          aria-label="Factor value"
          @update:model-value="onTuneInput"
        />
        <div class="wp-tune-pop__presets">
          <button
            v-for="p in presets"
            :key="p"
            type="button"
            class="wp-chip-btn"
            :data-active="Math.abs(tuneCell.factor - p) < 0.001"
            :aria-label="`Preset factor ${p}`"
            @click="applyPreset(p)"
          >×{{ fmtFactor(p) }}</button>
        </div>
      </div>
      <div class="wp-tune-pop__done">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Close tune popover"
          @click="closeTune"
        >Done</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.matrix-wrap {
  position: relative;
  overflow-x: auto;
}
.wp-matrix {
  border-collapse: separate;
  border-spacing: 4px;
  font-size: 12px;
}
.wp-matrix__corner {
  padding: 0 var(--wp-space-4);
  text-align: left;
  color: var(--wp-text-dim);
  font-weight: 500;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--wp-bg-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-matrix__col-h {
  padding: 0 var(--wp-space-4);
  color: var(--wp-text-muted);
  font-weight: 500;
  white-space: nowrap;
}
.wp-matrix__row-h {
  padding: 0 var(--wp-space-4);
  color: var(--wp-text-muted);
  white-space: nowrap;
  text-align: left;
  height: 32px;
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--wp-bg-2);
}
.wp-matrix__cell-td { height: 32px; }
.wp-matrix__empty {
  text-align: center;
  color: var(--wp-text-dim);
  padding: var(--wp-space-7) var(--wp-space-5);
  font-size: 12px;
}
.wp-matrix-cell-wrap {
  position: relative;
  display: inline-block;
}
.wp-matrix-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px; /* audit-exempt: 3px optical icon+text gap inside compact cell */
  min-width: 56px;
  height: 30px;
  padding: 0 var(--wp-space-4);
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--wp-border);
  font-family: var(--wp-font-mono, monospace);
  background: var(--wp-bg-3);
  color: var(--wp-text-dim);
  transition: background 0.12s, border-color 0.12s, transform 0.04s;
}
.wp-matrix-cell:hover { transform: translateY(-1px); }
.wp-matrix-cell[data-mode="allow"] {
  min-width: 36px;
  padding: 0 var(--wp-space-3);
}
.wp-matrix-cell[data-mode="exclude"] {
  min-width: 36px;
  padding: 0 var(--wp-space-3);
  background: rgba(239, 68, 68, 0.18);
  background: color-mix(in oklab, var(--wp-danger) 18%, transparent);
  color: var(--wp-danger);
  border-color: rgba(239, 68, 68, 0.40);
  border-color: color-mix(in oklab, var(--wp-danger) 40%, transparent);
}
.wp-matrix-cell[data-mode="boost"] {
  background: rgba(34, 197, 94, 0.18);
  background: color-mix(in oklab, var(--wp-success) 18%, transparent);
  color: var(--wp-success);
  border-color: rgba(34, 197, 94, 0.40);
  border-color: color-mix(in oklab, var(--wp-success) 40%, transparent);
}
.wp-matrix-cell[data-mode="reduce"] {
  background: rgba(245, 158, 11, 0.18);
  background: color-mix(in oklab, var(--wp-warn) 18%, transparent);
  color: var(--wp-warn);
  border-color: rgba(245, 158, 11, 0.40);
  border-color: color-mix(in oklab, var(--wp-warn) 40%, transparent);
}
.wp-theme-light .wp-matrix-cell[data-mode="exclude"] { color: #991b1b; }
.wp-theme-light .wp-matrix-cell[data-mode="boost"]   { color: #166534; }
.wp-theme-light .wp-matrix-cell[data-mode="reduce"]  { color: #92400e; }
.wp-matrix-cell__icon {
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
}
.wp-matrix-cell__factor {
  font-family: var(--wp-font-mono, monospace);
  font-size: 10.5px;
  font-weight: 500;
  opacity: 0.85;
}
.wp-matrix-cell__tune {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--wp-bg-1, var(--wp-bg));
  border: 1px solid var(--wp-border-strong, var(--wp-border2));
  color: var(--wp-text-muted);
  cursor: pointer;
  padding: 0;
  font-size: 9px;
  box-shadow: var(--wp-shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.4));
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.wp-matrix-cell__tune:hover {
  color: var(--wp-accent-text, var(--wp-accent));
  border-color: var(--wp-accent-500, var(--wp-accent));
  background: var(--wp-bg-2);
}
.wp-tune-pop {
  position: fixed;
  width: 260px;
  z-index: 200;
  background: var(--wp-bg-1, var(--wp-bg));
  border: 1px solid var(--wp-border-strong, var(--wp-border2));
  border-radius: 10px;
  padding: var(--wp-space-5) var(--wp-space-5); /* audit-exempt: was 10/12; rounded to 12 */
  box-shadow: var(--wp-shadow-md, 0 12px 28px rgba(0, 0, 0, 0.35));
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
}
.wp-tune-pop__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.wp-tune-pop__row {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--wp-space-4);
  align-items: center;
}
.wp-tune-pop__presets {
  display: flex;
  gap: var(--wp-space-2);
  flex-wrap: wrap;
  justify-content: flex-start;
}
.wp-chip-btn {
  padding: 3px 7px; /* audit-exempt: 3px/7px compact chip for preset buttons */
  border-radius: 999px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2);
  color: var(--wp-text-muted);
  font-size: 10.5px;
  font-family: var(--wp-font-mono, monospace);
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.wp-chip-btn:hover {
  color: var(--wp-text);
  border-color: var(--wp-border-strong, var(--wp-border2));
}
.wp-chip-btn[data-active="true"] {
  color: var(--wp-accent-text, var(--wp-accent));
  border-color: var(--wp-accent-500, var(--wp-accent));
  background: color-mix(in oklab, var(--wp-accent-500, var(--wp-accent)) 14%, transparent);
}
.text-wp-success { color: var(--wp-success); }
.text-wp-warn { color: var(--wp-warn); }
.wp-tune-pop__done { display: flex; justify-content: flex-end; }
</style>
