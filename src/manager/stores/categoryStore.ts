import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api/client";
import type { CategoryCreateInput, CategoryRow } from "../api/types";

export const useCategoryStore = defineStore("categories", () => {
  const items = ref<CategoryRow[]>([]);
  const loading = ref(false);

  async function fetchAll() {
    loading.value = true;
    try {
      const res = await api.categories.list();
      items.value = res.items;
    } finally {
      loading.value = false;
    }
  }

  async function create(body: CategoryCreateInput) {
    const row = await api.categories.create(body);
    items.value.push(row);
    return row;
  }

  async function update(id: string, body: Partial<CategoryCreateInput>) {
    const row = await api.categories.update(id, body);
    const idx = items.value.findIndex((c) => c.id === id);
    if (idx >= 0) items.value[idx] = row;
    return row;
  }

  async function remove(id: string) {
    await api.categories.delete(id);
    items.value = items.value.filter((c) => c.id !== id);
  }

  return { items, loading, fetchAll, create, update, remove };
});
