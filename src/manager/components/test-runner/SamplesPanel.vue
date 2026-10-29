<script setup lang="ts">
/**
 * Samples tab: one row per returned seed with the variables that varied,
 * filterable by any cell text. Click a row for that seed's trace.
 */
import SearchInput from "@/kit/SearchInput.vue";
import { computed, ref } from "vue";
import DataTable, { type DataColumn, type DataSort } from "../ui/DataTable.vue";
import type { ScenarioRunResponse } from "../../api/types";
import { negativeText, orderByStack, renderValue, type StackItemView } from "../../utils/scenario";

const props = defineProps<{
  result: ScenarioRunResponse;
  views: StackItemView[];
  outputVar: string | null;
  selectedSeed: number | null;
}>();
const emit = defineEmits<{ (e: "open", seed: number): void }>();

const MAX_COLS = 6;
const filter = ref("");

/** Columns: variables that took more than one value, in stack order, with
 *  the output last. When nothing varied, every variable is shown so the
 *  table is never just a list of seeds. */
const columns = computed(() => {
  const vars = props.result.variables;
  const out = props.outputVar && props.outputVar in vars ? props.outputVar : null;
  let names = Object.entries(vars)
    .filter(([n, v]) => v.distinct > 1 && n !== out)
    .map(([n]) => n);
  if (!names.length && !out) names = Object.keys(vars);
  const ordered = orderByStack(names, props.views).slice(0, out ? MAX_COLS - 1 : MAX_COLS);
  return out ? [...ordered, out] : ordered;
});

/** The output's negative words get their own column when any seed has some. */
const negColumn = computed(() => {
  const out = props.outputVar;
  return !!out && props.result.samples.some((s) => (s.negatives?.[out]?.length ?? 0) > 0);
});

interface SampleRow {
  seed: number;
  error: string | null | undefined;
  warnings: number;
  cells: string[];
  negative: string;
  [key: `v${number}`]: string;
}

const rows = computed<SampleRow[]>(() => {
  const q = filter.value.trim().toLowerCase();
  const out = props.outputVar;
  return props.result.samples
    .map((s) => {
      const cells = columns.value.map((c) => renderValue(s.vars[c]));
      const row: SampleRow = {
        seed: s.seed,
        error: s.error,
        warnings: s.warnings.length,
        cells,
        negative: negColumn.value && out ? negativeText(s, out) : "",
      };
      cells.forEach((c, i) => { row[`v${i}`] = c; });
      return row;
    })
    .filter((r) => !q || String(r.seed).includes(q)
      || r.cells.some((c) => c.toLowerCase().includes(q))
      || r.negative.toLowerCase().includes(q));
});

/** One column per variable (`v0`, `v1`…, sortable by its text), then the
 *  output's negatives and the warning count. */
const tableColumns = computed<DataColumn<SampleRow>[]>(() => [
  { key: "seed", label: "Seed", sortable: true, mono: true, class: "wp-trsm__seed" },
  ...columns.value.map((c, i): DataColumn<SampleRow> => ({
    key: `v${i}`,
    label: `$${c}`,
    sortable: true,
    class: c === props.outputVar ? "wp-trsm__out" : "wp-trsm__var",
  })),
  ...(negColumn.value ? [{ key: "negative", label: "Negative", class: "wp-trsm__neg" }] : []),
  { key: "warnings", label: "Warnings", sortable: true, align: "right" as const, firstDir: "desc" as const },
]);

const sort = ref<DataSort | null>(null);
const varCols = computed(() => columns.value.map((c, i) => ({ name: c, key: `v${i}`, index: i })));
</script>

<template>
  <div class="wp-trsm" data-test="samples-panel">
    <div class="wp-trsm__bar">
      <SearchInput
        v-model="filter"
        class="wp-trsm__filter"
        size="sm"
        placeholder="Filter by seed or value…"
        aria-label="Filter samples"
        data-test="samples-filter"
      />
      <span>{{ rows.length }} of {{ result.samples.length }} returned seeds<template v-if="result.samples.length < result.runs"> (the run covered {{ result.runs }})</template></span>
    </div>
    <p v-if="!columns.length" class="wp-trsm__none" data-test="samples-empty">
      This stack writes no variables, so there is nothing to tabulate. A constraint on its own only re-weights a later wildcard: add its source and target wildcards to see its effect.
    </p>
    <DataTable
      v-else
      v-model:sort="sort"
      class="wp-trsm__table"
      :columns="tableColumns"
      :rows="rows"
      :row-key="(r: SampleRow) => String(r.seed)"
      :active-key="selectedSeed === null ? null : String(selectedSeed)"
      :row-attrs="() => ({ 'data-test': 'sample-row' })"
      row-clickable
      size="sm"
      aria-label="Samples"
      empty-text="No seed matches the filter."
      @row-click="(r: SampleRow) => emit('open', r.seed)"
    >
      <template v-for="c in varCols" :key="`h-${c.key}`" #[`head-${c.key}`]>
        <code>${{ c.name }}</code>
      </template>
      <template v-for="c in varCols" :key="`c-${c.key}`" #[`cell-${c.key}`]="{ row }">
        <span v-if="row.error" :class="{ 'wp-trsm__err': c.index === 0 }" :title="c.index === 0 ? row.error : undefined">{{ c.index === 0 ? row.error : "" }}</span>
        <span v-else :title="row.cells[c.index]">{{ row.cells[c.index] }}</span>
      </template>
      <template #head-negative>
        <span data-test="samples-neg-head" :title="`Negative words $${outputVar} carries`">Negative</span>
      </template>
      <template #cell-negative="{ row }">
        <span data-test="sample-neg" :title="row.negative">{{ row.error ? "" : row.negative }}</span>
      </template>
      <template #cell-warnings="{ row }">
        <span :class="{ 'wp-trsm__warn': row.warnings }">{{ row.warnings }}</span>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.wp-trsm { display: flex; flex-direction: column; gap: var(--wp-space-5); }
.wp-trsm__bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-5); font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trsm__filter { width: min(320px, 100%); }
/* DataTable draws the rows, sticky header, sort buttons and the open row;
 * this caps its height and keeps long values to one line. */
.wp-trsm__table { max-height: 560px; border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm); }
.wp-trsm__table :deep(td) { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-trsm__table :deep(td.wp-trsm__out) { max-width: 520px; }
.wp-trsm__table :deep(th code) { color: var(--wp-accent-text); text-transform: none; }
.wp-trsm__table :deep(th.wp-trsm__out code) { color: var(--wp-text); }
.wp-trsm__table :deep(.wp-trsm__seed) { color: var(--wp-text-muted); }
.wp-trsm__none { margin: 0; font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-trsm__warn { color: var(--wp-warn); }
.wp-trsm__err { color: var(--wp-danger-text); }
.wp-trsm__table :deep(td.wp-trsm__neg) { color: var(--wp-danger-text); max-width: 320px; }
.wp-trsm__table :deep(th.wp-trsm__neg) { color: var(--wp-danger-text); }
</style>
