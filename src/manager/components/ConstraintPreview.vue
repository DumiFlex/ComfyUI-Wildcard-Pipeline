<script setup lang="ts">
/**
 * ConstraintPreview — a table of chances: one row per source option, one
 * column per target option, each cell the chance that target option is
 * picked when that source option was. With `before`, cells that moved show
 * which way and what they were (the AI review uses this to show what its
 * rules would change).
 */
import { computed } from "vue";
import type { ConstraintException, ConstraintMatrix } from "../api/types";
import { previewConstraint, type PreviewWildcard } from "../utils/constraint-preview";

const props = defineProps<{
  source: PreviewWildcard;
  target: PreviewWildcard;
  matrix: ConstraintMatrix;
  exceptions: ConstraintException[];
  before?: { matrix: ConstraintMatrix; exceptions: ConstraintException[] };
}>();

const MAX_ROWS = 60;
const MAX_COLS = 40;

const table = computed(() => previewConstraint(props.source, props.target, props.matrix, props.exceptions));
const beforeTable = computed(() =>
  props.before ? previewConstraint(props.source, props.target, props.before.matrix, props.before.exceptions) : null,
);
const cols = computed(() => table.value.targets.slice(0, MAX_COLS));
const rows = computed(() => table.value.rows.slice(0, MAX_ROWS));
const cut = computed(
  () => table.value.rows.length > MAX_ROWS || table.value.targets.length > MAX_COLS,
);
const changedRows = computed(() => {
  const b = beforeTable.value;
  if (!b) return 0;
  return table.value.rows.filter((r, i) => r.chances.some((c, j) => Math.abs(c - (b.rows[i]?.chances[j] ?? 0)) >= 0.005)).length;
});

function label(v: string): string {
  return v === "" ? "⌀ null" : v;
}
function pct(c: number): string {
  if (c <= 0) return "–";
  if (c >= 0.995) return "100%";
  return c < 0.01 ? "<1%" : `${Math.round(c * 100)}%`;
}
function delta(ri: number, ci: number): "up" | "down" | null {
  const b = beforeTable.value;
  if (!b) return null;
  const d = (table.value.rows[ri]?.chances[ci] ?? 0) - (b.rows[ri]?.chances[ci] ?? 0);
  if (Math.abs(d) < 0.005) return null;
  return d > 0 ? "up" : "down";
}
function cellTitle(ri: number, ci: number): string {
  const r = rows.value[ri];
  const now = `${label(cols.value[ci])} when ${label(r.source)}: ${pct(r.chances[ci])}`;
  const b = beforeTable.value?.rows[ri]?.chances[ci];
  return b === undefined || !delta(ri, ci) ? now : `${now} (was ${pct(b)})`;
}
</script>

<template>
  <div class="wp-cn-preview" data-test="constraint-preview">
    <p v-if="before" class="wp-cn-preview__hint">
      Chance of each target option when the source picks a row. Arrows mark what these rules change
      ({{ changedRows }} row{{ changedRows === 1 ? "" : "s" }}).
    </p>
    <div class="wp-cn-preview__scroll">
      <table class="wp-cn-preview__table">
        <thead>
          <tr>
            <th class="wp-cn-preview__corner">
              <span class="wp-cn-preview__src">↓ source</span><span class="wp-cn-preview__tgt">→ target</span>
            </th>
            <th v-for="(t, ci) in cols" :key="ci" class="wp-cn-preview__col" :title="label(t)">
              <span>{{ label(t) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, ri) in rows" :key="ri" :data-empty="r.empty ? 'true' : 'false'">
            <th class="wp-cn-preview__row" :title="label(r.source)">
              <span class="wp-cn-preview__rowname">{{ label(r.source) }}</span>
              <span v-if="r.fallbackUsed" class="wp-cn-preview__flag" title="Every option was ruled out, so the fallback option stands in">fallback</span>
              <span v-else-if="r.empty" class="wp-cn-preview__flag" data-tone="warn" title="Every option is ruled out and there is no fallback">nothing left</span>
            </th>
            <td
              v-for="(_, ci) in cols"
              :key="ci"
              class="wp-cn-preview__cell"
              :data-zero="r.chances[ci] <= 0 ? 'true' : 'false'"
              :data-delta="delta(ri, ci) ?? undefined"
              :style="{ '--wp-p': `${Math.round(r.chances[ci] * 100)}%` }"
              :title="cellTitle(ri, ci)"
            >
              {{ pct(r.chances[ci]) }}<i
                v-if="delta(ri, ci)"
                :class="['pi', delta(ri, ci) === 'up' ? 'pi-arrow-up' : 'pi-arrow-down']"
                aria-hidden="true"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="cut" class="wp-cn-preview__hint">Showing the first {{ MAX_ROWS }} source and {{ MAX_COLS }} target options.</p>
  </div>
</template>

<style scoped>
.wp-cn-preview { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.wp-cn-preview__hint { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-cn-preview__scroll {
  overflow: auto;
  max-height: 420px;
  overscroll-behavior: contain;
  border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-1);
}
.wp-cn-preview__table { border-collapse: separate; border-spacing: 0; font-size: 12px; }
.wp-cn-preview__table th, .wp-cn-preview__table td { border-bottom: 1px solid var(--wp-border); border-right: 1px solid var(--wp-border); }
.wp-cn-preview__corner, .wp-cn-preview__col {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--wp-bg-2);
}
.wp-cn-preview__corner {
  left: 0;
  z-index: 2;
  display: table-cell;
  padding: 4px 8px;
  text-align: left;
  font-size: 10px;
  font-weight: 600;
  color: var(--wp-text-dim);
  white-space: nowrap;
}
.wp-cn-preview__corner span { display: block; }
.wp-cn-preview__src { color: var(--wp-constraint-source-text); }
.wp-cn-preview__tgt { color: var(--wp-constraint-target-text); }
.wp-cn-preview__col {
  padding: 6px 8px;
  max-width: 120px;
  min-width: 64px;
  font-weight: 600;
  color: var(--wp-constraint-target-text);
  font-family: var(--wp-font-mono, monospace);
  text-align: center;
}
.wp-cn-preview__col span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-cn-preview__row {
  position: sticky;
  left: 0;
  background: var(--wp-bg-2);
  padding: 6px 10px;
  text-align: left;
  max-width: 220px;
  font-family: var(--wp-font-mono, monospace);
  font-weight: 600;
  color: var(--wp-constraint-source-text);
  white-space: nowrap;
}
.wp-cn-preview__rowname { display: inline-block; max-width: 160px; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }
.wp-cn-preview__flag {
  margin-left: 6px;
  font-family: inherit;
  font-size: 10px;
  font-weight: 500;
  padding: 0 5px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  color: var(--wp-text-muted);
  border: 1px solid var(--wp-border);
}
.wp-cn-preview__flag[data-tone="warn"] { color: var(--wp-warn); border-color: color-mix(in oklab, var(--wp-warn) 45%, transparent); }
.wp-cn-preview__cell {
  padding: 6px 8px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--wp-text);
  white-space: nowrap;
  background: color-mix(in oklab, var(--wp-accent-500) calc(var(--wp-p) * 0.45), transparent);
}
.wp-cn-preview__cell[data-zero="true"] {
  color: var(--wp-danger);
  background: color-mix(in oklab, var(--wp-danger) 8%, transparent);
}
.wp-cn-preview__cell .pi { font-size: 9px; margin-left: 3px; }
.wp-cn-preview__cell[data-delta] { box-shadow: inset 0 0 0 1px var(--wp-accent-400); }
.wp-cn-preview__cell[data-delta="up"] .pi { color: var(--wp-success); }
.wp-cn-preview__cell[data-delta="down"] .pi { color: var(--wp-danger); }
</style>
