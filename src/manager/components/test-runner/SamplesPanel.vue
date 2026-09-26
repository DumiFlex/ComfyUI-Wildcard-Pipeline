<script setup lang="ts">
/**
 * Samples tab: one row per returned seed with the variables that varied,
 * filterable by any cell text. Click a row for that seed's trace.
 */
import { computed, ref } from "vue";
import type { ScenarioRunResponse } from "../../api/types";
import { orderByStack, renderValue, type StackItemView } from "../../utils/scenario";

const props = defineProps<{
  result: ScenarioRunResponse;
  views: StackItemView[];
  outputVar: string | null;
  selectedSeed: number | null;
}>();
const emit = defineEmits<{ (e: "open", seed: number): void }>();

const MAX_COLS = 6;
const filter = ref("");

/** Columns: variables that took more than one value, in stack order,
 *  excluding the (long) output which the Outputs tab covers. */
const columns = computed(() => {
  const names = Object.entries(props.result.variables)
    .filter(([n, v]) => v.distinct > 1 && n !== props.outputVar)
    .map(([n]) => n);
  return orderByStack(names, props.views).slice(0, MAX_COLS);
});

const rows = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return props.result.samples
    .map((s) => ({
      seed: s.seed,
      error: s.error,
      warnings: s.warnings.length,
      cells: columns.value.map((c) => renderValue(s.vars[c])),
    }))
    .filter((r) => !q || String(r.seed).includes(q) || r.cells.some((c) => c.toLowerCase().includes(q)));
});
</script>

<template>
  <div class="wp-trsm" data-test="samples-panel">
    <div class="wp-trsm__bar">
      <input
        v-model="filter"
        type="search"
        placeholder="Filter by seed or value…"
        aria-label="Filter samples"
        data-test="samples-filter"
      >
      <span>{{ rows.length }} of {{ result.samples.length }} returned seeds<template v-if="result.samples.length < result.runs"> (the run covered {{ result.runs }})</template></span>
    </div>
    <div class="wp-trsm__scroll">
      <table>
        <thead>
          <tr>
            <th>Seed</th>
            <th v-for="c in columns" :key="c"><code>${{ c }}</code></th>
            <th>Warnings</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.seed"
            :data-selected="r.seed === selectedSeed ? 'true' : 'false'"
            tabindex="0"
            data-test="sample-row"
            @click="emit('open', r.seed)"
            @keydown.enter="emit('open', r.seed)"
          >
            <td class="wp-trsm__seed">{{ r.seed }}</td>
            <td v-if="r.error" :colspan="Math.max(1, columns.length)" class="wp-trsm__err">{{ r.error }}</td>
            <template v-else>
              <td v-for="(cell, i) in r.cells" :key="i" :title="cell">{{ cell }}</td>
            </template>
            <td :class="{ 'wp-trsm__warn': r.warnings }">{{ r.warnings }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.wp-trsm { display: flex; flex-direction: column; gap: var(--wp-space-5); }
.wp-trsm__bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-5); font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trsm__bar input {
  width: min(320px, 100%); background: var(--wp-bg-1); color: var(--wp-text);
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-3) var(--wp-space-4); font-size: var(--wp-text-sm);
}
.wp-trsm__bar input:focus-visible { outline: none; border-color: var(--wp-border-focus); }
.wp-trsm__scroll { overflow: auto; max-height: 560px; border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm); }
table { border-collapse: collapse; width: 100%; font-size: var(--wp-text-sm); }
th {
  position: sticky; top: 0; background: var(--wp-bg-2); text-align: left; white-space: nowrap;
  padding: var(--wp-space-3) var(--wp-space-4); border-bottom: 1px solid var(--wp-border);
  font-size: var(--wp-text-xs); font-weight: var(--wp-weight-medium); color: var(--wp-text-muted);
}
th code { color: var(--wp-accent-text); }
td {
  padding: var(--wp-space-3) var(--wp-space-4); border-bottom: 1px solid var(--wp-border);
  max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
tbody tr { cursor: pointer; }
tbody tr:hover td { background: var(--wp-bg-3); }
tbody tr[data-selected="true"] td { background: color-mix(in oklab, var(--wp-accent-500) 16%, transparent); }
tbody tr:focus-visible { outline: 2px solid var(--wp-border-focus); outline-offset: -2px; }
.wp-trsm__seed { font-family: var(--wp-font-mono); color: var(--wp-text-muted); }
.wp-trsm__warn { color: var(--wp-warn); }
.wp-trsm__err { color: var(--wp-danger-text); }
</style>
