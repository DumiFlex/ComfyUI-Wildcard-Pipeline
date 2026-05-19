<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import { useListUrlState } from "../composables/useListUrlState";
import { useLoadError } from "../composables/useLoadError";
import { useBulkActions } from "../composables/useBulkActions";
import { makeModuleStoreAdapter } from "../composables/bulkAdapters";
import ModuleListView from "../components/ModuleListView.vue";
import Button from "../components/ui/Button.vue";
import Select from "../components/ui/Select.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { useModuleStore } from "../stores/moduleStore";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";
import type { CategoryRow, CombinePayload, ModuleRow } from "../api/types";

const route = useRoute();
const router = useRouter();
const store = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const bulkAdapter = makeModuleStoreAdapter(store);
const bulk = useBulkActions(bulkAdapter);
const loadErr = useLoadError();

const urlState = useListUrlState(undefined, "combines");

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
  store.filter.type = "combine";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "combine";
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
    name: "combines-edit",
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

function payloadOf(row: ModuleRow): CombinePayload {
  const p = row.payload as Partial<CombinePayload>;
  return {
    template: p.template ?? "",
    output_var: p.output_var ?? "",
    input_vars: p.input_vars ?? [],
  };
}

function outputVar(row: ModuleRow): string {
  const v = payloadOf(row).output_var || "";
  return v ? `$${v.replace(/^\$/, "")}` : "—";
}

function inputVars(row: ModuleRow): string[] { return payloadOf(row).input_vars; }
function inputCount(row: ModuleRow): number { return inputVars(row).length; }
function templateOf(row: ModuleRow): string { return payloadOf(row).template; }

interface TemplatePart { kind: "key" | "var" | "text"; text: string; }
function templateParts(row: ModuleRow): TemplatePart[] {
  const tpl = templateOf(row);
  if (!tpl) return [];
  const parts = tpl.split(/(\{[^}]+\}|\$[a-z_][a-z0-9_]*)/i);
  return parts
    .filter((p) => p !== "")
    .map((p) => {
      if (/^\{[^}]+\}$/.test(p)) return { kind: "key" as const, text: p };
      if (/^\$[a-z_]/i.test(p)) return { kind: "var" as const, text: p };
      return { kind: "text" as const, text: p };
    });
}
</script>

<template>
  <ModuleListView
    title="Combines"
    subtitle="Combine modules merge upstream resolved values via a template, storing into a new variable for downstream."
    new-label="New Combine"
    new-route="/combines/new"
    :items="store.items"
    :loading="store.loading"
    :load-error="loadErr.error.value"
    :filter="filter"
    :mid-cols="3"
    empty-message="No combines yet"
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
        icon="pi-link"
        headline="No combines yet"
        body="Combines join multiple modules into one templated string. Create your first composition."
        variant="library"
      >
        <template #cta>
          <Button variant="primary" icon="pi-plus" @click="$router.push('/combines/new')">
            New combine
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
      <th style="width: 140px">Output</th>
      <th style="width: 70px">Inputs</th>
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
      <td><span class="wp-mono wp-row-expand__name">{{ outputVar(row) }}</span></td>
      <td><span class="wp-mono">{{ inputCount(row) }}</span></td>
    </template>

    <template #actions="{ row }">
      <Button variant="ghost" size="sm" icon="pi-pencil" aria-label="Edit" @click="edit(row)" />
      <Button variant="ghost" size="sm" icon="pi-clone" aria-label="Duplicate" @click="dup(row)" />
      <Button variant="ghost" size="sm" icon="pi-trash" aria-label="Delete" @click="del(row)" />
    </template>

    <template #expansion="{ row }">
      <div class="wp-row-expand__title">Template</div>
      <div v-if="templateOf(row)" class="wp-snippet">
        <template v-for="(p, i) in templateParts(row)" :key="i">
          <span v-if="p.kind === 'key'" class="wp-token-key">{{ p.text }}</span>
          <span v-else-if="p.kind === 'var'" class="wp-token-var">{{ p.text }}</span>
          <span v-else>{{ p.text }}</span>
        </template>
      </div>
      <div v-else class="wp-dim">No template defined.</div>
      <div class="wp-input-vars">
        <span class="wp-dim wp-input-vars__label">Reads:</span>
        <span v-if="!inputVars(row).length" class="wp-dim">no inputs</span>
        <span
          v-for="(v, i) in inputVars(row)" :key="i"
          class="wp-input-var-chip"
        >
          <i :class="v.startsWith('@') ? 'pi pi-sparkles' : 'pi pi-tag'" />
          {{ v }}
        </span>
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

.wp-input-vars {
  display: flex;
  gap: var(--wp-space-3);
  flex-wrap: wrap;
  align-items: center;
  margin-top: var(--wp-space-4);
}
.wp-input-vars__label { font-size: var(--wp-text-xs); margin-right: var(--wp-space-2); }
.wp-input-var-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  padding: var(--wp-space-1) var(--wp-space-4);
  border-radius: 999px;
  font-size: var(--wp-text-xs);
  background: color-mix(in oklab, var(--wp-accent-500) 14%, transparent);
  color: var(--wp-accent-text);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
  font-family: var(--wp-font-mono);
}
.wp-input-var-chip .pi { font-size: 9.5px; } /* audit-exempt: micro icon inside a pill — below scale floor */
</style>
