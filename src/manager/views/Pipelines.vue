<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "primevue/usetoast";
import Column from "primevue/column";
import Button from "primevue/button";
import Badge from "primevue/badge";
import Checkbox from "primevue/checkbox";
import MultiSelect from "primevue/multiselect";
import Select from "primevue/select";
import EntityListView from "../components/EntityListView.vue";
import RelativeDate from "../components/RelativeDate.vue";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import type {
  CategoryRow,
  ModuleRow,
  ModuleType,
  PipelinePayload,
  PipelineStep,
} from "../api/types";

const router = useRouter();
const store = useModuleStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const categoryById = computed(() => {
  const map = new Map<string, CategoryRow>();
  for (const c of categoryStore.items) map.set(c.id, c);
  return map;
});

// Used to resolve step.module_id -> name + kind. Best-effort: depends on what's
// currently in the moduleStore (which is filtered to type=pipeline on this page).
const moduleById = computed(() => {
  const map = new Map<string, ModuleRow>();
  for (const m of store.items) map.set(m.id, m);
  return map;
});

const allTags = computed(() => {
  const set = new Set<string>();
  for (const m of store.items) for (const t of m.tags ?? []) set.add(t);
  return Array.from(set).sort();
});

onMounted(async () => {
  store.filter.type = "pipeline";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "pipeline";
  try {
    await store.fetchAll();
  } catch (e) {
    toast.add({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: ModuleRow) {
  router.push({ name: "pipelines-edit", params: { id: row.id } });
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id);
    toast.add({ severity: "info", summary: "ID copied", detail: id, life: 1500 });
  } catch {
    toast.add({ severity: "error", summary: "Copy failed", life: 2000 });
  }
}

async function dup(row: ModuleRow) {
  try {
    await store.duplicate(row.id);
    toast.add({ severity: "success", summary: "Duplicated", detail: row.name, life: 2000 });
  } catch (e) {
    toast.add({ severity: "error", summary: "Duplicate failed", detail: String(e), life: 4000 });
  }
}

async function fav(row: ModuleRow) {
  try { await store.toggleFavorite(row.id); }
  catch (e) { toast.add({ severity: "error", summary: "Favorite failed", detail: String(e), life: 4000 }); }
}

async function del(row: ModuleRow) {
  try {
    await store.remove(row.id);
    toast.add({ severity: "success", summary: "Deleted", detail: row.name, life: 2000 });
  } catch (e) {
    toast.add({ severity: "error", summary: "Delete failed", detail: String(e), life: 4000 });
  }
}

async function bulkDel(items: ModuleRow[]) {
  for (const item of items) await del(item);
}

const KIND_ICON: Record<ModuleType, string> = {
  wildcard: "pi pi-th-large",
  fixed_values: "pi pi-tag",
  combine: "pi pi-share-alt",
  derivation: "pi pi-code",
  constraint: "pi pi-sitemap",
  pipeline: "pi pi-list",
};

function steps(row: ModuleRow): PipelineStep[] {
  return ((row.payload as Partial<PipelinePayload>).steps ?? []);
}
function stepCount(row: ModuleRow): number { return steps(row).length; }
function enabledCount(row: ModuleRow): number {
  return steps(row).filter((s) => s.enabled !== false).length;
}

function stepLabel(step: PipelineStep): { name: string; kind: ModuleType | null } {
  const m = moduleById.value.get(step.module_id);
  return { name: m?.name ?? step.module_id, kind: m?.type ?? null };
}

function iconFor(kind: ModuleType | null): string {
  if (!kind) return "pi pi-circle";
  return KIND_ICON[kind] ?? "pi pi-circle";
}

function kindClass(kind: ModuleType | null): string {
  return kind ? `wp-kind-${kind}` : "";
}
</script>

<template>
  <EntityListView
    title="Pipelines"
    subtitle="Pipelines run a sequence of modules in order, accumulating context."
    new-label="New Pipeline"
    new-route="/pipelines/new"
    :items="store.items"
    :loading="store.loading"
    :filter="store.filter"
    empty-message="No pipelines yet. Group modules into reusable presets."
    @fetch="fetch"
    @delete="del"
    @bulk-delete="bulkDel"
  >
    <template #filter-panel="{ filter, emitFetch }">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-wp-text2 mb-1">Category</label>
          <Select
            v-model="filter.category"
            :options="categoryStore.items" option-label="name" option-value="id"
            placeholder="All categories" show-clear class="w-full"
            aria-label="Filter by category"
            @change="emitFetch"
          />
        </div>
        <div>
          <label class="block text-xs text-wp-text2 mb-1">Tags</label>
          <MultiSelect
            v-model="filter.tags"
            :options="allTags"
            placeholder="Any tag" display="chip" filter class="w-full"
            @change="emitFetch"
          />
        </div>
        <div class="col-span-2 flex items-center gap-4 pt-1">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox v-model="filter.favorites" :binary="true" @change="emitFetch" />
            Favorites only
          </label>
        </div>
      </div>
    </template>

    <template #columns>
      <Column selection-mode="multiple" header-style="width:3rem" />
      <Column expander header-style="width:3rem" />
      <Column header-style="width:3rem">
        <template #body="{ data }">
          <Button
            :icon="data.is_favorite ? 'pi pi-star-fill' : 'pi pi-star'"
            text rounded size="small"
            :severity="data.is_favorite ? 'warning' : 'secondary'"
            aria-label="Toggle favorite"
            @click.stop="fav(data)"
          />
        </template>
      </Column>
      <Column field="name" header="Name" sortable>
        <template #body="{ data }">
          <div class="flex items-center gap-2">
            <i class="wp-kind-pipeline pi pi-list text-wp-pipeline" aria-hidden="true" />
            <div class="flex flex-col">
              <span class="cursor-pointer font-medium hover:text-white" @click="edit(data)">{{ data.name }}</span>
              <span
                class="text-xs text-wp-text3 font-mono cursor-pointer hover:text-wp-text2 select-all"
                :title="`Click to copy ${data.id}`"
                @click.stop="copyId(data.id)"
              >{{ data.id }}</span>
            </div>
          </div>
        </template>
      </Column>
      <Column field="category_id" header="Category" header-style="width:9rem" sortable>
        <template #body="{ data }">
          <span
            v-if="data.category_id && categoryById.get(data.category_id)"
            class="category-chip"
            :style="{ background: categoryById.get(data.category_id)!.color || 'var(--wp-bg3)' }"
          >
            {{ categoryById.get(data.category_id)!.name }}
          </span>
          <span v-else class="text-wp-text3 text-sm">—</span>
        </template>
      </Column>
      <Column header="Steps" header-style="width:6rem">
        <template #body="{ data }">
          <Badge
            :value="`${enabledCount(data)} / ${stepCount(data)}`"
            severity="secondary"
          />
        </template>
      </Column>
      <Column field="tags" header="Tags" header-style="width:13rem">
        <template #body="{ data }">
          <div v-if="data.tags?.length" class="flex flex-wrap gap-1">
            <span v-for="(t, i) in data.tags.slice(0, 3)" :key="i" class="tag-chip">{{ t }}</span>
            <span v-if="data.tags.length > 3" class="text-xs text-wp-text3">+{{ data.tags.length - 3 }}</span>
          </div>
          <span v-else class="text-wp-text3 text-sm">—</span>
        </template>
      </Column>
      <Column field="updated_at" header="Updated" sortable header-style="width:9rem">
        <template #body="{ data }">
          <RelativeDate :value="data.updated_at" />
        </template>
      </Column>
      <Column header="Actions" header-style="width:11rem">
        <template #body="{ data }">
          <div class="flex gap-1" @click.stop>
            <Button icon="pi pi-pencil" text rounded size="small" aria-label="Edit" @click="edit(data)" />
            <Button icon="pi pi-copy" text rounded size="small" aria-label="Duplicate" @click="dup(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label="Delete" @click="del(data)" />
          </div>
        </template>
      </Column>
    </template>

    <template #expansion="{ data }">
      <div class="px-6 py-3">
        <h5 class="text-xs font-semibold mb-2 uppercase tracking-wider text-wp-text2">
          Steps for <span class="text-wp-rose">{{ data.name }}</span>
        </h5>
        <div v-if="stepCount(data) === 0" class="text-sm text-wp-text3">
          No steps defined.
        </div>
        <ol v-else class="step-list">
          <li
            v-for="(step, idx) in steps(data)" :key="step.id ?? idx"
            class="step-list__item"
            :class="{ 'step-list__item--disabled': step.enabled === false }"
          >
            <span class="step-list__index">{{ idx + 1 }}.</span>
            <i :class="[iconFor(stepLabel(step).kind), kindClass(stepLabel(step).kind)]" aria-hidden="true" />
            <span class="step-list__name">{{ stepLabel(step).name }}</span>
            <span
              class="step-list__toggle"
              :title="step.enabled === false ? 'Disabled' : 'Enabled'"
              :aria-label="step.enabled === false ? 'Disabled' : 'Enabled'"
            >
              <i :class="step.enabled === false ? 'pi pi-eye-slash' : 'pi pi-check-circle'" />
            </span>
          </li>
        </ol>
      </div>
    </template>
  </EntityListView>
</template>

<style scoped>
.category-chip {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 9px;
  color: #fff;
  font-weight: 500;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
}
.tag-chip {
  font-size: 10px;
  padding: 1px 6px;
  background: var(--wp-bg3);
  color: var(--wp-text2);
  border-radius: 3px;
}
.step-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.step-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.step-list__item--disabled { opacity: 0.55; }
.step-list__index {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  width: 1.5rem;
  color: var(--wp-text3);
}
.step-list__name { color: var(--wp-text); }
.step-list__toggle { margin-left: auto; color: var(--wp-text3); }
.step-list__item--disabled .step-list__toggle { color: var(--wp-amber, #f7b955); }
.text-wp-pipeline { color: var(--wp-kind-pipeline, var(--wp-accent, #6aa1ff)); }
</style>
