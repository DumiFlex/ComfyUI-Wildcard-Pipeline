<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import ModuleListView from "../components/ModuleListView.vue";
import RichTextPreview from "../components/RichTextPreview.vue";
import Button from "../components/ui/Button.vue";
import Select from "../components/ui/Select.vue";
import { useModuleStore } from "../stores/moduleStore";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";
import type { ModuleRow, CategoryRow } from "../api/types";
import {
  buildWildcardGraph,
  getWildcardSyntax,
  wildcardVarName,
} from "../utils/wildcardSyntax";

const router = useRouter();
const store = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

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
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name })),
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
  const sx = getWildcardSyntax(row);
  const name = wildcardVarName(row);
  const out = wildcardGraph.value.outgoing.get(name);
  const inc = wildcardGraph.value.incoming.get(name);
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
    check: (m: ModuleRow) => getWildcardSyntax(m).hasRefs,
  },
  {
    key: "has-inline",
    label: "Has inline {a|b|c}",
    check: (m: ModuleRow) => getWildcardSyntax(m).hasInline,
  },
  {
    key: "is-referenced",
    label: "Referenced by others",
    check: (m: ModuleRow) => {
      const inc = wildcardGraph.value.incoming.get(wildcardVarName(m));
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
  try {
    await store.fetchAll();
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: ModuleRow) {
  router.push({ name: "wildcards-edit", params: { id: row.id } });
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

async function bulkDel(items: ModuleRow[]) {
  for (const item of items) await del(item);
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
    :filter="store.filter"
    :extra-filters="extraFilters"
    :mid-cols="4"
    empty-message="No wildcards yet. Create your first to start building dynamic prompts."
    @fetch="fetch"
    @delete="del"
    @bulk-delete="bulkDel"
  >
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
            <RichTextPreview v-if="opt.value" :value="opt.value" />
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
  gap: 6px;
}
.wp-tags-empty { font-size: 12px; }
.wp-tag-chip[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}

.wp-syntax-cell {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  flex-wrap: nowrap;
}
.wp-syntax-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  border: 1px solid transparent;
  white-space: nowrap;
  line-height: 1;
}
.wp-syntax-pill .pi { font-size: 9.5px; }
.wp-syntax-pill--ref {
  color: var(--wp-kind-wildcard, #f0abfc);
  background: color-mix(in oklab, var(--wp-kind-wildcard, #c026d3) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-kind-wildcard, #c026d3) 28%, transparent);
}
.wp-syntax-pill--in {
  color: var(--wp-accent-text, #c4b5fd);
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 32%, transparent);
}
.wp-syntax-pill--dp {
  color: var(--wp-warn, #fcd34d);
  background: color-mix(in oklab, var(--wp-warn, #facc15) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-warn, #facc15) 30%, transparent);
}

.wp-opts-grid {
  display: grid;
  grid-template-columns: 30px 1fr 120px;
  gap: 4px 12px;
  max-width: 760px;
  font-size: 12.5px;
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
.wp-opts-more { margin-top: 8px; font-size: 11.5px; }
</style>
