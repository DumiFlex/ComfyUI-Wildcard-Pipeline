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
import type { CategoryRow, CombinePayload, ModuleRow } from "../api/types";

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

onMounted(async () => {
  store.filter.type = "combine";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "combine";
  try {
    await store.fetchAll();
  } catch (e) {
    toast.add({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: ModuleRow) {
  router.push({ name: "combines-edit", params: { id: row.id } });
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
</script>

<template>
  <EntityListView
    title="Combines"
    subtitle="Combine modules merge resolved variables into a new value via templates."
    new-label="New Combine"
    new-route="/combines/new"
    :items="store.items"
    :loading="store.loading"
    :filter="store.filter"
    empty-message="No combines yet. Use these to merge resolved variables into named outputs."
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
            <i class="wp-kind-combine pi pi-share-alt text-wp-violet" aria-hidden="true" />
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
      <Column header="Output" header-style="width:10rem">
        <template #body="{ data }">
          <span class="font-mono text-wp-violet">{{ outputVar(data) }}</span>
        </template>
      </Column>
      <Column header="Inputs" header-style="width:5rem">
        <template #body="{ data }">
          <Badge :value="String(inputCount(data))" severity="secondary" />
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
          Template for <span class="text-wp-rose">{{ data.name }}</span>
        </h5>
        <pre v-if="templateOf(data)" class="combine-template font-mono text-xs">{{ templateOf(data) }}</pre>
        <div v-else class="text-sm text-wp-text3 mb-2">No template defined.</div>
        <div class="mt-2 flex flex-wrap items-center gap-1">
          <span class="text-xs text-wp-text3 mr-1">Reads:</span>
          <span v-if="!inputVars(data).length" class="text-xs text-wp-text3">no inputs</span>
          <span
            v-for="(v, i) in inputVars(data)" :key="i"
            class="input-var-chip font-mono"
          >{{ v.startsWith("$") ? v : `$${v}` }}</span>
        </div>
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
.combine-template {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 8px 10px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--wp-text);
  max-width: 720px;
}
.input-var-chip {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--wp-violet-bg, var(--wp-bg3));
  color: var(--wp-violet, var(--wp-text2));
  border: 1px solid var(--wp-violet, var(--wp-border));
}
.text-wp-violet { color: var(--wp-kind-combine, var(--wp-violet, #b4a0ff)); }
</style>
