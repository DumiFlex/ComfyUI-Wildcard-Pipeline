import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { api } from "../api/client";
import type { BundleCreateInput, BundleRow, BundleUpdateInput } from "../api/types";

interface Filter {
  category?: string | null;
  q?: string;
  favorites?: boolean;
  /** Client-side AND-mode tag filter — server has no tag query yet. */
  tags?: string[];
  /** Client-side sort key. One of "updated-desc" / "updated-asc" / "name-asc" / "name-desc". */
  sortBy?: string;
}

/** Pinia store mirroring `moduleStore` shape for bundle library
 *  entries. Bundles don't carry a `type` discriminator (every entry
 *  IS a bundle), so the filter omits the `type` field — otherwise
 *  the API surface is identical so list views can reuse the same
 *  table/grid components by swapping store. */
export const useBundleStore = defineStore("bundles", () => {
  const items = ref<BundleRow[]>([]);
  const catalog = ref<BundleRow[]>([]);
  const loading = ref(false);
  const filter = reactive<Filter>({});

  async function fetchAll() {
    loading.value = true;
    try {
      const params: Record<string, string | boolean | undefined> = {};
      if (filter.category) params.category = filter.category ?? undefined;
      if (filter.q) params.q = filter.q;
      if (filter.favorites) params.favorites = true;
      const res = await api.bundles.list(params);
      items.value = res.items;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Fetch the full bundle catalog, ignoring the persistent `filter.*` state.
   *
   * Writes ONLY to `catalog` (sidebar count badges, Cmd+K palette). Bundles
   * have no kind discriminator so the staleness race that bit moduleStore
   * doesn't apply here, but the API is kept symmetric for clarity.
   */
  async function fetchCatalog() {
    loading.value = true;
    try {
      const res = await api.bundles.list({});
      catalog.value = res.items;
    } finally {
      loading.value = false;
    }
  }

  async function get(id: string) {
    return await api.bundles.get(id);
  }

  async function create(body: BundleCreateInput) {
    const row = await api.bundles.create(body);
    items.value.unshift(row);
    catalog.value = [row, ...catalog.value.filter((i) => i.id !== row.id)];
    return row;
  }

  async function update(id: string, body: BundleUpdateInput) {
    const updated = await api.bundles.update(id, body);
    const i1 = items.value.findIndex((i) => i.id === id);
    if (i1 >= 0) items.value[i1] = updated;
    const i2 = catalog.value.findIndex((i) => i.id === id);
    if (i2 >= 0) catalog.value[i2] = updated;
    return updated;
  }

  async function remove(id: string) {
    await api.bundles.delete(id);
    items.value = items.value.filter((i) => i.id !== id);
    catalog.value = catalog.value.filter((i) => i.id !== id);
  }

  async function toggleFavorite(id: string) {
    const updated = await api.bundles.favorite(id);
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
