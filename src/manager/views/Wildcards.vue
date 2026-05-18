<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import { useListUrlState } from "../composables/useListUrlState";
import { useBulkActions } from "../composables/useBulkActions";
import { makeModuleStoreAdapter } from "../composables/bulkAdapters";
import ModuleListView from "../components/ModuleListView.vue";
import RichTextPreview from "../components/RichTextPreview.vue";
import Button from "../components/ui/Button.vue";
import Select from "../components/ui/Select.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { useModuleStore } from "../stores/moduleStore";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";
import type { ModuleRow, CategoryRow } from "../api/types";
import {
  buildWildcardGraph,
  getWildcardSyntax,
} from "../utils/wildcardSyntax";

const route = useRoute();
const router = useRouter();
const store = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const bulkAdapter = makeModuleStoreAdapter(store);
const bulk = useBulkActions(bulkAdapter);

const urlState = useListUrlState<{ filters: string[] }>({
  filters: { type: "csv", default: [] },
});

/** Writable proxy so ModuleListView (and its filter-panel slot) can mutate
 *  filter fields in place — mutations flow to urlState automatically. */
const filter = urlState as {
  q?: string;
  favorites?: boolean;
  category?: string | null;
  tags?: string[];
  sortBy?: string;
};

const extraActiveFromUrl = computed<Record<string, boolean>>({
  get: () => {
    const out: Record<string, boolean> = {};
    for (const k of urlState.filters) out[k] = true;
    return out;
  },
  set: (val: Record<string, boolean>) => {
    urlState.filters = Object.entries(val)
      .filter(([, v]) => v)
      .map(([k]) => k);
  },
});

const categoryById = computed(() => {
  const map = new Map<string, CategoryRow>();
  for (const c of categoryStore.items) map.set(c.id, c);
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

// Reactive ref-graph computed off the store. Rebuilds on every change since
// `getWildcardSyntax` is cheap (linear over tokens) and graphs are small.
const wildcardGraph = computed(() => buildWildcardGraph(store.items));

interface SyntaxView {
  hasInline: boolean;
  outgoing: string[];
  incoming: string[];
}

function syntaxView(row: ModuleRow): SyntaxView {
  // `buildWildcardGraph` keys outgoing/incoming by `mod.id`, which IS
  // the canonical 8-hex uuid post DB migration 004 — no extraction
  // step needed.
  const sx = getWildcardSyntax(row);
  const out = wildcardGraph.value.outgoing.get(row.id);
  const inc = wildcardGraph.value.incoming.get(row.id);
  return {
    hasInline: sx.hasInline,
    outgoing: out ? [...out] : [],
    incoming: inc ? [...inc] : [],
  };
}

const extraFilters = computed(() => [
  {
    key: "has-refs",
    label: "Uses nested refs",
    chipClass: "wp-chip--syntax-ref",
    check: (m: ModuleRow) => getWildcardSyntax(m).hasRefs,
  },
  {
    key: "has-inline",
    label: "Has inline {a|b|c}",
    chipClass: "wp-chip--syntax-dp",
    check: (m: ModuleRow) => getWildcardSyntax(m).hasInline,
  },
  {
    key: "is-referenced",
    label: "Referenced by others",
    chipClass: "wp-chip--syntax-in",
    check: (m: ModuleRow) => {
      // Graph keyed by `mod.id` (= 8-hex uuid). See syntaxView.
      const inc = wildcardGraph.value.incoming.get(m.id);
      return !!inc && inc.size > 0;
    },
  },
]);

onMounted(async () => {
  store.filter.type = "wildcard";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "wildcard";
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

function edit(row: ModuleRow) {
  router.push({
    name: "wildcards-edit",
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

interface WildcardOption { id: string; value: string; weight: number; }

function options(row: ModuleRow): WildcardOption[] {
  return ((row.payload as { options?: WildcardOption[] }).options ?? []);
}
function optionCount(row: ModuleRow): number { return options(row).length; }
function topOptions(row: ModuleRow): WildcardOption[] {
  return [...options(row)].sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1)).slice(0, 4);
}

function totalWeight(row: ModuleRow): number {
  return options(row).reduce((a, b) => a + (b.weight ?? 1), 0) || 1;
}

function isValid(row: ModuleRow): boolean {
  return options(row).every((o) => !!o.value);
}
</script>

<template>
  <ModuleListView
    title="Wildcards"
    subtitle="Wildcard modules pick one weighted option per resolution. Use $variable in prompts."
    new-label="New Wildcard"
    new-route="/wildcards/new"
    :items="store.items"
    :loading="store.loading"
    :filter="filter"
    :extra-filters="extraFilters"
    :mid-cols="4"
    empty-message="No wildcards yet"
    :page="urlState.page"
    :page-size="urlState.pageSize"
    :extra-active="extraActiveFromUrl"
    :available-tags="allTags"
    :category-options="bulkCategoryOptions"
    @update:page="(v) => urlState.page = v"
    @update:page-size="(v) => urlState.pageSize = v"
    @update:extra-active="(v) => extraActiveFromUrl = v"
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
        icon="pi-sparkles"
        headline="No wildcards yet"
        body="Wildcards let you sample one option from a pool. Create your first to start composing prompts."
        variant="library"
      >
        <template #cta>
          <Button variant="primary" icon="pi-plus" @click="$router.push('/wildcards/new')">
            New wildcard
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
      <th style="width: 60px">Items</th>
      <th style="width: 84px">Syntax</th>
      <th style="width: 60px">Valid</th>
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
      <td><span class="wp-mono">{{ optionCount(row) }}</span></td>
      <td>
        <template v-for="v in [syntaxView(row)]" :key="row.id">
          <div
            v-if="v.outgoing.length || v.incoming.length || v.hasInline"
            class="wp-syntax-cell"
          >
            <span
              v-if="v.outgoing.length"
              class="wp-syntax-pill wp-syntax-pill--ref"
              :title="`Nests ${v.outgoing.length} other wildcard${v.outgoing.length === 1 ? '' : 's'}`"
            >
              <i class="pi pi-arrow-right" /> {{ v.outgoing.length }}
            </span>
            <span
              v-if="v.incoming.length"
              class="wp-syntax-pill wp-syntax-pill--in"
              :title="`Referenced by ${v.incoming.length} wildcard${v.incoming.length === 1 ? '' : 's'}`"
            >
              <i class="pi pi-arrow-left" /> {{ v.incoming.length }}
            </span>
            <span
              v-if="v.hasInline"
              class="wp-syntax-pill wp-syntax-pill--dp"
              title="Contains inline {a|b|c} alternatives"
            >{{ "{ }" }}</span>
          </div>
          <span v-else class="wp-dim">—</span>
        </template>
      </td>
      <td>
        <i
          v-if="isValid(row)"
          class="pi pi-check-circle wp-icon--success"
          title="Valid"
        />
        <i
          v-else
          class="pi pi-exclamation-triangle wp-icon--warn"
          title="Empty option present"
        />
      </td>
    </template>

    <template #actions="{ row }">
      <Button variant="ghost" size="sm" icon="pi-pencil" aria-label="Edit" @click="edit(row)" />
      <Button variant="ghost" size="sm" icon="pi-clone" aria-label="Duplicate" @click="dup(row)" />
      <Button variant="ghost" size="sm" icon="pi-trash" aria-label="Delete" @click="del(row)" />
    </template>

    <template #expansion="{ row }">
      <div class="wp-row-expand__title">
        Top options for <span class="wp-row-expand__name">{{ (row.name ?? '').toUpperCase() }}</span>
      </div>
      <div v-if="!options(row).length" class="wp-dim">No options defined.</div>
      <div v-else class="wp-opts-grid">
        <template v-for="(opt, i) in topOptions(row)" :key="i">
          <span class="wp-mono wp-dim">{{ opt.weight ?? 1 }}×</span>
          <span class="wp-mono wp-opts-grid__val">
            <RichTextPreview
              v-if="opt.value"
              :value="opt.value"
              :uuid-to-name="wildcardGraph.uuidToName"
            />
            <span v-else class="wp-dim">(empty)</span>
          </span>
          <div class="wp-opts-grid__bar">
            <div
              class="wp-opts-grid__bar-fill"
              :style="{ width: `${((opt.weight ?? 1) / totalWeight(row)) * 100}%` }"
            />
          </div>
        </template>
      </div>
      <div v-if="optionCount(row) > 4" class="wp-dim wp-opts-more">
        … and {{ optionCount(row) - 4 }} more
      </div>
    </template>
  </ModuleListView>
</template>

<style scoped>
.wp-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-3);
}
.wp-tags-empty { font-size: var(--wp-text-sm); }
.wp-tag-chip[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}

.wp-syntax-cell {
  display: inline-flex;
  gap: var(--wp-space-2);
  align-items: center;
  flex-wrap: nowrap;
}
.wp-syntax-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px; /* audit-exempt: 3px optical gap between icon and text inside pill */
  height: 20px;
  padding: 0 var(--wp-space-3);
  border-radius: 999px;
  font-size: var(--wp-text-xs);
  font-weight: 600;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  border: 1px solid transparent;
  white-space: nowrap;
  line-height: 1;
}
.wp-syntax-pill .pi { font-size: 9.5px; } /* audit-exempt: micro icon inside a pill — below scale floor */
.wp-syntax-pill--ref {
  /* @ref token color — pink/magenta, intentionally distinct from wildcard KIND violet.
   * Uses --wp-kind-ref / --wp-kind-ref-bg which flip to deeper fuchsia in light mode. */
  color: var(--wp-kind-ref);
  background: var(--wp-kind-ref-bg);
  border-color: color-mix(in oklab, var(--wp-kind-ref) 32%, transparent);
}
.wp-syntax-pill--in {
  color: var(--wp-accent-text, #c4b5fd);
  background: rgba(139, 92, 246, 0.18);
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 18%, transparent);
  border-color: rgba(139, 92, 246, 0.35);
  border-color: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 35%, transparent);
}
.wp-syntax-pill--dp {
  color: var(--wp-warn, #fcd34d);
  background: rgba(250, 204, 21, 0.18);
  background: color-mix(in oklab, var(--wp-warn, #facc15) 18%, transparent);
  border-color: rgba(250, 204, 21, 0.32);
  border-color: color-mix(in oklab, var(--wp-warn, #facc15) 32%, transparent);
}

/* Light-mode overrides — must repeat here because scoped [data-v-xxx] wins specificity
 * over global tokens.css rules. Colors route through tokens so both files stay in sync. */
.wp-theme-light .wp-syntax-pill--ref {
  /* --wp-kind-ref / --wp-kind-ref-bg already flip to fuchsia-800 in light mode */
  color: var(--wp-kind-ref);
  background: var(--wp-kind-ref-bg);
  border-color: color-mix(in oklab, var(--wp-kind-ref) 38%, transparent);
}
.wp-theme-light .wp-syntax-pill--in {
  background: rgba(139, 92, 246, 0.13);
  border-color: rgba(139, 92, 246, 0.40);
}
.wp-theme-light .wp-syntax-pill--dp {
  /* --wp-kind-derivation flips to amber-800 (#92400e) in light mode */
  color: var(--wp-kind-derivation);
  background: color-mix(in oklab, var(--wp-kind-derivation) 15%, transparent);
  border-color: color-mix(in oklab, var(--wp-kind-derivation) 45%, transparent);
}

.wp-opts-grid {
  display: grid;
  grid-template-columns: 30px 1fr 120px;
  gap: var(--wp-space-2) var(--wp-space-5);
  max-width: 760px;
  font-size: var(--wp-text-sm);
  align-items: center;
}
.wp-opts-grid__val {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-opts-grid__bar {
  background: var(--wp-bg-3);
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
}
.wp-opts-grid__bar-fill {
  height: 100%;
  background: var(--wp-accent-gradient);
}
.wp-opts-more { margin-top: var(--wp-space-4); font-size: var(--wp-text-xs); }
</style>
