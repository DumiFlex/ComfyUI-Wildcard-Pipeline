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
import type { ModuleRow, CategoryRow } from "../api/types";

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
  store.filter.type = "fixed_values";
  await Promise.all([fetch(), categoryStore.fetchAll()]);
});

async function fetch() {
  store.filter.type = "fixed_values";
  try {
    await store.fetchAll();
  } catch (e) {
    toast.add({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: ModuleRow) {
  router.push({ name: "fixed-values-edit", params: { id: row.id } });
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

interface NamedValue { id: string; name: string; value: string; }

function values(row: ModuleRow): NamedValue[] {
  return ((row.payload as { values?: NamedValue[] }).values ?? []);
}
function valueCount(row: ModuleRow): number { return values(row).length; }
function topValues(row: ModuleRow): NamedValue[] { return values(row).slice(0, 3); }
</script>

<template>
  <EntityListView
    title="Fixed Values"
    subtitle="Fixed-value modules emit one or more named string variables, set explicitly."
    new-label="New Fixed Values"
    new-route="/fixed-values/new"
    :items="store.items"
    :loading="store.loading"
    :filter="store.filter"
    empty-message="No fixed values yet. Use these to lock variables to specific strings."
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
          <div class="flex flex-col">
            <span class="cursor-pointer font-medium hover:text-white" @click="edit(data)">{{ data.name }}</span>
            <span
              class="text-xs text-wp-text3 font-mono cursor-pointer hover:text-wp-text2 select-all"
              :title="`Click to copy ${data.id}`"
              @click.stop="copyId(data.id)"
            >{{ data.id }}</span>
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
      <Column header="Values" header-style="width:5rem">
        <template #body="{ data }">
          <Badge :value="String(valueCount(data))" severity="secondary" />
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
          First values for <span class="text-wp-rose">{{ data.name }}</span>
        </h5>
        <div v-if="topValues(data).length === 0" class="text-sm text-wp-text3">
          No values defined.
        </div>
        <div v-else class="flex flex-col gap-1">
          <div v-for="(v, i) in topValues(data)" :key="i" class="flex items-center gap-3 text-sm">
            <span class="font-mono text-wp-violet">${{ v.name.replace(/^\$/, "") || "?" }}</span>
            <span class="text-wp-text2">=</span>
            <span class="font-mono text-wp-text">{{ v.value || "(empty)" }}</span>
          </div>
          <span v-if="valueCount(data) > 3" class="text-xs text-wp-text3 mt-1">
            … and {{ valueCount(data) - 3 }} more
          </span>
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
</style>
