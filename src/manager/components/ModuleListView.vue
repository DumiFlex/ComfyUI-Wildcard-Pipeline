<script setup lang="ts" generic="T extends { id: string; name?: string; updated_at?: string; tags?: string[]; is_favorite?: boolean }">
/**
 * ModuleListView — faithful 1:1 port of the prototype `ModuleListView` from
 * `docs/design-handoff/wildcardpipeline/project/screens/lists.jsx`.
 *
 * Replaces the previous EntityListView (which wrapped PrimeVue DataTable). This
 * version uses raw `<table>` markup + the `ui/*` primitives so every list
 * screen renders the same way the React prototype does.
 *
 * Per-screen extension points are slots:
 *   - `header-actions`        — extra buttons in the page header
 *   - `filter-panel`          — kind-specific filter controls (category, tags, …)
 *   - `columns-head`          — `<th>` cells (rendered after the built-in
 *     select / expand / favorite / name columns)
 *   - `columns`               — `<td>` cells for each row, mirrors columns-head
 *   - `actions`               — trailing per-row action buttons
 *   - `expansion`             — body of the expanded-row drawer
 */
import { computed, ref, watch, useSlots } from "vue";
import { useRouter } from "vue-router";
import Button from "./ui/Button.vue";
import Checkbox from "./ui/Checkbox.vue";
import Chip from "./ui/Chip.vue";
import Select from "./ui/Select.vue";
import RelativeDate from "./RelativeDate.vue";

interface Filter {
  q?: string;
  favorites?: boolean;
  category?: string | null;
  tags?: string[];
  sortBy?: string;
}

interface ExtraFilter<R> {
  key: string;
  label: string;
  check: (item: R) => boolean;
}

interface Props {
  title: string;
  subtitle: string;
  newLabel: string;
  newRoute: string;
  newIcon?: string;
  items: T[];
  loading?: boolean;
  filter: Filter;
  emptyMessage: string;
  extraFilters?: ExtraFilter<T>[];
  /** Number of caller-provided columns between built-in `name` col and `tags`. */
  midCols?: number;
  /** Whether the column block emits the favorite-star slot column. */
  showFavorite?: boolean;
  /** Whether the column block emits the tags column (default true). */
  showTags?: boolean;
  /** Whether the column block emits the updated-at column (default true). */
  showUpdated?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  newIcon: "pi pi-plus",
  midCols: 0,
  showFavorite: true,
  showTags: true,
  showUpdated: true,
});

const emit = defineEmits<{
  (e: "fetch"): void;
  (e: "delete", item: T): void;
  (e: "bulk-delete", items: T[]): void;
}>();

const slots = useSlots();
const router = useRouter();

const SORT_OPTIONS = [
  { value: "updated-desc", label: "Updated — newest" },
  { value: "updated-asc", label: "Updated — oldest" },
  { value: "name-asc", label: "Name A → Z" },
  { value: "name-desc", label: "Name Z → A" },
];
const PAGE_SIZE_OPTIONS = [
  { value: 10, label: "10" },
  { value: 15, label: "15" },
  { value: 25, label: "25" },
  { value: 50, label: "50" },
];

const filtersOpen = ref(false);
const selected = ref<Set<string>>(new Set());
const expanded = ref<Set<string>>(new Set());
const extraActive = ref<Record<string, boolean>>({});
const page = ref(1);
const pageSize = ref(15);

// Sync `extraActive` keys with current `extraFilters` so we never read from
// removed keys after the parent swaps the array.
watch(
  () => props.extraFilters?.map((f) => f.key) ?? [],
  (keys) => {
    const next: Record<string, boolean> = {};
    for (const k of keys) next[k] = !!extraActive.value[k];
    extraActive.value = next;
  },
  { immediate: true },
);

const activeExtras = computed(() =>
  (props.extraFilters ?? []).filter((f) => extraActive.value[f.key]),
);

const activeFilterCount = computed(() => {
  let n = 0;
  if (props.filter.favorites) n++;
  if (props.filter.category) n++;
  n += props.filter.tags?.length ?? 0;
  n += activeExtras.value.length;
  return n;
});

const hasActiveFilters = computed(
  () => activeFilterCount.value > 0 || !!props.filter.q,
);

const filteredItems = computed(() => {
  let out = [...props.items];

  // Client-side tag filter (server has no tag query yet).
  if (props.filter.tags?.length) {
    const wanted = new Set(props.filter.tags);
    out = out.filter((m) => (m.tags ?? []).some((t) => wanted.has(t)));
  }

  // Extra (kind-specific) filters.
  const extras = activeExtras.value;
  if (extras.length > 0) {
    out = out.filter((m) => extras.every((f) => f.check(m)));
  }

  switch (props.filter.sortBy) {
    case "name-asc":
      out.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      break;
    case "name-desc":
      out.sort((a, b) => (b.name ?? "").localeCompare(a.name ?? ""));
      break;
    case "updated-asc":
      out.sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
      break;
    case "updated-desc":
    default:
      out.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      break;
  }
  return out;
});

// Reset to page 1 whenever any input that drives `filteredItems` changes.
watch(
  () => [
    props.filter.q,
    props.filter.category,
    props.filter.favorites,
    props.filter.tags?.length ?? 0,
    activeExtras.value.length,
    props.filter.sortBy,
    pageSize.value,
  ],
  () => {
    page.value = 1;
  },
);

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredItems.value.length / pageSize.value)),
);
const safePage = computed(() => Math.min(page.value, totalPages.value));
const pageStart = computed(() => (safePage.value - 1) * pageSize.value);
const pageEnd = computed(() =>
  Math.min(pageStart.value + pageSize.value, filteredItems.value.length),
);
const paged = computed(() =>
  filteredItems.value.slice(pageStart.value, pageStart.value + pageSize.value),
);

// Total count of <th> / <td> cells per row — used for empty-row + expansion
// `colspan`. Keep in sync with the table head/body markup below:
//   1 select + 1 expand + 1 favorite (optional) + 1 name + N mid-cols
//   + 1 tags (optional) + 1 updated (optional) + 1 actions.
const totalCols = computed(() => {
  let c = 1 + 1 + 1; // select + expand + name
  if (props.showFavorite) c += 1;
  c += props.midCols;
  if (props.showTags) c += 1;
  if (props.showUpdated) c += 1;
  c += 1; // actions
  return c;
});

const showPagination = computed(
  () =>
    filteredItems.value.length > 0 &&
    filteredItems.value.length >
      Math.min(...PAGE_SIZE_OPTIONS.map((o) => o.value)),
);

const allSelected = computed({
  get(): boolean {
    return paged.value.length > 0 && paged.value.every((r) => selected.value.has(r.id));
  },
  set(v: boolean) {
    const next = new Set(selected.value);
    if (v) for (const r of paged.value) next.add(r.id);
    else for (const r of paged.value) next.delete(r.id);
    selected.value = next;
  },
});

function toggleSelect(row: T) {
  const next = new Set(selected.value);
  if (next.has(row.id)) next.delete(row.id);
  else next.add(row.id);
  selected.value = next;
}

function isSelected(row: T): boolean {
  return selected.value.has(row.id);
}

function toggleExpand(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function isExpanded(id: string): boolean {
  return expanded.value.has(id);
}

function clearFilters() {
  props.filter.q = "";
  props.filter.favorites = false;
  props.filter.category = null;
  props.filter.tags = [];
  for (const k of Object.keys(extraActive.value)) extraActive.value[k] = false;
  emit("fetch");
}

function removeTag(t: string) {
  props.filter.tags = (props.filter.tags ?? []).filter((x) => x !== t);
  emit("fetch");
}

function emitFetch() {
  emit("fetch");
}

function bulkDelete() {
  const items = props.items.filter((i) => selected.value.has(i.id));
  if (items.length === 0) return;
  emit("bulk-delete", items);
  selected.value = new Set();
}

function onNew() {
  router.push(props.newRoute);
}

function matchCount(ef: ExtraFilter<T>): number {
  return props.items.filter((m) => ef.check(m)).length;
}

const sortBy = computed({
  get(): string | number | null {
    return props.filter.sortBy ?? "updated-desc";
  },
  set(v: string | number | null) {
    props.filter.sortBy = (v as string | undefined) ?? undefined;
  },
});

const pageSizeModel = computed({
  get(): string | number | null {
    return pageSize.value;
  },
  set(v: string | number | null) {
    pageSize.value = typeof v === "number" ? v : Number(v ?? 15);
  },
});

function goToPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value);
}

defineExpose({
  page,
  pageSize,
  goToPage,
  filteredItems,
  paged,
  totalPages,
  activeFilterCount,
});
</script>

<template>
  <div class="wp-page wp-page--fill">
    <!-- Header -->
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">{{ title }}</h1>
        <p class="wp-page__subtitle">{{ subtitle }}</p>
      </div>
      <div class="wp-page__actions">
        <slot name="header-actions" />
        <Button variant="primary" :icon="newIcon" @click="onNew">{{ newLabel }}</Button>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="wp-page-toolbar">
      <div class="wp-page-toolbar__search wp-input-group">
        <span class="wp-input-group__addon"><i class="pi pi-search" aria-hidden="true" /></span>
        <input
          class="wp-input"
          placeholder="Search by name, id, tag…"
          :value="filter.q ?? ''"
          aria-label="Search"
          @input="(e) => { filter.q = (e.target as HTMLInputElement).value; emitFetch(); }"
        />
      </div>
      <Button
        :variant="filtersOpen ? 'outline' : 'secondary'"
        :icon="filtersOpen ? 'pi pi-filter-fill' : 'pi pi-filter'"
        aria-label="Filters"
        @click="filtersOpen = !filtersOpen"
      >
        <span class="wp-page-toolbar__filters-label">
          Filters<span v-if="activeFilterCount" class="wp-filter-count">{{ activeFilterCount }}</span>
        </span>
      </Button>
      <div class="wp-page-toolbar__sort">
        <Select v-model="sortBy" :options="SORT_OPTIONS" aria-label="Sort" size="sm" />
      </div>
      <span class="wp-toolbar__count">{{ filteredItems.length }} / {{ items.length }} items</span>
    </div>

    <!-- Filter panel -->
    <Transition name="filter-collapse">
      <div v-if="filtersOpen" class="wp-filter-panel">
        <slot name="filter-panel" :filter="filter" :emit-fetch="emitFetch" />
        <div v-if="extraFilters?.length" class="wp-filter-panel__extra">
          <span class="wp-filter-panel__extra-label">Syntax</span>
          <div class="wp-filter-panel__extra-chips">
            <button
              v-for="ef in extraFilters" :key="ef.key"
              type="button"
              class="wp-filter-toggle"
              :data-active="extraActive[ef.key] ? 'true' : 'false'"
              @click="extraActive[ef.key] = !extraActive[ef.key]"
            >
              {{ ef.label }}
              <span class="wp-filter-toggle__count">{{ matchCount(ef) }}</span>
            </button>
          </div>
        </div>
        <div v-if="hasActiveFilters" class="wp-filter-panel__footer">
          <button type="button" class="wp-link" @click="clearFilters">Clear filters</button>
        </div>
      </div>
    </Transition>

    <!-- Bulk-select bar -->
    <div v-if="selected.size" class="wp-bulk-bar">
      <span class="wp-bulk-bar__count">
        <strong>{{ selected.size }}</strong> selected
      </span>
      <span class="wp-spacer" />
      <Button variant="ghost" size="sm" @click="selected = new Set()">Clear</Button>
      <Button variant="danger" size="sm" icon="pi pi-trash" @click="bulkDelete">Delete</Button>
    </div>

    <!-- Active-filter chips row -->
    <div v-if="hasActiveFilters" class="wp-active-filters">
      <span class="wp-active-filters__label">Active:</span>
      <Chip
        v-if="filter.q"
        tone="accent"
        removable
        @remove="() => { filter.q = ''; emitFetch(); }"
      >
        Search: {{ filter.q }}
      </Chip>
      <Chip
        v-if="filter.favorites"
        tone="warn"
        removable
        @remove="() => { filter.favorites = false; emitFetch(); }"
      >
        Favorites only
      </Chip>
      <Chip
        v-if="filter.category"
        tone="info"
        removable
        @remove="() => { filter.category = null; emitFetch(); }"
      >
        Category: {{ filter.category }}
      </Chip>
      <Chip
        v-for="t in filter.tags ?? []" :key="t"
        tone="success"
        removable
        @remove="removeTag(t)"
      >
        {{ t }}
      </Chip>
      <Chip
        v-for="ef in activeExtras" :key="ef.key"
        tone="accent"
        removable
        @remove="extraActive[ef.key] = false"
      >
        {{ ef.label }}
      </Chip>
      <button type="button" class="wp-link" @click="clearFilters">Clear all</button>
    </div>

    <!-- Table -->
    <div class="wp-table-wrap wp-table-wrap--scroll">
      <table class="wp-table wp-table--sticky-head">
        <thead>
          <tr>
            <th class="wp-table__select"><Checkbox v-model="allSelected" aria-label="Select all" /></th>
            <th class="wp-table__expand-col" />
            <th v-if="showFavorite" class="wp-table__fav-col" />
            <th class="wp-sortable">Name</th>
            <slot name="columns-head" />
            <th v-if="showTags">Tags</th>
            <th v-if="showUpdated" class="wp-sortable wp-table__updated-col">Updated</th>
            <th class="wp-table__actions-col" style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in paged" :key="row.id">
            <tr
              :data-expanded="isExpanded(row.id) ? 'true' : 'false'"
              :class="{ 'wp-table__row--selected': isSelected(row), 'wp-row-favorite': row.is_favorite }"
            >
              <td @click.stop>
                <Checkbox
                  :model-value="isSelected(row)"
                  aria-label="Select row"
                  @update:model-value="() => toggleSelect(row)"
                />
              </td>
              <td>
                <button
                  type="button"
                  class="wp-row-expand-btn"
                  :aria-expanded="isExpanded(row.id)"
                  aria-label="Toggle row"
                  @click="toggleExpand(row.id)"
                >
                  <i :class="isExpanded(row.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" />
                </button>
              </td>
              <td v-if="showFavorite">
                <slot name="favorite" :row="row">
                  <button
                    type="button"
                    class="wp-row-fav-btn"
                    :data-on="row.is_favorite ? 'true' : 'false'"
                    aria-label="Toggle favorite"
                    @click.stop="$emit && $emit"
                  >
                    <i :class="row.is_favorite ? 'pi pi-star-fill' : 'pi pi-star'" />
                  </button>
                </slot>
              </td>
              <td>
                <slot name="name" :row="row">
                  <div class="wp-row-name">
                    <span class="wp-row-name__text">{{ row.name }}</span>
                    <span class="wp-id">{{ row.id }}</span>
                  </div>
                </slot>
              </td>
              <slot name="columns" :row="row" />
              <td v-if="showTags">
                <div v-if="(row.tags ?? []).length" class="wp-row-tags">
                  <span v-for="(t, i) in (row.tags ?? []).slice(0, 3)" :key="i" class="wp-row-tag">{{ t }}</span>
                  <span v-if="(row.tags ?? []).length > 3" class="wp-row-tag-more">+{{ (row.tags ?? []).length - 3 }}</span>
                </div>
                <span v-else class="wp-dim">—</span>
              </td>
              <td v-if="showUpdated">
                <RelativeDate :value="row.updated_at" />
              </td>
              <td class="wp-table__actions-col" style="text-align:right" @click.stop>
                <div class="wp-row-actions">
                  <slot name="actions" :row="row" />
                </div>
              </td>
            </tr>
            <tr v-if="isExpanded(row.id) && slots.expansion" class="wp-row-expand-row">
              <td :colspan="totalCols" style="padding:0">
                <div class="wp-row-expand">
                  <slot name="expansion" :row="row" />
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!paged.length">
            <td :colspan="totalCols">
              <div v-if="!hasActiveFilters" class="wp-empty">
                <div class="wp-empty__icon"><i class="pi pi-inbox" /></div>
                <p class="wp-empty__msg">{{ emptyMessage }}</p>
                <Button variant="primary" :icon="newIcon" @click="onNew">{{ newLabel }}</Button>
              </div>
              <div v-else class="wp-empty wp-empty--no-match">
                <div class="wp-empty__icon"><i class="pi pi-search" /></div>
                <p class="wp-empty__msg">No matches.</p>
                <button type="button" class="wp-link" @click="clearFilters">Clear filters</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="showPagination" class="wp-page-pager wp-pagination">
      <span class="wp-pagination__range">
        {{ pageStart + 1 }}–{{ pageEnd }} of {{ filteredItems.length }}
      </span>
      <span class="wp-spacer" />
      <span class="wp-pagination__per-page-label">Per page</span>
      <div class="wp-pagination__per-page">
        <Select v-model="pageSizeModel" :options="PAGE_SIZE_OPTIONS" aria-label="Items per page" size="sm" />
      </div>
      <div class="wp-pager">
        <button
          type="button" class="wp-icon-btn"
          aria-label="First page"
          :disabled="safePage === 1"
          @click="goToPage(1)"
        ><i class="pi pi-angle-double-left" /></button>
        <button
          type="button" class="wp-icon-btn"
          aria-label="Previous page"
          :disabled="safePage === 1"
          @click="goToPage(safePage - 1)"
        ><i class="pi pi-angle-left" /></button>
        <span class="wp-pager__label">Page {{ safePage }} / {{ totalPages }}</span>
        <button
          type="button" class="wp-icon-btn"
          aria-label="Next page"
          :disabled="safePage === totalPages"
          @click="goToPage(safePage + 1)"
        ><i class="pi pi-angle-right" /></button>
        <button
          type="button" class="wp-icon-btn"
          aria-label="Last page"
          :disabled="safePage === totalPages"
          @click="goToPage(totalPages)"
        ><i class="pi pi-angle-double-right" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-page-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wp-page-toolbar__search {
  flex: 1;
  min-width: 240px;
  max-width: 440px;
}
.wp-page-toolbar__sort { width: 180px; }
.wp-page-toolbar__filters-label { display: inline-flex; align-items: center; gap: 4px; }
.wp-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10.5px;
  background: var(--wp-accent-500);
  color: #fff;
  margin-left: 4px;
}

.wp-filter-panel {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wp-filter-panel__extra-label {
  display: block;
  font-size: 11px;
  color: var(--wp-text-muted);
  margin-bottom: 6px;
}
.wp-filter-panel__extra-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wp-filter-panel__footer {
  display: flex;
  justify-content: flex-end;
}
.wp-filter-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 11px;
  font-size: 11.5px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2);
  color: var(--wp-text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}
.wp-filter-toggle:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wp-filter-toggle[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}
.wp-filter-toggle__count {
  font-size: 10.5px;
  color: var(--wp-text-dim);
  margin-left: 2px;
}

.wp-bulk-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
  border-radius: var(--wp-radius);
}
.wp-bulk-bar__count { font-size: 12.5px; }

.wp-active-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.wp-active-filters__label {
  font-size: 11.5px;
  color: var(--wp-text-dim);
}

.wp-link {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 11.5px;
  color: var(--wp-accent-text);
  cursor: pointer;
  text-decoration: underline;
}
.wp-link:hover { color: var(--wp-accent-text-strong); }

.wp-table__select { width: 32px; padding-right: 0; }
.wp-table__expand-col { width: 28px; padding: 0; }
.wp-table__fav-col { width: 28px; padding: 0; }
.wp-table__updated-col { width: 100px; }
.wp-table__actions-col { width: 130px; }
.wp-table__row--selected > td { background: color-mix(in oklab, var(--wp-accent-500) 8%, transparent) !important; }

.wp-row-expand-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--wp-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-row-expand-btn:hover { color: var(--wp-text); }
.wp-row-expand-btn .pi { font-size: 11px; }

.wp-row-fav-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--wp-text-dim);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-row-fav-btn[data-on="true"] { color: var(--wp-warn, #fcd34d); }
.wp-row-fav-btn .pi { font-size: 13px; }

.wp-row-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-row-name__text {
  font-weight: 500;
}
.wp-row-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.wp-row-tag {
  font-size: 10px;
  padding: 1px 6px;
  background: var(--wp-bg-3);
  color: var(--wp-text2, var(--wp-text-muted));
  border-radius: 3px;
}
.wp-row-tag-more {
  font-size: 10px;
  color: var(--wp-text-dim);
}

.wp-row-actions {
  display: inline-flex;
  gap: 2px;
  justify-content: flex-end;
}

.wp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 16px;
  text-align: center;
}
.wp-empty__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  font-size: 18px;
  margin-bottom: 6px;
}
.wp-empty__msg { color: var(--wp-text-muted); margin: 0 0 6px; }

.wp-page-pager {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
}
.wp-pagination__range {
  font-size: 12px;
  color: var(--wp-text-dim);
  font-variant-numeric: tabular-nums;
}
.wp-pagination__per-page-label {
  font-size: 11.5px;
  color: var(--wp-text-dim);
}
.wp-pagination__per-page { width: 92px; }

.wp-icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--wp-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-icon-btn:hover:not(:disabled) {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wp-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.filter-collapse-enter-active,
.filter-collapse-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.filter-collapse-enter-from,
.filter-collapse-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.wp-row-favorite > td:first-child {
  border-left: 2px solid var(--wp-warn, #f7b955);
}
</style>
