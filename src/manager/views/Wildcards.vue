<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "primevue/usetoast";
import Column from "primevue/column";
import Button from "primevue/button";
import Badge from "primevue/badge";
import Checkbox from "primevue/checkbox";
import EntityListView from "../components/EntityListView.vue";
import RelativeDate from "../components/RelativeDate.vue";
import { useModuleStore } from "../stores/moduleStore";
import type { ModuleRow } from "../api/types";

const router = useRouter();
const store = useModuleStore();
const toast = useToast();

onMounted(async () => {
  store.filter.type = "wildcard";
  await fetch();
});

async function fetch() {
  store.filter.type = "wildcard";
  try {
    await store.fetchAll();
  } catch (e) {
    toast.add({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function edit(row: ModuleRow) {
  router.push({ name: "wildcards-edit", params: { id: row.id } });
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

function optionCount(row: ModuleRow): number {
  return ((row.payload as { options?: unknown[] }).options ?? []).length;
}

function validIcon(row: ModuleRow): string {
  return optionCount(row) === 0
    ? "pi pi-exclamation-triangle text-wp-amber"
    : "pi pi-check-circle text-wp-green";
}
</script>

<template>
  <EntityListView
    title="Wildcards"
    subtitle="Wildcard modules pick one weighted option per resolution. Use $variable in prompts."
    new-label="New Wildcard"
    new-route="/wildcards/new"
    :items="store.items"
    :loading="store.loading"
    :filter="store.filter"
    empty-message="No wildcards yet. Create your first to start building dynamic prompts."
    @fetch="fetch"
    @delete="del"
    @bulk-delete="bulkDel"
  >
    <template #filter-panel="{ filter, emitFetch }">
      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox v-model="filter.favorites" :binary="true" @change="emitFetch" />
          Favorites only
        </label>
      </div>
    </template>

    <template #columns>
      <Column selection-mode="multiple" header-style="width:3rem" />
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
            <span class="cursor-pointer font-medium" @click="edit(data)">{{ data.name }}</span>
            <span class="text-xs text-wp-text3 font-mono">{{ data.id }}</span>
          </div>
        </template>
      </Column>
      <Column header="Items" header-style="width:7rem">
        <template #body="{ data }">
          <Badge :value="String(optionCount(data))" severity="secondary" />
        </template>
      </Column>
      <Column header="Valid" header-style="width:5rem">
        <template #body="{ data }">
          <i :class="validIcon(data)" :title="optionCount(data) === 0 ? 'No options' : 'Valid'" />
        </template>
      </Column>
      <Column field="updated_at" header="Updated" sortable header-style="width:10rem">
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
  </EntityListView>
</template>
