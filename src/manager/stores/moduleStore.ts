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
  const catalog = ref<ModuleRow[]>([]);
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

  /**
   * Fetch the full module catalog, ignoring the persistent `filter.*` state.
   *
   * `fetchAll()` honors `filter.type` so that list views (Wildcards, Combines,
   * etc.) only load same-kind rows — but editors need ALL modules for cross-
   * references (`$var` autocomplete sourced from upstream wildcards/combines,
   * Constraint editor wildcard pickers, …). Calling `fetchAll()` from an editor
   * after the user came from a typed list page would silently scope `items` to
   * one type and break those cross-refs. Use this method from editors instead.
   *
   * Writes to BOTH `items` (so editors see the full set) AND `catalog` (the
   * permanent unfiltered cache read by sidebar count badges and Cmd+K palette).
   * The next list-view mount re-applies its filter via `fetchAll()`, restoring
   * `items` to the scoped subset without touching `catalog`.
   */
  async function fetchCatalog() {
    loading.value = true;
    try {
      const res = await api.modules.list({});
      items.value = res.items;
      catalog.value = res.items;
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
    catalog.value = [row, ...catalog.value.filter((i) => i.id !== row.id)];
    return row;
  }

  async function update(id: string, body: ModuleUpdateInput) {
    const updated = await api.modules.update(id, body);
    const i1 = items.value.findIndex((i) => i.id === id);
    if (i1 >= 0) items.value[i1] = updated;
    const i2 = catalog.value.findIndex((i) => i.id === id);
    if (i2 >= 0) catalog.value[i2] = updated;
    return updated;
  }

  async function remove(id: string) {
    await api.modules.delete(id);
    items.value = items.value.filter((i) => i.id !== id);
    catalog.value = catalog.value.filter((i) => i.id !== id);
  }

  async function duplicate(id: string) {
    const copy = await api.modules.duplicate(id);
    items.value.unshift(copy);
    catalog.value = [copy, ...catalog.value.filter((i) => i.id !== copy.id)];
    return copy;
  }

  async function toggleFavorite(id: string) {
    const updated = await api.modules.favorite(id);
    const i1 = items.value.findIndex((i) => i.id === id);
    if (i1 >= 0) items.value[i1] = updated;
    const i2 = catalog.value.findIndex((i) => i.id === id);
    if (i2 >= 0) catalog.value[i2] = updated;
    return updated;
  }

  const wildcards = computed(() => items.value.filter((i) => i.type === "wildcard"));
  const fixedValues = computed(() => items.value.filter((i) => i.type === "fixed_values"));

  return {
    items, catalog, loading, filter,
    fetchAll, fetchCatalog, get, create, update, remove, duplicate, toggleFavorite,
    wildcards, fixedValues,
  };
});
