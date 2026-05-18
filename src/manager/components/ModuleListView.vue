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
import { computed, nextTick, ref, watch, useSlots } from "vue";
import { useRouter } from "vue-router";
import Button from "./ui/Button.vue";
import Checkbox from "./ui/Checkbox.vue";
import Chip from "./ui/Chip.vue";
import Modal from "./ui/Modal.vue";
import Select from "./ui/Select.vue";
import RelativeDate from "./RelativeDate.vue";
import EmptyState from "./ui/EmptyState.vue";

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
  /** Optional extra class on the filter chip — used by Wildcards to
   *  color the Syntax chips so they match the colored pills in the
   *  body's Syntax column. Same `wp-chip--syntax-*` token set keeps
   *  the colors consistent across both surfaces. */
  chipClass?: string;
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
  /** Optional v-model props so parents can lift page/pageSize/extraActive to URL state.
   *  Falls back to local refs when not provided — backward-compatible. */
  page?: number;
  pageSize?: number;
  extraActive?: Record<string, boolean>;
  /** Tag list available in the bulk-tag-add picker. Surfaced from parent so the picker can autocomplete. */
  availableTags?: string[];
  /** Category options for bulk-set-category. Mirror existing per-view Select option shape. */
  categoryOptions?: { value: string | null; label: string; dot?: string }[];
  /** Hide the bulk Set-category action — for kinds without a category field (bundles). */
  hideBulkSetCategory?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  newIcon: "pi pi-plus",
  midCols: 0,
  showFavorite: true,
  showTags: true,
  showUpdated: true,
  availableTags: () => [],
  categoryOptions: () => [],
  hideBulkSetCategory: false,
});

const emit = defineEmits<{
  (e: "fetch"): void;
  (e: "delete", item: T): void;
  (e: "bulk-delete", items: T[]): void;
  (e: "update:page", value: number): void;
  (e: "update:pageSize", value: number): void;
  (e: "update:extraActive", value: Record<string, boolean>): void;
  (e: "bulk-favorite", items: T[], on: boolean): void;
  (e: "bulk-duplicate", items: T[]): void;
  (e: "bulk-tag-add", items: T[], tag: string): void;
  (e: "bulk-tag-remove", items: T[], tag: string): void;
  (e: "bulk-set-category", items: T[], categoryId: string | null): void;
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

// Local fallback refs — used when parent does not supply v-model props.
const localPage = ref(1);
const localPageSize = ref(15);
const localExtraActive = ref<Record<string, boolean>>({});

const page = computed<number>({
  get: () => props.page ?? localPage.value,
  set: (v) => { if (props.page !== undefined) emit("update:page", v); else localPage.value = v; },
});
const pageSize = computed<number>({
  get: () => props.pageSize ?? localPageSize.value,
  set: (v) => { if (props.pageSize !== undefined) emit("update:pageSize", v); else localPageSize.value = v; },
});
const extraActive = computed<Record<string, boolean>>({
  get: () => props.extraActive ?? localExtraActive.value,
  set: (v) => { if (props.extraActive !== undefined) emit("update:extraActive", v); else localExtraActive.value = v; },
});

/** Assign a single extraActive key, building a new object so the computed
 *  setter fires and the parent's URL state update is emitted correctly. */
function setExtraActiveKey(key: string, val: boolean): void {
  extraActive.value = { ...extraActive.value, [key]: val };
}

/** Clear all extraActive flags, emitting the full replacement. */
function clearExtraActive(): void {
  const next: Record<string, boolean> = {};
  for (const k of Object.keys(extraActive.value)) next[k] = false;
  extraActive.value = next;
}

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
  clearExtraActive();
  emit("fetch");
}

function removeTag(t: string) {
  props.filter.tags = (props.filter.tags ?? []).filter((x) => x !== t);
  emit("fetch");
}

/** Toggle a tag in the active filter set from any in-row click —
 *  the body's tag column uses this so users can dial in a tag
 *  filter without opening the filter panel. Adds if missing,
 *  removes if already present. */
function toggleTagFilter(t: string) {
  const current = props.filter.tags ?? [];
  props.filter.tags = current.includes(t)
    ? current.filter((x) => x !== t)
    : [...current, t];
  emit("fetch");
}

function isTagActive(t: string): boolean {
  return (props.filter.tags ?? []).includes(t);
}

function emitFetch() {
  emit("fetch");
}

const tagAddOpen = ref(false);
const tagAddValue = ref("");
const tagAddInputRef = ref<HTMLInputElement | null>(null);

const tagRemoveOpen = ref(false);
const tagRemoveValue = ref("");

const categoryOpen = ref(false);
const categoryValue = ref<string | number | null>(null);

const deleteOpen = ref(false);

watch(tagAddOpen, async (open) => {
  if (open) {
    tagAddValue.value = "";
    await nextTick();
    tagAddInputRef.value?.focus();
  }
});

watch(tagRemoveOpen, (open) => { if (open) tagRemoveValue.value = ""; });
watch(categoryOpen, (open) => { if (open) categoryValue.value = null; });

const selectedItems = computed(() => props.items.filter((i) => selected.value.has(i.id)));

const tagsOnSelection = computed(() => {
  const set = new Set<string>();
  for (const i of selectedItems.value) for (const t of (i.tags ?? [])) set.add(t);
  return [...set].sort();
});

const offPageSelectedCount = computed(() => {
  let n = 0;
  for (const id of selected.value) {
    if (!paged.value.some((r) => r.id === id)) n += 1;
  }
  return n;
});

const canSelectAllMatching = computed(
  () => filteredItems.value.length > paged.value.length &&
        filteredItems.value.some((r) => !selected.value.has(r.id)),
);

function selectAllMatching() {
  const next = new Set(selected.value);
  for (const r of filteredItems.value) next.add(r.id);
  selected.value = next;
}

function submitTagAdd() {
  if (!tagAddValue.value.trim()) return;
  emit("bulk-tag-add", selectedItems.value, tagAddValue.value.trim());
  tagAddOpen.value = false;
}

function submitTagRemove() {
  if (!tagRemoveValue.value) return;
  emit("bulk-tag-remove", selectedItems.value, tagRemoveValue.value);
  tagRemoveOpen.value = false;
}

function submitSetCategory() {
  emit(
    "bulk-set-category",
    selectedItems.value,
    typeof categoryValue.value === "string" ? categoryValue.value : null,
  );
  categoryOpen.value = false;
}

function confirmBulkDelete() {
  emit("bulk-delete", selectedItems.value);
  deleteOpen.value = false;
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
        <Select v-model="sortBy" :options="SORT_OPTIONS" aria-label="Sort" />
      </div>
      <Button
        variant="ghost"
        icon="pi pi-refresh"
        aria-label="Refresh list"
        :disabled="loading"
        :class="{ 'wp-refresh-btn--spin': loading }"
        @click="emitFetch"
      >Refresh</Button>
      <span class="wp-toolbar__count">{{ filteredItems.length }} / {{ items.length }} items</span>
    </div>

    <!-- Filter panel. The outer shell uses the grid-template-rows
         `0fr ↔ 1fr` trick instead of max-height interpolation so the
         transition tracks the panel's natural content height — async
         content arriving during the open animation (categories,
         tags, etc) reflows inside the animation rather than after
         it, killing the "expands in two increments" stutter users
         saw on the kind list views. -->
    <Transition name="filter-collapse">
      <div v-if="filtersOpen" class="wp-filter-panel-shell">
        <div class="wp-filter-panel">
          <slot name="filter-panel" :filter="filter" :emit-fetch="emitFetch" />
          <div v-if="extraFilters?.length" class="wp-filter-panel__extra">
            <span class="wp-filter-panel__extra-label">Syntax</span>
            <div class="wp-filter-panel__extra-chips">
              <button
                v-for="ef in extraFilters" :key="ef.key"
                type="button"
                class="wp-chip wp-chip--toggle"
                :class="ef.chipClass"
                :data-active="extraActive[ef.key] ? '' : null"
                @click="setExtraActiveKey(ef.key, !extraActive[ef.key])"
              >
                {{ ef.label }}
                <span class="wp-dim wp-chip__count">{{ matchCount(ef) }}</span>
              </button>
            </div>
          </div>
          <div v-if="hasActiveFilters" class="wp-filter-panel__footer">
            <Button variant="link" size="sm" @click="clearFilters">Clear filters</Button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Bulk-select bar -->
    <div v-if="selected.size" class="wp-bulk-bar" data-test="bulk-bar">
      <span class="wp-bulk-bar__count">
        <strong>{{ selected.size }}</strong> selected
        <span v-if="offPageSelectedCount > 0" class="wp-dim wp-bulk-bar__hint">
          ({{ paged.filter((r) => selected.has(r.id)).length }} on page, {{ offPageSelectedCount }} elsewhere)
        </span>
      </span>
      <Button
        v-if="canSelectAllMatching"
        variant="link" size="sm"
        data-test="bulk-select-all-matching"
        @click="selectAllMatching"
      >Select all {{ filteredItems.length }} matching</Button>
      <span class="wp-spacer" />
      <Button variant="ghost" size="sm" icon="pi-star" data-test="bulk-favorite-on"
        @click="emit('bulk-favorite', selectedItems, true)">Favorite</Button>
      <Button variant="ghost" size="sm" icon="pi-star-fill" data-test="bulk-favorite-off"
        @click="emit('bulk-favorite', selectedItems, false)">Unfavorite</Button>
      <Button variant="ghost" size="sm" icon="pi-clone" data-test="bulk-duplicate"
        @click="emit('bulk-duplicate', selectedItems)">Duplicate</Button>
      <Button variant="ghost" size="sm" icon="pi-plus" data-test="bulk-tag-add-open"
        @click="tagAddOpen = true">Add tag</Button>
      <Button variant="ghost" size="sm" icon="pi-minus" data-test="bulk-tag-remove-open"
        @click="tagRemoveOpen = true">Remove tag</Button>
      <Button v-if="!hideBulkSetCategory" variant="ghost" size="sm" icon="pi-folder" data-test="bulk-set-category-open"
        @click="categoryOpen = true">Set category</Button>
      <Button variant="ghost" size="sm" data-test="bulk-clear"
        @click="selected = new Set()">Clear</Button>
      <Button variant="danger" size="sm" icon="pi-trash" data-test="bulk-delete-open"
        @click="deleteOpen = true">Delete</Button>
    </div>

    <!-- Tag-add modal -->
    <Modal :open="tagAddOpen" @update:open="tagAddOpen = $event">
      <template #header>
        <h3 class="wp-modal__title">Add tag to {{ selected.size }} items</h3>
      </template>
      <div class="wp-bulk-modal-body">
        <input
          ref="tagAddInputRef"
          v-model="tagAddValue"
          class="wp-input"
          data-test="bulk-tag-input"
          placeholder="Type tag name (or pick existing)"
          @keydown.enter="submitTagAdd"
        />
        <div v-if="availableTags.length" class="wp-bulk-modal-suggestions">
          <button
            v-for="t in availableTags"
            :key="t"
            type="button"
            class="wp-chip wp-chip--toggle"
            @click="tagAddValue = t"
          >{{ t }}</button>
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="tagAddOpen = false">Cancel</Button>
        <Button
          variant="primary"
          :disabled="!tagAddValue.trim()"
          data-test="bulk-tag-submit"
          @click="submitTagAdd"
        >Add</Button>
      </template>
    </Modal>

    <!-- Tag-remove modal -->
    <Modal :open="tagRemoveOpen" @update:open="tagRemoveOpen = $event">
      <template #header>
        <h3 class="wp-modal__title">Remove tag from {{ selected.size }} items</h3>
      </template>
      <div class="wp-bulk-modal-body">
        <div class="wp-bulk-modal-suggestions">
          <button
            v-for="t in tagsOnSelection"
            :key="t"
            type="button"
            class="wp-chip wp-chip--toggle"
            :data-active="tagRemoveValue === t ? '' : null"
            @click="tagRemoveValue = t"
          >{{ t }}</button>
          <span v-if="!tagsOnSelection.length" class="wp-dim">No tags on selected items.</span>
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="tagRemoveOpen = false">Cancel</Button>
        <Button
          variant="primary"
          :disabled="!tagRemoveValue"
          data-test="bulk-tag-remove-submit"
          @click="submitTagRemove"
        >Remove</Button>
      </template>
    </Modal>

    <!-- Set-category modal -->
    <Modal :open="categoryOpen" @update:open="categoryOpen = $event">
      <template #header>
        <h3 class="wp-modal__title">Set category for {{ selected.size }} items</h3>
      </template>
      <div class="wp-bulk-modal-body">
        <Select v-model="categoryValue" :options="categoryOptions" aria-label="Category" />
      </div>
      <template #footer>
        <Button variant="ghost" @click="categoryOpen = false">Cancel</Button>
        <Button
          variant="primary"
          data-test="bulk-set-category-submit"
          @click="submitSetCategory"
        >Apply</Button>
      </template>
    </Modal>

    <!-- Delete confirm -->
    <Modal :open="deleteOpen" @update:open="deleteOpen = $event">
      <template #header>
        <h3 class="wp-modal__title">Delete {{ selected.size }} items?</h3>
      </template>
      <p>This cannot be undone.</p>
      <template #footer>
        <Button variant="ghost" @click="deleteOpen = false">Cancel</Button>
        <Button variant="danger" data-test="bulk-delete-confirm" @click="confirmBulkDelete">Delete</Button>
      </template>
    </Modal>

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
        @remove="setExtraActiveKey(ef.key, false)"
      >
        {{ ef.label }}
      </Chip>
      <Button variant="link" size="sm" @click="clearFilters">Clear all</Button>
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
              <td :data-test="`row-select-${row.id}`" @click.stop="toggleSelect(row)">
                <Checkbox
                  :model-value="isSelected(row)"
                  aria-label="Select row"
                  @update:model-value="() => { /* td click handles toggle */ }"
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
                <slot name="favorite" :row="row" />
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
              <td v-if="showTags" @click.stop>
                <div v-if="(row.tags ?? []).length" class="wp-row-tags">
                  <button
                    v-for="(t, i) in (row.tags ?? []).slice(0, 3)" :key="i"
                    type="button"
                    class="wp-row-tag-btn"
                    :data-active="isTagActive(t) || undefined"
                    :title="isTagActive(t) ? `Remove tag filter '${t}'` : `Filter by tag '${t}'`"
                    @click.stop="toggleTagFilter(t)"
                  >{{ t }}</button>
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
              <slot v-if="!hasActiveFilters" name="empty">
                <EmptyState
                  icon="pi-inbox"
                  :headline="emptyMessage"
                  variant="library"
                >
                  <template #cta>
                    <Button variant="primary" :icon="newIcon" @click="onNew">{{ newLabel }}</Button>
                  </template>
                </EmptyState>
              </slot>
              <EmptyState
                v-else
                icon="pi-search"
                headline="No matches"
                body="Try a different search term or clear the filter."
                variant="no-results"
              >
                <template #cta>
                  <Button variant="link" size="sm" @click="clearFilters">Clear filters</Button>
                </template>
              </EmptyState>
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
        <Button
          variant="ghost" size="sm"
          icon="pi-angle-double-left"
          aria-label="First page"
          :disabled="safePage === 1"
          @click="goToPage(1)"
        />
        <Button
          variant="ghost" size="sm"
          icon="pi-angle-left"
          aria-label="Previous page"
          :disabled="safePage === 1"
          @click="goToPage(safePage - 1)"
        />
        <span class="wp-pager__label">Page {{ safePage }} / {{ totalPages }}</span>
        <Button
          variant="ghost" size="sm"
          icon="pi-angle-right"
          aria-label="Next page"
          :disabled="safePage === totalPages"
          @click="goToPage(safePage + 1)"
        />
        <Button
          variant="ghost" size="sm"
          icon="pi-angle-double-right"
          aria-label="Last page"
          :disabled="safePage === totalPages"
          @click="goToPage(totalPages)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-page-toolbar {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  flex-wrap: wrap;
}
.wp-page-toolbar__search {
  flex: 1;
  min-width: 240px;
  max-width: 440px;
}
.wp-page-toolbar__sort { width: 180px; }
.wp-page-toolbar__filters-label { display: inline-flex; align-items: center; gap: var(--wp-space-2); }
.wp-filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--wp-space-3);
  border-radius: 999px;
  font-size: var(--wp-text-xs);
  background: var(--wp-accent-500);
  color: #fff; /* audit-exempt: white text on saturated accent-500 is theme-agnostic (≥4.5:1 both themes) */
  margin-left: var(--wp-space-2);
}

.wp-filter-panel {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: var(--wp-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
}
.wp-filter-panel__extra-label {
  display: block;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  margin-bottom: var(--wp-space-3);
}
.wp-filter-panel__extra-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-3);
}
.wp-filter-panel__footer {
  display: flex;
  justify-content: flex-end;
}
/* Toggle-able chip used in the extra-filter row. Inherits the global
   `.wp-chip` pill (999 radius, 2/8 padding, 11px font) and overrides the
   active state with the accent tint per prototype `lists.jsx:185-211`. */
.wp-chip--toggle {
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.wp-chip--toggle:hover {
  background: var(--wp-bg-4);
  color: var(--wp-text);
}
.wp-chip--toggle[data-active] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}
.wp-chip__count {
  font-size: var(--wp-text-xs);
  margin-left: 2px;
}

.wp-bulk-bar {
  display: flex;
  align-items: center;
  gap: var(--wp-space-5);
  padding: var(--wp-space-4) var(--wp-space-5);
  background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
  border-radius: var(--wp-radius);
}
.wp-bulk-bar__count { font-size: var(--wp-text-sm); }

.wp-active-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--wp-space-3);
}
.wp-active-filters__label {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
}

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
  padding: var(--wp-space-2);
  color: var(--wp-text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-row-expand-btn:hover { color: var(--wp-text); }
.wp-row-expand-btn .pi { font-size: var(--wp-text-xs); }

.wp-row-fav-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: var(--wp-space-2);
  color: var(--wp-text-dim);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-row-fav-btn[data-on="true"] { color: var(--wp-warn, #fcd34d); }
.wp-row-fav-btn .pi { font-size: var(--wp-text-base); }

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
  gap: var(--wp-space-2);
}
.wp-row-tag-more {
  font-size: 10px; /* audit-exempt: micro "+N more" indicator — below scale floor */
  color: var(--wp-text-dim);
}

/* In-row tag chip button. Visually mirrors the regular Chip component
 * (same padding + radius + font scale) but renders as a button so
 * users can toggle a tag into the active filter set without opening
 * the filter panel. Active state mirrors the chip selection in the
 * filter-panel's tag row. */
.wp-row-tag-btn {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--wp-space-4);
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  background: var(--wp-bg-2);
  color: var(--wp-text);
  font-size: var(--wp-text-xs);
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease, color 0.12s ease;
}
.wp-row-tag-btn:hover {
  border-color: var(--wp-border-strong, var(--wp-border));
  color: var(--wp-text);
}
.wp-row-tag-btn[data-active] {
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 45%, transparent);
  color: var(--wp-accent-text, #c4b5fd);
}

.wp-row-actions {
  display: inline-flex;
  gap: 2px;
  justify-content: flex-end;
}


.wp-page-pager {
  display: flex;
  align-items: center;
  gap: var(--wp-space-5);
  padding: var(--wp-space-4) var(--wp-space-5);
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
}
.wp-pagination__range {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-dim);
  font-variant-numeric: tabular-nums;
}
.wp-pagination__per-page-label {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
}
.wp-pagination__per-page { width: 92px; }

/* Outer shell is a 1-row grid. Animating `grid-template-rows`
 * between `0fr` and `1fr` tweens the rendered height of the inner
 * row to its natural content size — without max-height clipping or
 * post-animation reflow jump.
 *
 * Inner `.wp-filter-panel` carries `min-height: 0` + `overflow:
 * hidden` so it can shrink below intrinsic size during the
 * collapsed phase. Without `min-height: 0` the grid child refuses
 * to go below its content's min content size and the animation
 * snaps to 0 abruptly at the end. */
.wp-filter-panel-shell {
  display: grid;
  grid-template-rows: 1fr;
}
.wp-filter-panel-shell > .wp-filter-panel {
  min-height: 0;
  overflow: hidden;
}
.filter-collapse-enter-active,
.filter-collapse-leave-active {
  transition: grid-template-rows 0.22s ease, opacity 0.18s ease, transform 0.18s ease;
}
.filter-collapse-enter-from,
.filter-collapse-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
  transform: translateY(-6px);
}

.wp-row-favorite > td:first-child {
  border-left: 2px solid var(--wp-warn, #f7b955);
}

.wp-bulk-modal-body {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
  min-width: 320px;
}
.wp-bulk-modal-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-2);
}
.wp-bulk-bar__hint {
  margin-left: var(--wp-space-3);
  font-size: var(--wp-text-xs);
}

</style>
