<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Button from "primevue/button";
import SplitButton from "primevue/splitbutton";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import Tag from "primevue/tag";
import Badge from "primevue/badge";
import { useToast } from "primevue/usetoast";
import { useConfirm } from "primevue/useconfirm";
import ConfirmDialog from "primevue/confirmdialog";
import { useModuleStore } from "../stores/moduleStore";
import type { ModuleRow, ModuleType } from "../api/types";

const router = useRouter();
const store = useModuleStore();
const toast = useToast();
const confirm = useConfirm();
const search = ref("");

const newOptions = [
  { label: "Wildcard", icon: "pi pi-th-large", command: () => router.push("/modules/wildcard/new") },
  { label: "Fixed values", icon: "pi pi-tag", command: () => router.push("/modules/fixed-values/new") },
];

onMounted(async () => {
  try {
    await store.fetchAll();
  } catch (e) {
    toast.add({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
});

watch(search, async (q) => {
  store.filter.q = q || undefined;
  try {
    await store.fetchAll();
  } catch (e) {
    toast.add({ severity: "error", summary: "Search failed", detail: String(e), life: 4000 });
  }
});

async function setTypeFilter(type: ModuleType | undefined) {
  store.filter.type = type;
  try {
    await store.fetchAll();
  } catch (e) {
    toast.add({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  }
}

function rowClass(row: ModuleRow) {
  return ["cursor-pointer", row.is_favorite ? "border-l-2 border-wp-amber" : ""].join(" ");
}

function edit(row: ModuleRow) {
  const name = row.type === "wildcard" ? "wildcard-edit" : "fixed-values-edit";
  router.push({ name, params: { id: row.id } });
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
  try {
    await store.toggleFavorite(row.id);
  } catch (e) {
    toast.add({ severity: "error", summary: "Favorite failed", detail: String(e), life: 4000 });
  }
}

function del(row: ModuleRow) {
  confirm.require({
    message: `Delete "${row.name}"?`,
    header: "Confirm delete",
    icon: "pi pi-exclamation-triangle",
    acceptClass: "p-button-danger",
    accept: async () => {
      try {
        await store.remove(row.id);
        toast.add({ severity: "success", summary: "Deleted", detail: row.name, life: 2000 });
      } catch (e) {
        toast.add({ severity: "error", summary: "Delete failed", detail: String(e), life: 4000 });
      }
    },
  });
}

function itemCount(row: ModuleRow): number {
  const payload = row.payload as { options?: unknown[]; values?: unknown[] };
  return (payload.options ?? payload.values ?? []).length;
}
</script>

<template>
  <div class="p-6 text-wp-text">
    <ConfirmDialog />

    <div class="flex items-end justify-between mb-4">
      <div>
        <h1 class="text-xl font-semibold m-0">Modules</h1>
        <p class="text-sm text-wp-text2 m-0 mt-1">
          All module declarations. ComfyUI nodes embed snapshots from this library.
        </p>
      </div>
      <SplitButton label="+ New" :model="newOptions" severity="primary" />
    </div>

    <div class="flex gap-2 mb-3 items-center flex-wrap">
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" placeholder="Search by name…" class="w-64" />
      </IconField>
      <Button
        :severity="!store.filter.type ? 'primary' : 'secondary'"
        outlined size="small" label="All"
        data-test="type-filter-all"
        @click="setTypeFilter(undefined)"
      />
      <Button
        :severity="store.filter.type === 'wildcard' ? 'primary' : 'secondary'"
        outlined size="small" label="🎲 Wildcard"
        data-test="type-filter-wildcard"
        @click="setTypeFilter('wildcard')"
      />
      <Button
        :severity="store.filter.type === 'fixed_values' ? 'primary' : 'secondary'"
        outlined size="small" label="📌 Fixed"
        data-test="type-filter-fixed"
        @click="setTypeFilter('fixed_values')"
      />
      <span class="ml-auto text-xs text-wp-text2">{{ store.items.length }} module(s)</span>
    </div>

    <DataTable
      :value="store.items"
      :loading="store.loading"
      data-key="id"
      :rowClass="rowClass"
      :rows="20"
      :paginator="store.items.length > 20"
      @row-click="(e) => edit(e.data as ModuleRow)"
    >
      <Column field="type" header="Type" style="width:8rem">
        <template #body="{ data }">
          <Tag
            :value="data.type === 'wildcard' ? '🎲 wildcard' : '📌 fixed'"
            :severity="data.type === 'wildcard' ? 'info' : 'success'"
          />
        </template>
      </Column>
      <Column field="name" header="Name" sortable />
      <Column header="Items" style="width:5rem">
        <template #body="{ data }">
          <Badge :value="String(itemCount(data))" severity="secondary" />
        </template>
      </Column>
      <Column field="updated_at" header="Updated" sortable style="width:10rem">
        <template #body="{ data }">
          <span class="text-xs text-wp-text2">{{ data.updated_at?.slice(0, 10) }}</span>
        </template>
      </Column>
      <Column header="Actions" style="width:11rem">
        <template #body="{ data }">
          <div class="flex gap-1" @click.stop>
            <Button
              :icon="data.is_favorite ? 'pi pi-star-fill' : 'pi pi-star'"
              text rounded size="small"
              :severity="data.is_favorite ? 'warning' : 'secondary'"
              aria-label="Favorite"
              @click="fav(data)"
            />
            <Button icon="pi pi-pencil" text rounded size="small" aria-label="Edit" @click="edit(data)" />
            <Button icon="pi pi-copy" text rounded size="small" aria-label="Duplicate" @click="dup(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label="Delete" @click="del(data)" />
          </div>
        </template>
      </Column>
      <template #empty>
        <div class="text-center p-8 text-wp-text2">
          No modules yet. Click "+ New" to create your first.
        </div>
      </template>
    </DataTable>
  </div>
</template>
