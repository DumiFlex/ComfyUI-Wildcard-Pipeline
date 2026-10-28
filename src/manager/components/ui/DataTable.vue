<script setup lang="ts" generic="T extends object">
/**
 * DataTable: rows and columns with a sticky header, sortable columns, row
 * selection, a loading state and an empty state. Built on the `.wp-table`
 * classes so it matches the list pages.
 *
 *   <DataTable
 *     v-model:sort="sort" v-model:selected="picked"
 *     :columns="[{ key: 'name', label: 'Name', sortable: true }, { key: 'uses', label: 'Uses', align: 'right', sortable: true }]"
 *     :rows="rows" row-key="id" selectable aria-label="Tags"
 *   >
 *     <template #cell-name="{ row }"><Chip>{{ row.name }}</Chip></template>
 *     <template #empty><EmptyState … /></template>
 *   </DataTable>
 *
 * Sorting (APG sortable table): each sortable header holds a button, and only
 * the sorted column carries `aria-sort`. The table sorts its rows itself
 * (by `sortValue`, else the cell value); with `manual-sort` it only reports
 * the sort and the parent passes rows in order.
 *
 * `row-clickable` makes each row open something (a trace, a detail panel):
 * rows take focus, and a click or Enter emits `row-click`. `active-key`
 * marks the row that is open.
 */
import { computed } from "vue";
import Checkbox from "./Checkbox.vue";

export interface DataColumn<R> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** A CSS width for the column, e.g. `120px` or `30%`. */
  width?: string;
  /** Show the value in the mono font (counts, ids, seeds). */
  mono?: boolean;
  /** The value to sort by, when it isn't `row[key]`. */
  sortValue?: (row: R) => string | number | null | undefined;
  /** The direction a first click sorts in. */
  firstDir?: "asc" | "desc";
  /** Hide the header text (an actions column); it still names the cells. */
  hideLabel?: boolean;
  /** A class on the column's header and cells. */
  class?: string;
  /** Extra attributes on the header cell (e.g. `data-ai-anchor`). */
  headAttrs?: Record<string, string>;
}

export interface DataSort { key: string; dir: "asc" | "desc" }

const props = withDefaults(defineProps<{
  columns: DataColumn<T>[];
  rows: T[];
  /** A field name, or a function, giving each row a stable key. */
  rowKey: string | ((row: T) => string);
  sort?: DataSort | null;
  /** The parent sorts the rows; the table only reports clicks. */
  manualSort?: boolean;
  selectable?: boolean;
  selected?: string[];
  loading?: boolean;
  /** How many placeholder rows to draw while loading. */
  loadingRows?: number;
  stickyHead?: boolean;
  /** Shown when there are no rows and no `#empty` slot. */
  emptyText?: string;
  ariaLabel?: string;
  /** Extra attributes per row, e.g. `data-test`. */
  rowAttrs?: (row: T) => Record<string, string | undefined>;
  size?: "sm" | "md";
  /** Rows are focusable and emit `row-click` on click or Enter. */
  rowClickable?: boolean;
  /** The key of the row that is open, drawn highlighted. */
  activeKey?: string | null;
}>(), {
  sort: null,
  selected: () => [],
  loadingRows: 3,
  stickyHead: true,
  emptyText: "Nothing here yet.",
  rowAttrs: undefined,
  size: "md",
  activeKey: null,
});

const emit = defineEmits<{
  (e: "update:sort", s: DataSort | null): void;
  (e: "update:selected", keys: string[]): void;
  (e: "row-click", row: T): void;
}>();

const keyOf = (row: T): string =>
  typeof props.rowKey === "function" ? props.rowKey(row) : String((row as Record<string, unknown>)[props.rowKey]);

const cell = (row: T, key: string): unknown => (row as Record<string, unknown>)[key];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const shown = computed<T[]>(() => {
  const s = props.sort;
  if (!s || props.manualSort) return props.rows;
  const col = props.columns.find((c) => c.key === s.key);
  if (!col) return props.rows;
  const val = (r: T): unknown => (col.sortValue ? col.sortValue(r) : cell(r, col.key));
  const sign = s.dir === "asc" ? 1 : -1;
  return [...props.rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    // Blanks sort last whichever way the column goes.
    const xb = x === null || x === undefined || x === "";
    const yb = y === null || y === undefined || y === "";
    if (xb || yb) return xb === yb ? 0 : xb ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return collator.compare(String(x), String(y)) * sign;
  });
});

function ariaSort(c: DataColumn<T>): "ascending" | "descending" | undefined {
  if (!c.sortable || props.sort?.key !== c.key) return undefined;
  return props.sort.dir === "asc" ? "ascending" : "descending";
}

function sortBy(c: DataColumn<T>): void {
  const now = props.sort;
  const dir = now?.key === c.key ? (now.dir === "asc" ? "desc" : "asc") : (c.firstDir ?? "asc");
  emit("update:sort", { key: c.key, dir });
}

const picked = computed(() => new Set(props.selected));
const allKeys = computed(() => shown.value.map(keyOf));
const allPicked = computed(() => allKeys.value.length > 0 && allKeys.value.every((k) => picked.value.has(k)));
const somePicked = computed(() => !allPicked.value && allKeys.value.some((k) => picked.value.has(k)));

function toggleAll(on: boolean): void {
  const keys = new Set(props.selected);
  for (const k of allKeys.value) {
    if (on) keys.add(k);
    else keys.delete(k);
  }
  emit("update:selected", [...keys]);
}

function toggleRow(row: T, on: boolean): void {
  const k = keyOf(row);
  emit("update:selected", on ? [...props.selected.filter((x) => x !== k), k] : props.selected.filter((x) => x !== k));
}

const span = computed(() => props.columns.length + (props.selectable ? 1 : 0));
</script>

<template>
  <div class="wp-table-wrap wp-data-table" :data-size="size">
    <table
      class="wp-table"
      :class="{ 'wp-table--sticky-head': stickyHead }"
      :aria-label="ariaLabel"
      :aria-busy="loading || undefined"
    >
      <colgroup>
        <col v-if="selectable" class="wp-data-table__check-col">
        <col v-for="c in columns" :key="c.key" :style="c.width ? { width: c.width } : undefined">
      </colgroup>
      <thead>
        <tr>
          <th v-if="selectable" class="wp-data-table__check" scope="col">
            <Checkbox
              class="wp-checkbox--inline"
              :model-value="allPicked"
              :indeterminate="somePicked"
              :disabled="loading || allKeys.length === 0"
              aria-label="Select all rows"
              @update:model-value="toggleAll"
            />
          </th>
          <th
            v-for="c in columns"
            :key="c.key"
            scope="col"
            v-bind="c.headAttrs ?? {}"
            :class="c.class"
            :aria-sort="ariaSort(c)"
            :data-align="c.align"
          >
            <button
              v-if="c.sortable"
              type="button"
              class="wp-data-table__sort"
              :data-sorted="sort?.key === c.key ? sort.dir : undefined"
              @click="sortBy(c)"
            >
              <slot :name="`head-${c.key}`" :column="c">{{ c.label }}</slot>
              <i
                class="pi wp-data-table__sort-icon"
                :class="sort?.key === c.key ? (sort.dir === 'asc' ? 'pi-sort-up-fill' : 'pi-sort-down-fill') : 'pi-sort'"
                aria-hidden="true"
              />
            </button>
            <span v-else-if="c.hideLabel" class="wp-data-table__sr">{{ c.label }}</span>
            <slot v-else :name="`head-${c.key}`" :column="c">{{ c.label }}</slot>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading && rows.length === 0">
          <tr v-for="n in loadingRows" :key="`skel-${n}`" class="wp-row-skel" aria-hidden="true">
            <td v-for="i in span" :key="i"><span class="wp-skel-bar" :style="{ width: `${40 + ((n * 17 + i * 23) % 50)}%` }" /></td>
          </tr>
        </template>
        <tr v-else-if="shown.length === 0" class="wp-data-table__empty">
          <td :colspan="span">
            <slot name="empty"><span class="wp-dim">{{ emptyText }}</span></slot>
          </td>
        </tr>
        <template v-else>
          <tr
            v-for="(row, index) in shown"
            :key="keyOf(row)"
            v-bind="rowAttrs ? rowAttrs(row) : {}"
            :aria-selected="selectable ? picked.has(keyOf(row)) : undefined"
            :data-selected="selectable && picked.has(keyOf(row)) ? 'true' : undefined"
            :data-active="activeKey !== null && keyOf(row) === activeKey ? 'true' : undefined"
            :data-clickable="rowClickable || undefined"
            :tabindex="rowClickable ? 0 : undefined"
            @click="rowClickable && emit('row-click', row)"
            @keydown.enter="rowClickable && emit('row-click', row)"
          >
            <td v-if="selectable" class="wp-data-table__check" @click.stop>
              <Checkbox
                class="wp-checkbox--inline"
                :model-value="picked.has(keyOf(row))"
                aria-label="Select row"
                @update:model-value="(on: boolean) => toggleRow(row, on)"
              />
            </td>
            <td
              v-for="c in columns"
              :key="c.key"
              :data-align="c.align"
              :class="[c.class, { 'wp-mono': c.mono }]"
            >
              <slot :name="`cell-${c.key}`" :row="row" :value="cell(row, c.key)" :index="index">{{ cell(row, c.key) ?? "" }}</slot>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.wp-data-table { overflow: auto; }
.wp-data-table th[data-align="right"], .wp-data-table td[data-align="right"] { text-align: right; }
.wp-data-table th[data-align="center"], .wp-data-table td[data-align="center"] { text-align: center; }
.wp-data-table th[data-align="right"] .wp-data-table__sort { flex-direction: row-reverse; }
.wp-data-table[data-size="sm"] :deep(thead th) { padding: 6px 10px; }
.wp-data-table[data-size="sm"] :deep(tbody td) { padding: 6px 10px; }
.wp-data-table__check-col { width: 40px; }
.wp-data-table__check { width: 40px; text-align: center; }
.wp-data-table__sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: -4px -6px;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--wp-radius-sm);
  background: none;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}
.wp-data-table__sort:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-data-table__sort:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.wp-data-table__sort[data-sorted] { color: var(--wp-text); }
.wp-data-table__sort-icon { font-size: 10px; opacity: 0.5; }
.wp-data-table__sort[data-sorted] .wp-data-table__sort-icon { opacity: 1; color: var(--wp-accent-text); }
.wp-data-table tbody tr[data-selected="true"] td { background: var(--wp-row-active, var(--wp-row-hover)); }
.wp-data-table tbody tr[data-clickable] { cursor: pointer; }
.wp-data-table tbody tr[data-clickable]:focus-visible { outline: 2px solid var(--wp-border-focus); outline-offset: -2px; }
.wp-data-table tbody tr[data-active="true"] td { background: color-mix(in oklab, var(--wp-accent-500) 16%, transparent); }
.wp-data-table__empty td { padding: 20px 12px; text-align: center; }
.wp-data-table__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
