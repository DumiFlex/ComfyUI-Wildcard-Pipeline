<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import { useListUrlState } from "../composables/useListUrlState";
import { useBulkActions } from "../composables/useBulkActions";
import { makeBundleStoreAdapter } from "../composables/bulkAdapters";
import ModuleListView from "../components/ModuleListView.vue";
import Button from "../components/ui/Button.vue";
import Select from "../components/ui/Select.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { useBundleStore } from "../stores/bundleStore";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";
import type { BundleRow, CategoryRow } from "../api/types";

const route = useRoute();
const router = useRouter();
const store = useBundleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const bulkAdapter = makeBundleStoreAdapter(store);
const bulk = useBulkActions(bulkAdapter);

const urlState = useListUrlState();

const filter = urlState as {
  q?: string;
  favorites?: boolean;
  category?: string | null;
  tags?: string[];
  sortBy?: string;
};

const categoryById = computed(() => {
  const map = new Map<string, CategoryRow>();
  for (const c of categoryStore.items) map.set(c.id, c);
  return map;
});

const allTags = computed(() => {
  const set = new Set<string>();
  for (const b of store.items) for (const t of b.tags ?? []) set.add(t);
  return Array.from(set).sort();
});

const categoryOptions = computed(() => [
  { value: null, label: "All categories" },
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name, dot: c.color || undefined })),
]);

onMounted(async () => {
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.q = urlState.q;
  store.filter.category = urlState.category;
  store.filter.favorites = urlState.favorites;
  store.filter.sortBy = urlState.sortBy;
  try {
    await store.fetchAll();
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: BundleRow) {
  router.push({
    name: "bundles-edit",
    params: { id: row.id },
    query: { returnTo: encodeURIComponent(route.fullPath) },
  });
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    toast.push({ severity: "info", summary: "ID copied", detail: id, life: 1500 });
  } catch {
    toast.push({ severity: "error", summary: "Copy failed", life: 2000 });
  }
}

async function fav(row: BundleRow) {
  try { await store.toggleFavorite(row.id); }
  catch (e) { toast.push({ severity: "error", summary: "Favorite failed", detail: String(e), life: 4000 }); }
}

async function del(row: BundleRow) {
  try {
    await store.remove(row.id);
    toast.push({ severity: "success", summary: "Deleted", detail: row.name, life: 2000 });
  } catch (e) {
    toast.push({ severity: "error", summary: "Delete failed", detail: String(e), life: 4000 });
  }
}

function toggleTag(t: string, currentTags: string[] | undefined): string[] {
  const cur = currentTags ?? [];
  return cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t];
}

function childCount(row: BundleRow): number {
  return (row.children ?? []).length;
}

interface BundleChildPreview { name: string; type: string; }

/** Read a bundle child's name + kind for the expansion preview. Bundle
 *  children are loose `Record<string, unknown>` server-side (deep-cloned
 *  module snapshots) — the display name lives under `meta.name` (mirrors
 *  the Context-widget instance shape), not on the root, so we narrow
 *  defensively before reading. */
function children(row: BundleRow): BundleChildPreview[] {
  const out: BundleChildPreview[] = [];
  for (const c of row.children ?? []) {
    const meta = (c.meta && typeof c.meta === "object") ? c.meta as Record<string, unknown> : null;
    const metaName = meta && typeof meta.name === "string" ? meta.name : null;
    const rootName = typeof c.name === "string" ? c.name : null;
    out.push({
      name: metaName ?? rootName ?? "(unnamed)",
      type: typeof c.type === "string" ? c.type : "module",
    });
  }
  return out;
}

const KIND_ICON: Record<string, string> = {
  wildcard:     "pi pi-sparkles",
  fixed_values: "pi pi-tag",
  combine:      "pi pi-link",
  derivation:   "pi pi-arrow-right-arrow-left",
  constraint:   "pi pi-filter",
};

/** Resolved frame color — same fallback rule the Context widget uses
 *  for unconfigured bundles. Keeps the swatch visible for default-color
 *  rows. */
function frameColor(row: BundleRow): string {
  return row.color && row.color.length ? row.color : "#46566B";
}
</script>

<template>
  <ModuleListView
    title="Bundles"
    subtitle="Bundles wrap a contiguous range of modules into a reusable, library-tracked group. Children are stored as frozen snapshots — library updates do not propagate to in-flight Contexts."
    new-label="New Bundle"
    new-route="/bundles/new"
    :items="store.items"
    :loading="store.loading"
    :filter="filter"
    :mid-cols="3"
    empty-message="No bundles yet"
    :page="urlState.page"
    :page-size="urlState.pageSize"
    :available-tags="allTags"
    :hide-bulk-set-category="true"
    :hide-bulk-duplicate="true"
    @update:page="(v) => urlState.page = v"
    @update:page-size="(v) => urlState.pageSize = v"
    @fetch="fetch"
    @delete="del"
    @bulk-favorite="bulk.onBulkFavorite"
    @bulk-tag-add="bulk.onBulkTagAdd"
    @bulk-tag-remove="bulk.onBulkTagRemove"
    @bulk-delete="bulk.onBulkDelete"
    @row-open="edit"
    @row-favorite-toggle="fav"
  >
    <template #empty>
      <EmptyState
        icon="pi-box"
        headline="No bundles yet"
        body="Bundles group modules together for reuse. Create your first to package modules into a unit."
        variant="library"
      >
        <template #cta>
          <Button variant="primary" icon="pi-plus" @click="$router.push('/bundles/new')">
            New bundle
          </Button>
        </template>
      </EmptyState>
    </template>

    <template #filter-panel="{ filter, emitFetch }">
      <div class="wp-filters-grid">
        <div class="wp-field">
          <label class="wp-field__label">Category</label>
          <Select
            :model-value="filter.category ?? null"
            :options="categoryOptions"
            placeholder="Any category"
            aria-label="Filter by category"
            @update:model-value="(v) => { filter.category = v as string | null; emitFetch(); }"
          />
        </div>
        <div class="wp-field">
          <label class="wp-field__label">Favorites</label>
          <button
            type="button"
            class="wp-input"
            style="display:flex;align-items:center;gap:8px;justify-content:flex-start;"
            @click="filter.favorites = !filter.favorites; emitFetch()"
          >
            <span class="wp-check" :data-checked="filter.favorites ? 'true' : 'false'" aria-hidden="true">
              <svg v-if="filter.favorites" viewBox="0 0 12 12" fill="none" style="display:block">
                <path d="M3 6.2l2.2 2.2L9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span>Favorites only</span>
          </button>
        </div>
        <div class="wp-field wp-field--full">
          <label class="wp-field__label">
            Tags{{ filter.tags?.length ? ` (${filter.tags.length})` : "" }}
          </label>
          <div v-if="!allTags.length" class="wp-dim wp-tags-empty">No tags in this collection.</div>
          <div v-else class="wp-tags-row">
            <button
              v-for="t in allTags" :key="t"
              type="button"
              class="wp-tag-chip"
              :data-active="(filter.tags ?? []).includes(t) ? 'true' : 'false'"
              @click="filter.tags = toggleTag(t, filter.tags); emitFetch()"
            >
              {{ t }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <template #favorite="{ row }">
      <button
        type="button"
        class="wp-row-fav-btn"
        :data-on="row.is_favorite ? 'true' : 'false'"
        :aria-label="row.is_favorite ? 'Unfavorite' : 'Favorite'"
        @click.stop="fav(row)"
      >
        <i :class="row.is_favorite ? 'pi pi-star-fill' : 'pi pi-star'" />
      </button>
    </template>

    <template #name="{ row }">
      <div class="wp-row-name">
        <span class="wp-row-name__text" @click="edit(row)">{{ row.name }}</span>
        <span
          class="wp-id"
          :title="`Click to copy ${row.id}`"
          @click.stop="copyId(row.id)"
        >{{ row.id }}</span>
      </div>
    </template>

    <template #columns-head>
      <th style="width: 130px">Category</th>
      <th style="width: 56px">Color</th>
      <th style="width: 80px">Modules</th>
    </template>

    <template #columns="{ row }">
      <td>
        <span
          v-if="row.category_id && categoryById.get(row.category_id)"
          class="wp-cat-chip"
          :style="catChipStyle(categoryById.get(row.category_id)!.color)"
        >
          {{ categoryById.get(row.category_id)!.name }}
        </span>
        <span v-else class="wp-dim">—</span>
      </td>
      <td>
        <span
          class="wp-bundle-swatch"
          :style="{ background: frameColor(row) }"
          :title="frameColor(row)"
          aria-hidden="true"
        />
      </td>
      <td><span class="wp-mono">{{ childCount(row) }}</span></td>
    </template>

    <template #actions="{ row }">
      <Button variant="ghost" size="sm" icon="pi-pencil" aria-label="Edit" @click="edit(row)" />
      <Button variant="ghost" size="sm" icon="pi-trash" aria-label="Delete" @click="del(row)" />
    </template>

    <template #expansion="{ row }">
      <div class="wp-row-expand__title">
        Children ({{ childCount(row) }})
        <span v-if="(row.payload_hash ?? '').length" class="wp-dim wp-bundle-hash">
          · frozen at <span class="wp-mono">{{ row.payload_hash.slice(0, 8) }}</span>
        </span>
      </div>
      <div v-if="!childCount(row)" class="wp-dim">Empty bundle.</div>
      <ul v-else class="wp-bundle-children">
        <li
          v-for="(c, i) in children(row)" :key="i"
          class="wp-bundle-child"
        >
          <i :class="KIND_ICON[c.type] ?? 'pi pi-box'" />
          <span class="wp-bundle-child__name">{{ c.name }}</span>
          <span class="wp-dim wp-bundle-child__kind">{{ c.type }}</span>
        </li>
      </ul>
    </template>
  </ModuleListView>
</template>

<style scoped>
.wp-tags-row { display: flex; flex-wrap: wrap; gap: var(--wp-space-3); }
.wp-tags-empty { font-size: var(--wp-text-sm); }
.wp-tag-chip[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}
.wp-bundle-swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: var(--wp-radius-sm);
  border: 1px solid var(--wp-border);
  vertical-align: middle;
}
.wp-children-summary { font-size: var(--wp-text-sm); }
.wp-bundle-hash { margin-left: var(--wp-space-3); font-size: var(--wp-text-xs); }
.wp-bundle-children {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
  max-width: 560px;
}
.wp-bundle-child {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  font-size: var(--wp-text-sm);
}
.wp-bundle-child .pi { font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-bundle-child__name { font-weight: 500; }
.wp-bundle-child__kind { font-size: var(--wp-text-xs); }
</style>
