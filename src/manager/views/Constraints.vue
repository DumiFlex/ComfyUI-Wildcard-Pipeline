<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import { useListUrlState } from "../composables/useListUrlState";
import { useLoadError } from "../composables/useLoadError";
import { useBulkActions } from "../composables/useBulkActions";
import { makeModuleStoreAdapter } from "../composables/bulkAdapters";
import ModuleListView from "../components/ModuleListView.vue";
import ValidityIcon from "../components/ValidityIcon.vue";
import Button from "../components/ui/Button.vue";
import Select from "../components/ui/Select.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { useModuleStore } from "../stores/moduleStore";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";
import { validateModule } from "../utils/validateModule";
import type {
  CategoryRow,
  ConstraintCell,
  ConstraintMatrix,
  ConstraintPayload,
  ModuleRow,
} from "../api/types";

const route = useRoute();
const router = useRouter();
const store = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const bulkAdapter = makeModuleStoreAdapter(store);
const bulk = useBulkActions(bulkAdapter);
const loadErr = useLoadError();

const urlState = useListUrlState(undefined, "constraints");

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

// Module-by-id lookup. Reads from `catalog` (all kinds) rather than `items`
// (constraint-only after the type filter) so source/target wildcard IDs
// resolve to their names — otherwise the column shows raw 8-hex UUIDs
// because the active list page only loaded constraint rows into items.
const moduleNameById = computed(() => {
  const map = new Map<string, ModuleRow>();
  for (const m of store.catalog) map.set(m.id, m);
  return map;
});

const allTags = computed(() => {
  const set = new Set<string>();
  for (const m of store.items) for (const t of m.tags ?? []) set.add(t);
  return Array.from(set).sort();
});

const categoryOptions = computed(() => [
  { value: null, label: "All categories" },
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name, dot: c.color || undefined })),
]);

/** Bulk-set-category modal options — uses "(none)" for the null choice
 *  since the user is explicitly setting category (not filtering). */
const bulkCategoryOptions = computed(() => [
  { value: null, label: "(none)" },
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name, dot: c.color || undefined })),
]);

onMounted(async () => {
  store.filter.type = "constraint";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "constraint";
  store.filter.q = urlState.q;
  store.filter.category = urlState.category;
  store.filter.favorites = urlState.favorites;
  store.filter.sortBy = urlState.sortBy;
  try {
    await loadErr.run(() => store.fetchAll());
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: ModuleRow) {
  router.push({
    name: "constraints-edit",
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

async function dup(row: ModuleRow) {
  try {
    await store.duplicate(row.id);
    toast.push({ severity: "success", summary: "Duplicated", detail: row.name, life: 2000 });
  } catch (e) {
    toast.push({ severity: "error", summary: "Duplicate failed", detail: String(e), life: 4000 });
  }
}

async function fav(row: ModuleRow) {
  try { await store.toggleFavorite(row.id); }
  catch (e) { toast.push({ severity: "error", summary: "Favorite failed", detail: String(e), life: 4000 }); }
}

async function del(row: ModuleRow) {
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

function payloadOf(row: ModuleRow): ConstraintPayload {
  const p = row.payload as Partial<ConstraintPayload> & {
    matrix?: ConstraintMatrix | unknown[];
  };
  const matrix: ConstraintMatrix =
    p.matrix && !Array.isArray(p.matrix) ? (p.matrix as ConstraintMatrix) : {};
  return {
    source_wildcard_id: p.source_wildcard_id ?? null,
    target_wildcard_id: p.target_wildcard_id ?? null,
    matrix,
    exceptions: p.exceptions ?? [],
  };
}

function lookupName(id: string | null): string {
  if (!id) return "—";
  return moduleNameById.value.get(id)?.name ?? id;
}

function exceptionCount(row: ModuleRow): number { return payloadOf(row).exceptions.length; }

interface MatrixSample { source: string; target: string; mode: string; factor: number; }

function matrixSamples(row: ModuleRow, max = 5): MatrixSample[] {
  const p = payloadOf(row);
  const out: MatrixSample[] = [];
  for (const [sourceVal, byTarget] of Object.entries(p.matrix)) {
    if (out.length >= max) break;
    if (!byTarget || typeof byTarget !== "object") continue;
    for (const [targetSub, cellRaw] of Object.entries(byTarget)) {
      if (out.length >= max) break;
      const cell = cellRaw as Partial<ConstraintCell>;
      const mode = cell?.mode ?? "allow";
      const factor =
        typeof cell?.factor === "number"
          ? cell.factor
          : mode === "boost"
            ? 2
            : mode === "reduce"
              ? 0.5
              : 1;
      if (mode === "allow") continue;
      out.push({ source: sourceVal, target: targetSub, mode, factor });
    }
  }
  return out;
}

function formatFactor(f: number): string {
  if (!Number.isFinite(f)) return "1";
  if (f >= 10) return f.toFixed(0);
  return f.toFixed(2).replace(/\.?0+$/, "");
}
</script>

<template>
  <ModuleListView
    title="Constraints"
    subtitle="Constraints set rules between two wildcards' sub-categories — exclude, boost, or reduce specific combinations, with per-pair exceptions."
    new-label="New Constraint"
    new-route="/constraints/new"
    :items="store.items"
    :loading="store.loading"
    :load-error="loadErr.error.value"
    :filter="filter"
    :mid-cols="4"
    empty-message="No constraints yet"
    :page="urlState.page"
    :page-size="urlState.pageSize"
    :available-tags="allTags"
    :category-options="bulkCategoryOptions"
    @update:page="(v) => urlState.page = v"
    @update:page-size="(v) => urlState.pageSize = v"
    @fetch="fetch"
    @delete="del"
    @bulk-favorite="bulk.onBulkFavorite"
    @bulk-duplicate="bulk.onBulkDuplicate"
    @bulk-tag-add="bulk.onBulkTagAdd"
    @bulk-tag-remove="bulk.onBulkTagRemove"
    @bulk-set-category="bulk.onBulkSetCategory"
    @bulk-delete="bulk.onBulkDelete"
    @row-open="edit"
    @row-favorite-toggle="fav"
  >
    <template #empty>
      <EmptyState
        icon="pi-filter"
        headline="No constraints yet"
        body="Constraints limit which combinations of values can co-occur. Create one to prune combinations."
        variant="library"
      >
        <template #cta>
          <Button variant="primary" icon="pi-plus" @click="$router.push('/constraints/new')">
            New constraint
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
      <th style="width: 130px">Source</th>
      <th style="width: 130px">Target</th>
      <th style="width: 90px">Exceptions</th>
      <th style="width: 80px">Valid</th>
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
      <td><span class="wp-cn-name">{{ lookupName(payloadOf(row).source_wildcard_id) }}</span></td>
      <td><span class="wp-cn-name">{{ lookupName(payloadOf(row).target_wildcard_id) }}</span></td>
      <td><span class="wp-mono">{{ exceptionCount(row) }}</span></td>
      <td><ValidityIcon :issues="validateModule(row, store.catalog)" /></td>
    </template>

    <template #actions="{ row }">
      <Button variant="ghost" size="sm" icon="pi-pencil" aria-label="Edit" @click="edit(row)" />
      <Button variant="ghost" size="sm" icon="pi-clone" aria-label="Duplicate" @click="dup(row)" />
      <Button variant="ghost" size="sm" icon="pi-trash" aria-label="Delete" @click="del(row)" />
    </template>

    <template #expansion="{ row }">
      <div class="wp-row-expand__title">
        Sample matrix entries for <span class="wp-row-expand__name">{{ (row.name ?? '').toUpperCase() }}</span>
      </div>
      <div v-if="!matrixSamples(row).length" class="wp-dim">No non-default matrix cells defined.</div>
      <ul v-else class="wp-matrix-list">
        <li
          v-for="(s, i) in matrixSamples(row)" :key="i"
          class="wp-matrix-item"
        >
          <span class="wp-cn-name">{{ s.source }}</span>
          <span class="wp-dim wp-matrix-arrow">→</span>
          <span class="wp-cn-name">{{ s.target }}</span>
          <span class="wp-dim wp-matrix-sep">:</span>
          <span class="wp-token-key">{{ s.mode }}</span>
          <span v-if="s.mode === 'boost' || s.mode === 'reduce'" class="wp-dim">
            ×{{ formatFactor(s.factor) }}
          </span>
        </li>
      </ul>
      <div v-if="exceptionCount(row)" class="wp-dim wp-matrix-meta">
        {{ exceptionCount(row) }} per-pair exception{{ exceptionCount(row) === 1 ? "" : "s" }}
      </div>
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

.wp-cn-name { font-size: var(--wp-text-sm); color: var(--wp-text); }
.wp-matrix-list {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.wp-matrix-item { font-family: var(--wp-font-mono); font-size: var(--wp-text-xs); }
.wp-matrix-arrow, .wp-matrix-sep { margin: 0 var(--wp-space-3); }
.wp-matrix-meta { margin-top: var(--wp-space-4); font-size: var(--wp-text-xs); }
</style>
