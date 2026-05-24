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
   * Writes ONLY to `catalog` — the permanent unfiltered cache read by sidebar
   * count badges, Cmd+K palette, and editors that need cross-kind references
   * (`$var` autocomplete, Constraint wildcard pickers, …). Editors must read
   * `store.catalog` for cross-refs, not `store.items` (which is scoped to the
   * current list view's filter).
   *
   * Previously also wrote `items` so editors could read from there — but that
   * raced against per-view `fetchAll()` and could leave list views showing
   * mixed-kind rows when the eager AppLayout fetchCatalog returned last.
   */
  async function fetchCatalog() {
    loading.value = true;
    try {
      const res = await api.modules.list({});
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

  /** Drop a row from the local store without hitting the API.
   *
   * Used after a cascade-apply that already deleted the row server-side
   * (cascade flow owns the network call; this just keeps the in-memory
   * list in sync). Calling `remove(id)` here would round-trip a second
   * DELETE and 404. */
  function removeLocal(id: string) {
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
    fetchAll, fetchCatalog, get, create, update, remove, removeLocal, duplicate, toggleFavorite,
    wildcards, fixedValues,
  };
});
