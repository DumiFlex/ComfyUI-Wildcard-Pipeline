import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { api } from "../api/client";
import type { TemplateCreateInput, TemplateRow, TemplateUpdateInput } from "../api/types";

interface Filter {
  category?: string | null;
  q?: string;
  favorites?: boolean;
  tags?: string[];
  sortBy?: string;
}

export const useTemplateStore = defineStore("templates", () => {
  const items = ref<TemplateRow[]>([]);
  const catalog = ref<TemplateRow[]>([]);
  const loading = ref(false);
  const filter = reactive<Filter>({});

  async function fetchAll() {
    loading.value = true;
    try {
      const params: Record<string, string | boolean | undefined> = {};
      if (filter.category) params.category = filter.category ?? undefined;
      if (filter.q) params.q = filter.q;
      if (filter.favorites) params.favorites = true;
      const res = await api.templates.list(params);
      items.value = res.items;
    } finally {
      loading.value = false;
    }
  }

  async function fetchCatalog() {
    loading.value = true;
    try {
      const res = await api.templates.list({});
      catalog.value = res.items;
    } finally {
      loading.value = false;
    }
  }

  async function get(id: string) {
    return await api.templates.get(id);
  }

  async function create(body: TemplateCreateInput) {
    const row = await api.templates.create(body);
    items.value.unshift(row);
    catalog.value = [row, ...catalog.value.filter((i) => i.id !== row.id)];
    return row;
  }

  async function update(id: string, body: TemplateUpdateInput) {
    const updated = await api.templates.update(id, body);
    const i1 = items.value.findIndex((i) => i.id === id);
    if (i1 >= 0) items.value[i1] = updated;
    const i2 = catalog.value.findIndex((i) => i.id === id);
    if (i2 >= 0) catalog.value[i2] = updated;
    return updated;
  }

  async function remove(id: string) {
    await api.templates.delete(id);
    items.value = items.value.filter((i) => i.id !== id);
    catalog.value = catalog.value.filter((i) => i.id !== id);
  }

  async function toggleFavorite(id: string) {
    const updated = await api.templates.favorite(id);
    const i1 = items.value.findIndex((i) => i.id === id);
    if (i1 >= 0) items.value[i1] = updated;
    const i2 = catalog.value.findIndex((i) => i.id === id);
    if (i2 >= 0) catalog.value[i2] = updated;
    return updated;
  }

  return {
    items, catalog, loading, filter,
    fetchAll, fetchCatalog, get, create, update, remove, toggleFavorite,
  };
});
