import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { api } from "../api/client";
import type { ModuleCreateInput, ModuleRow, ModuleType, ModuleUpdateInput } from "../api/types";

interface Filter {
  type?: ModuleType;
  category?: string | null;
  q?: string;
  favorites?: boolean;
  /** Client-side AND-mode tag filter — server has no tag query yet. */
  tags?: string[];
  /** Client-side sort key. One of "updated-desc" / "updated-asc" / "name-asc" / "name-desc". */
  sortBy?: string;
}

export const useModuleStore = defineStore("modules", () => {
  const items = ref<ModuleRow[]>([]);
  const loading = ref(false);
  const filter = reactive<Filter>({});

  async function fetchAll() {
    loading.value = true;
    try {
      const params: Record<string, string | boolean | undefined> = {};
      if (filter.type) params.type = filter.type;
      if (filter.category) params.category = filter.category ?? undefined;
      if (filter.q) params.q = filter.q;
      if (filter.favorites) params.favorites = true;
      const res = await api.modules.list(params);
      items.value = res.items;
    } finally {
      loading.value = false;
    }
  }

  async function get(id: string) {
    return await api.modules.get(id);
  }

  async function create(body: ModuleCreateInput) {
    const row = await api.modules.create(body);
    items.value.unshift(row);
    return row;
  }

  async function update(id: string, body: ModuleUpdateInput) {
    const updated = await api.modules.update(id, body);
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx >= 0) items.value[idx] = updated;
    return updated;
  }

  async function remove(id: string) {
    await api.modules.delete(id);
    items.value = items.value.filter((i) => i.id !== id);
  }

  async function duplicate(id: string) {
    const copy = await api.modules.duplicate(id);
    items.value.unshift(copy);
    return copy;
  }

  async function toggleFavorite(id: string) {
    const updated = await api.modules.favorite(id);
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx >= 0) items.value[idx] = updated;
    return updated;
  }

  const wildcards = computed(() => items.value.filter((i) => i.type === "wildcard"));
  const fixedValues = computed(() => items.value.filter((i) => i.type === "fixed_values"));

  return {
    items, loading, filter,
    fetchAll, get, create, update, remove, duplicate, toggleFavorite,
    wildcards, fixedValues,
  };
});
