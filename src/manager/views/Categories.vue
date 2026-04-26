<script setup lang="ts">
import { onMounted, ref } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import ColorPicker from "primevue/colorpicker";
import { useToast } from "primevue/usetoast";
import { useCategoryStore } from "../stores/categoryStore";
import { ApiError } from "../api/client";
import type { CategoryRow } from "../api/types";

const store = useCategoryStore();
const toast = useToast();
const newName = ref("");
const newColor = ref("a970ff");

onMounted(async () => { await store.fetchAll(); });

async function add() {
  const name = newName.value.trim();
  if (!name) return;
  try {
    await store.create({ name, color: `#${newColor.value}` });
    newName.value = "";
    toast.add({ severity: "success", summary: "Created", life: 2000 });
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String(e);
    toast.add({ severity: "error", summary: "Failed", detail: msg, life: 4000 });
  }
}

async function remove(row: CategoryRow) {
  try {
    await store.remove(row.id);
    toast.add({ severity: "success", summary: "Deleted", life: 2000 });
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String(e);
    toast.add({ severity: "error", summary: "Delete failed", detail: msg, life: 4000 });
  }
}
</script>

<template>
  <div class="p-6 text-wp-text max-w-3xl">
    <h1 class="text-xl font-semibold mb-4">Categories</h1>

    <div class="flex gap-2 mb-6 items-end">
      <div class="flex-1">
        <label for="cat-name" class="block text-xs text-wp-text2 mb-1">Name</label>
        <InputText id="cat-name" v-model="newName" placeholder="Style" class="w-full" @keydown.enter="add" />
      </div>
      <div>
        <label for="cat-color" class="block text-xs text-wp-text2 mb-1">Color</label>
        <ColorPicker id="cat-color" v-model="newColor" />
      </div>
      <Button label="+ Add" severity="primary" data-test="add-category-btn" @click="add" />
    </div>

    <DataTable :value="store.items" data-key="id" :loading="store.loading">
      <Column field="name" header="Name" />
      <Column field="color" header="Color" style="width:8rem">
        <template #body="{ data }">
          <span
            class="inline-block w-4 h-4 rounded mr-2 align-middle"
            :style="{ background: data.color || 'transparent', border: '1px solid var(--wp-border)' }"
            aria-hidden="true"
          />
          <span class="font-mono text-xs">{{ data.color || "—" }}</span>
        </template>
      </Column>
      <Column field="sort_order" header="Order" sortable style="width:6rem" />
      <Column header="Actions" style="width:6rem">
        <template #body="{ data }">
          <Button
            icon="pi pi-trash" text rounded size="small" severity="danger"
            aria-label="Delete category"
            @click="remove(data)"
          />
        </template>
      </Column>
      <template #empty>
        <div class="text-center p-6 text-wp-text2">No categories yet.</div>
      </template>
    </DataTable>
  </div>
</template>
