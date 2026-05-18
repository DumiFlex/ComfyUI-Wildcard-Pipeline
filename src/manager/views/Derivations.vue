<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useToast } from "../composables/useToast";
import { useListUrlState } from "../composables/useListUrlState";
import { useBulkActions } from "../composables/useBulkActions";
import { makeModuleStoreAdapter } from "../composables/bulkAdapters";
import ModuleListView from "../components/ModuleListView.vue";
import Button from "../components/ui/Button.vue";
import Select from "../components/ui/Select.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import { useModuleStore } from "../stores/moduleStore";
import { catChipStyle } from "../utils/catChip";
import { useCategoryStore } from "../stores/categoryStore";
import type {
  CategoryRow,
  DerivationAction,
  DerivationCondition,
  DerivationPayload,
  DerivationRule,
  ModuleRow,
} from "../api/types";

const route = useRoute();
const router = useRouter();
const store = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const bulkAdapter = makeModuleStoreAdapter(store);
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
  store.filter.type = "derivation";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "derivation";
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
    name: "derivations-edit",
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

function rules(row: ModuleRow): DerivationRule[] {
  return ((row.payload as Partial<DerivationPayload>).rules ?? []);
}
function ruleCount(row: ModuleRow): number { return rules(row).length; }

const VERB: Record<string, string> = {
  append: "append to",
  prepend: "prepend to",
  replace: "replace in",
};

function actionVerb(mode: string | undefined): string {
  return VERB[mode ?? ""] ?? (mode ?? "?");
}

interface CondView { var?: string; op?: string; value?: string; }
function condView(c: DerivationCondition | undefined): CondView | null {
  if (!c) return null;
  return { var: c.var, op: c.op, value: c.value };
}
function actView(a: DerivationAction | undefined): { verb: string; target: string; value: string } | null {
  if (!a) return null;
  return { verb: actionVerb(a.mode), target: a.target_var, value: a.value ?? "" };
}
</script>

<template>
  <ModuleListView
    title="Derivations"
    subtitle="Derivations mutate the resolved context post-resolution — append, replace, or remove tokens conditionally."
    new-label="New Derivation"
    new-route="/derivations/new"
    :items="store.items"
    :loading="store.loading"
    :filter="filter"
    :mid-cols="2"
    empty-message="No derivations yet"
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
        icon="pi-arrow-right-arrow-left"
        headline="No derivations yet"
        body="Derivations branch logic on conditions to produce values. Create one to add conditional flow."
        variant="library"
      >
        <template #cta>
          <Button variant="primary" icon="pi-plus" @click="$router.push('/derivations/new')">
            New derivation
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
      <th style="width: 70px">Rules</th>
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
      <td><span class="wp-mono">{{ ruleCount(row) }}</span></td>
    </template>

    <template #actions="{ row }">
      <Button variant="ghost" size="sm" icon="pi-pencil" aria-label="Edit" @click="edit(row)" />
      <Button variant="ghost" size="sm" icon="pi-clone" aria-label="Duplicate" @click="dup(row)" />
      <Button variant="ghost" size="sm" icon="pi-trash" aria-label="Delete" @click="del(row)" />
    </template>

    <template #expansion="{ row }">
      <div class="wp-row-expand__title">Rules ({{ ruleCount(row) }})</div>
      <div v-if="!ruleCount(row)" class="wp-dim">No rules defined.</div>
      <div v-else class="wp-snippet wp-rules-snippet">
        <div v-for="(rule, ri) in rules(row)" :key="rule.id ?? ri" class="wp-rule-block">
          <div class="wp-token-com wp-rule-block__head"># rule {{ ri + 1 }}</div>
          <div v-for="(b, bi) in rule.branches ?? []" :key="bi" class="wp-rule-branch">
            <span class="wp-token-key">{{ bi === 0 ? "IF" : "ELIF" }}</span>
            <template v-if="condView(b.condition)">
              <span>&nbsp;@{{ condView(b.condition)!.var || "?" }}</span>
              <span>&nbsp;{{ condView(b.condition)!.op }}</span>
              <span class="wp-token-str">&nbsp;"{{ condView(b.condition)!.value }}"</span>
            </template>
            <span v-else>&nbsp;<em class="wp-dim">always</em></span>
            <span class="wp-token-com"> · </span>
            <span class="wp-token-key">THEN</span>
            <template v-if="actView(b.action)">
              <span>&nbsp;{{ actView(b.action)!.verb }} {{ actView(b.action)!.target }}</span>
              <span v-if="actView(b.action)!.value" class="wp-token-str">&nbsp;"{{ actView(b.action)!.value }}"</span>
            </template>
          </div>
          <div v-if="rule.else" class="wp-rule-branch">
            <span class="wp-token-key">ELSE</span>
            <template v-if="actView(rule.else.action)">
              <span>&nbsp;{{ actView(rule.else.action)!.verb }} {{ actView(rule.else.action)!.target }}</span>
              <span v-if="actView(rule.else.action)!.value" class="wp-token-str">&nbsp;"{{ actView(rule.else.action)!.value }}"</span>
            </template>
          </div>
        </div>
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

.wp-rules-snippet {
  max-width: 720px;
  line-height: 1.5;
}
.wp-rule-block { margin-bottom: var(--wp-space-4); }
.wp-rule-block:last-child { margin-bottom: 0; }
.wp-rule-branch { margin-bottom: var(--wp-space-1); }
.wp-rule-block__head {
  font-size: var(--wp-text-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
</style>
