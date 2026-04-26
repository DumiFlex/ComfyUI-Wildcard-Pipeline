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
    <h1 class="text-xl font-semibold m-0">Categories</h1>
    <p class="text-sm text-wp-text2 m-0 mt-1 mb-6">
      Tag groups for filtering modules. Color appears on category chips in the DataTable.
    </p>

    <div class="flex gap-2 mb-6 items-end">
      <div class="flex-1">
        <label for="cat-name" class="block text-xs text-wp-text2 mb-1">Name</label>
        <InputText id="cat-name" v-model="newName" placeholder="Style" class="w-full" @keydown.enter="add" />
      </div>
      <div class="color-input-group">
        <ColorPicker v-model="newColor" class="color-input-group__picker" />
        <InputText
          v-model="newColor" placeholder="hex" maxlength="6"
          aria-label="Hex color code"
          class="color-input-group__hex font-mono text-xs"
          @keydown.enter="add"
        />
      </div>
      <Button label="Add" icon="pi pi-plus" severity="primary" data-test="add-category-btn" @click="add" />
    </div>

    <DataTable :value="store.items" data-key="id" :loading="store.loading">
      <Column field="name" header="Name" />
      <Column field="color" header="Color" header-style="width:9rem">
        <template #body="{ data }">
          <span
            class="inline-block w-4 h-4 rounded mr-2 align-middle"
            :style="{ background: data.color || 'transparent', border: '1px solid var(--wp-border)' }"
            aria-hidden="true"
          />
          <span class="font-mono text-xs">{{ data.color || "—" }}</span>
        </template>
      </Column>
      <Column header="Actions" header-style="width:6rem">
        <template #body="{ data }">
          <Button icon="pi pi-trash" text rounded size="small" severity="danger"
            aria-label="Delete category" @click="remove(data)" />
        </template>
      </Column>
      <template #empty>
        <div class="text-center p-6 text-wp-text2">No categories yet.</div>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.color-input-group {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  overflow: hidden;
  height: 2rem;
}
.color-input-group__picker :deep(.p-colorpicker-preview) {
  width: 2rem;
  height: 100%;
  border: none;
  border-radius: 0;
}
.color-input-group__hex {
  width: 6rem;
  border: none !important;
  border-radius: 0 !important;
  outline: none !important;
  background: transparent;
}
.color-input-group__hex:focus { box-shadow: none !important; }
</style>
