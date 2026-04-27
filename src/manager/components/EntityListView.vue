<script setup lang="ts" generic="T extends { id: string }">
import { computed, ref, watch } from "vue";
import DataTable from "primevue/datatable";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import Select from "primevue/select";
import { useConfirm } from "primevue/useconfirm";
import ConfirmDialog from "primevue/confirmdialog";

interface Filter {
  q?: string;
  favorites?: boolean;
  category?: string;
  tags?: string[];
  sortBy?: string;
}

interface ExtraFilter {
  key: string;
  label: string;
  check: (item: T) => boolean;
}

const SORT_OPTIONS = [
  { label: "Updated — newest", value: "updated-desc" },
  { label: "Updated — oldest", value: "updated-asc" },
  { label: "Name A → Z", value: "name-asc" },
  { label: "Name Z → A", value: "name-desc" },
];

const PAGE_SIZE_OPTIONS = [
  { label: "10", value: 10 },
  { label: "15", value: 15 },
  { label: "25", value: 25 },
  { label: "50", value: 50 },
];

const props = defineProps<{
  title: string;
  subtitle: string;
  newLabel: string;
  newRoute: string;
  items: T[];
  loading: boolean;
  filter: Filter;
  emptyMessage: string;
  extraFilters?: ExtraFilter[];
}>();

const emit = defineEmits<{
  fetch: [];
  delete: [item: T];
  bulkDelete: [items: T[]];
}>();

const confirm = useConfirm();
const search = ref(props.filter.q ?? "");
const filterPanelOpen = ref(false);
const selected = ref<T[]>([]);
const expandedRows = ref<Record<string, boolean>>({});
const activeExtras = ref<string[]>([]);
const page = ref(1);
const pageSize = ref(15);

// Public asset served by aiohttp at runtime — use dynamic binding so Vite
// does not try to inline/copy the file during the manager SPA build.
const faviconUrl = "/wp/images/favicon.svg";

watch(search, (q) => {
  props.filter.q = q || undefined;
  emit("fetch");
});

const activeFilterCount = computed(() => {
  let n = 0;
  if (props.filter.favorites) n++;
  if (props.filter.category) n++;
  if (props.filter.tags?.length) n += props.filter.tags.length;
  n += activeExtras.value.length;
  return n;
});

const hasActiveFilters = computed(
  () => activeFilterCount.value > 0 || !!props.filter.q,
);

function clearFilters() {
  search.value = "";
  props.filter.q = undefined;
  props.filter.favorites = false;
  props.filter.category = undefined;
  props.filter.tags = [];
  activeExtras.value = [];
  emit("fetch");
}

function removeTag(t: string) {
  props.filter.tags = (props.filter.tags ?? []).filter((x) => x !== t);
  emit("fetch");
}

function removeExtra(key: string) {
  activeExtras.value = activeExtras.value.filter((k) => k !== key);
}

const filteredItems = computed(() => {
  let list = [...props.items] as (T & {
    name?: string;
    updated_at?: string;
    tags?: string[];
  })[];
  // Client-side tags filter (server has no tag query yet).
  if (props.filter.tags?.length) {
    const wanted = new Set(props.filter.tags);
    list = list.filter((m) => (m.tags ?? []).some((t) => wanted.has(t)));
  }
  // Apply extra (kind-specific) filters via passed predicates.
  const extras = props.extraFilters;
  if (activeExtras.value.length && extras?.length) {
    const tests = activeExtras.value
      .map((k) => extras.find((f) => f.key === k))
      .filter((f): f is ExtraFilter => !!f);
    list = list.filter((m) => tests.every((f) => f.check(m as unknown as T)));
  }
  switch (props.filter.sortBy) {
    case "name-asc":
      list.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      break;
    case "name-desc":
      list.sort((a, b) => (b.name ?? "").localeCompare(a.name ?? ""));
      break;
    case "updated-asc":
      list.sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
      break;
    case "updated-desc":
    default:
      list.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
      break;
  }
  return list;
});

// Reset to page 1 whenever any filter input or page size changes.
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

const pagedItems = computed(() =>
  filteredItems.value.slice(pageStart.value, pageStart.value + pageSize.value),
);

const showPagination = computed(
  () => filteredItems.value.length > 0 && filteredItems.value.length > Math.min(...PAGE_SIZE_OPTIONS.map((o) => o.value)),
);

function goToPage(p: number) {
  page.value = Math.min(Math.max(1, p), totalPages.value);
}

function rowClass(row: T): string {
  return (row as T & { is_favorite?: boolean }).is_favorite ? "wp-row-favorite" : "";
}

function confirmBulkDelete() {
  confirm.require({
    message: `Delete ${selected.value.length} selected items?`,
    header: "Confirm bulk delete",
    icon: "pi pi-exclamation-triangle",
    acceptClass: "p-button-danger",
    accept: () => {
      emit("bulkDelete", [...(selected.value as T[])]);
      selected.value = [];
    },
  });
}

defineExpose({
  // Exposed for tests + parent screens that want to drive pagination/filters.
  page,
  pageSize,
  goToPage,
  activeFilterCount,
  filteredItems,
  pagedItems,
  totalPages,
});
</script>

<template>
  <div class="wp-page p-6 text-wp-text">
    <ConfirmDialog />

    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">{{ title }}</h1>
        <p class="wp-page__subtitle">{{ subtitle }}</p>
      </div>
      <div class="wp-page__actions">
        <slot name="toolbar-actions" />
        <Button
          :label="newLabel" icon="pi pi-plus" severity="primary"
          @click="$router.push(newRoute)"
        />
      </div>
    </div>

    <!-- Toolbar -->
    <div class="wp-toolbar">
      <InputGroup class="wp-toolbar__search">
        <InputGroupAddon><i class="pi pi-search" /></InputGroupAddon>
        <InputText v-model="search" placeholder="Search by name, id, tag…" />
      </InputGroup>
      <Button
        :severity="filterPanelOpen ? 'primary' : 'secondary'"
        :outlined="filterPanelOpen"
        text
        size="small"
        aria-label="Filters"
        @click="filterPanelOpen = !filterPanelOpen"
      >
        <span class="flex items-center gap-1">
          <i class="pi pi-filter" />
          <span>Filters</span>
          <span v-if="activeFilterCount > 0" class="wp-filter-count">{{ activeFilterCount }}</span>
        </span>
      </Button>
      <Select
        :model-value="filter.sortBy ?? 'updated-desc'"
        :options="SORT_OPTIONS" option-label="label" option-value="value"
        size="small" class="w-44"
        aria-label="Sort"
        @update:model-value="(v: string) => { filter.sortBy = v; }"
      >
        <template #value="{ value }">
          <span class="text-xs text-wp-text2">
            <i class="pi pi-sort-alt mr-1" />
            {{ SORT_OPTIONS.find((o) => o.value === value)?.label ?? "Sort" }}
          </span>
        </template>
      </Select>
      <span class="wp-toolbar__count">
        {{ filteredItems.length }} / {{ items.length }} items
      </span>
    </div>

    <!-- Filter panel -->
    <div v-if="filterPanelOpen" class="wp-filter-panel">
      <slot
        name="filter-panel"
        :filter="filter"
        :emit-fetch="() => emit('fetch')"
      />
      <div v-if="extraFilters?.length" class="wp-filter-extras">
        <span class="wp-filter-extras__label">Syntax</span>
        <div class="wp-filter-extras__chips">
          <button
            v-for="f in extraFilters" :key="f.key" type="button"
            class="wp-extra-chip"
            :data-active="activeExtras.includes(f.key) ? '' : null"
            @click="activeExtras.includes(f.key)
              ? removeExtra(f.key)
              : (activeExtras = [...activeExtras, f.key])"
          >
            {{ f.label }}
            <span class="wp-extra-chip__count">
              {{ items.filter((x) => f.check(x as unknown as T)).length }}
            </span>
          </button>
        </div>
      </div>
      <div v-if="hasActiveFilters" class="wp-filter-panel__footer">
        <Button label="Clear filters" icon="pi pi-times" text size="small" @click="clearFilters" />
      </div>
    </div>

    <!-- Bulk-select bar (above active-filter chips when present) -->
    <div v-if="selected.length" class="bulk-bar">
      <span class="text-sm">
        <strong class="text-wp-accent">{{ selected.length }}</strong> selected
      </span>
      <div class="flex gap-2">
        <Button label="Clear" text size="small" @click="selected = []" />
        <Button
          label="Delete selected" icon="pi pi-trash" severity="danger" outlined size="small"
          @click="confirmBulkDelete"
        />
      </div>
    </div>

    <!-- Active-filter chips row -->
    <div v-if="hasActiveFilters" class="wp-active-filters">
      <span class="text-xs text-wp-text2">Active:</span>
      <span v-if="filter.q" class="filter-chip filter-chip--search">
        name: {{ filter.q }}
        <button type="button" class="filter-chip__close" aria-label="Clear search" @click="search = ''">
          <i class="pi pi-times" />
        </button>
      </span>
      <span v-if="filter.favorites" class="filter-chip filter-chip--favorite">
        Favorites only
        <button
          type="button" class="filter-chip__close" aria-label="Clear favorites filter"
          @click="filter.favorites = false; emit('fetch')"
        >
          <i class="pi pi-times" />
        </button>
      </span>
      <span v-if="filter.category" class="filter-chip filter-chip--category">
        category: {{ filter.category }}
        <button
          type="button" class="filter-chip__close" aria-label="Clear category filter"
          @click="filter.category = undefined; emit('fetch')"
        >
          <i class="pi pi-times" />
        </button>
      </span>
      <span v-for="t in filter.tags ?? []" :key="t" class="filter-chip filter-chip--tag">
        tag: {{ t }}
        <button
          type="button" class="filter-chip__close"
          :aria-label="`Remove tag ${t}`"
          @click="removeTag(t)"
        >
          <i class="pi pi-times" />
        </button>
      </span>
      <span
        v-for="k in activeExtras" :key="k"
        class="filter-chip filter-chip--extra"
      >
        {{ extraFilters?.find((f) => f.key === k)?.label ?? k }}
        <button
          type="button" class="filter-chip__close"
          :aria-label="`Remove ${k} filter`"
          @click="removeExtra(k)"
        >
          <i class="pi pi-times" />
        </button>
      </span>
      <Button label="Clear all" text size="small" class="ml-1" @click="clearFilters" />
    </div>

    <DataTable
      v-model:selection="selected"
      v-model:expandedRows="expandedRows"
      :value="pagedItems" :loading="loading" data-key="id"
      :row-class="rowClass"
    >
      <slot name="columns" />
      <template v-if="$slots.expansion" #expansion="slotProps">
        <slot name="expansion" v-bind="slotProps" />
      </template>
      <template #empty>
        <div class="wp-empty">
          <template v-if="hasActiveFilters">
            <div class="wp-empty__icon">
              <i class="pi pi-search" />
            </div>
            <p class="text-wp-text font-semibold m-0">No matches</p>
            <p class="text-wp-text2 m-0 mt-1">Try clearing filters, or change the search query.</p>
            <Button label="Clear filters" icon="pi pi-times" text size="small" class="mt-2" @click="clearFilters" />
          </template>
          <template v-else>
            <img :src="faviconUrl" alt="" class="wp-empty__logo" />
            <p class="text-wp-text2 mb-3">{{ emptyMessage }}</p>
            <Button :label="newLabel" icon="pi pi-plus" severity="primary" @click="$router.push(newRoute)" />
          </template>
        </div>
      </template>
    </DataTable>

    <!-- Pagination footer -->
    <div v-if="showPagination" class="wp-pagination">
      <span class="wp-pagination__range">
        {{ pageStart + 1 }}–{{ pageEnd }} of {{ filteredItems.length }}
      </span>
      <div class="wp-spacer" />
      <span class="wp-pagination__per-page-label">Per page</span>
      <Select
        v-model="pageSize"
        :options="PAGE_SIZE_OPTIONS" option-label="label" option-value="value"
        size="small" class="wp-pagination__per-page"
        aria-label="Items per page"
      />
      <div class="wp-pager">
        <Button
          icon="pi pi-angle-double-left" text size="small"
          aria-label="First page"
          :disabled="safePage === 1"
          @click="goToPage(1)"
        />
        <Button
          icon="pi pi-angle-left" text size="small"
          aria-label="Previous page"
          :disabled="safePage === 1"
          @click="goToPage(safePage - 1)"
        />
        <span class="wp-pager__label">Page {{ safePage }} / {{ totalPages }}</span>
        <Button
          icon="pi pi-angle-right" text size="small"
          aria-label="Next page"
          :disabled="safePage === totalPages"
          @click="goToPage(safePage + 1)"
        />
        <Button
          icon="pi pi-angle-double-right" text size="small"
          aria-label="Last page"
          :disabled="safePage === totalPages"
          @click="goToPage(totalPages)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wp-page__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.wp-page__title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wp-page__title {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0;
}
.wp-page__subtitle {
  color: var(--wp-text-muted);
  font-size: 12.5px;
  margin: 0;
  max-width: 720px;
}
.wp-page__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.wp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wp-toolbar__search {
  flex: 1;
  min-width: 240px;
  max-width: 440px;
}
.wp-toolbar__search :deep(.p-inputtext) {
  height: 38px;
}
.wp-toolbar__count {
  font-size: 11.5px;
  color: var(--wp-text-dim);
  margin-left: auto;
}
.wp-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10.5px;
  background: var(--wp-accent);
  color: #fff;
  margin-left: 2px;
}

.wp-filter-panel {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wp-filter-panel__footer {
  display: flex;
  justify-content: flex-end;
}
.wp-filter-extras__label {
  display: block;
  font-size: 11px;
  color: var(--wp-text-muted);
  margin-bottom: 6px;
}
.wp-filter-extras__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wp-extra-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 11px;
  font-size: 11.5px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg2);
  color: var(--wp-text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}
.wp-extra-chip:hover {
  background: var(--wp-bg3);
  color: var(--wp-text);
}
.wp-extra-chip[data-active] {
  background: var(--wp-accent-glow);
  border-color: var(--wp-accent);
  color: var(--wp-accent);
}
.wp-extra-chip__count {
  font-size: 10.5px;
  color: var(--wp-text-dim);
  margin-left: 2px;
}

.wp-active-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 11px;
  font-size: 11px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg2);
}
.filter-chip--search { color: var(--wp-accent); border-color: var(--wp-accent); background: var(--wp-accent-glow); }
.filter-chip--favorite { color: var(--wp-amber); border-color: var(--wp-amber); }
.filter-chip--category { color: var(--wp-violet); border-color: var(--wp-violet); background: var(--wp-violet-bg); }
.filter-chip--tag { color: var(--wp-teal); border-color: var(--wp-teal); background: var(--wp-teal-bg); }
.filter-chip--extra { color: var(--wp-accent); border-color: var(--wp-accent); background: var(--wp-accent-glow); }
.filter-chip__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
  border-radius: 999px;
}
.filter-chip__close:hover { opacity: 1; }
.filter-chip__close:focus-visible {
  outline: 1px solid currentColor;
  outline-offset: 1px;
}
.filter-chip__close .pi { font-size: 10px; }

.bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--wp-accent-glow);
  border: 1px solid var(--wp-accent);
  border-radius: var(--wp-radius);
  padding: 8px 12px;
}

.wp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 32px 16px;
  text-align: center;
}
.wp-empty__icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 999px;
  background: var(--wp-bg3);
  color: var(--wp-text-muted);
  font-size: 18px;
  margin-bottom: 6px;
}
.wp-empty__logo {
  width: 64px;
  height: 64px;
  margin-bottom: 12px;
  opacity: 0.7;
}

.wp-pagination {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
}
.wp-spacer { flex: 1; }
.wp-pagination__range {
  font-size: 12px;
  color: var(--wp-text-dim);
  font-variant-numeric: tabular-nums;
}
.wp-pagination__per-page-label {
  font-size: 11.5px;
  color: var(--wp-text-dim);
}
.wp-pagination__per-page {
  width: 92px;
}
.wp-pager {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: 7px;
  padding: 2px;
}
.wp-pager__label {
  padding: 0 10px;
  font-size: 11.5px;
  color: var(--wp-text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 90px;
  text-align: center;
}

:deep(.wp-row-favorite) {
  border-left: 2px solid var(--wp-amber);
}
</style>
