import { markDeleted } from "../composables/useLibraryChanged";
import { defineStore } from "pinia";
import { reactive, ref, shallowRef } from "vue";
import { api } from "../api/client";
import type { BundleCreateInput, BundleRow, BundleUpdateInput } from "../api/types";
import { createLibraryCache, filterRows, replaceRow } from "./libraryCache";

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
  /** Every bundle (see `libraryCache.ts`: shallow, replaced on change). */
  const cache = createLibraryCache<BundleRow>(() => api.bundles.list({}));
  const catalog = cache.rows;
  /** The Bundles page's rows: `catalog` through `filter`. */
  const items = shallowRef<BundleRow[]>([]);
  const loading = ref(false);
  const filter = reactive<Filter>({});
  /** Set once a list view has fetched `items`, so a library refresh only
   *  re-derives what some page has already loaded. */
  const listed = ref(false);
  let ticket = 0;

  function derive(): void {
    items.value = filterRows(catalog.value, filter);
  }

  function setCatalog(next: BundleRow[]): void {
    cache.set(next);
    if (listed.value) derive();
  }

  /** The Bundles page's rows for `filter`, filtered on the client (see
   *  `moduleStore.fetchAll`). */
  async function fetchAll() {
    const mine = ++ticket;
    if (!cache.loaded.value) loading.value = true;
    try {
      await cache.ensure();
      if (mine !== ticket) return;
      listed.value = true;
      derive();
    } finally {
      if (mine === ticket) loading.value = false;
    }
  }

  /**
   * Fetch the full bundle catalog, ignoring the persistent `filter.*` state.
   *
   * The one copy the Bundles page, sidebar count badges and Cmd+K palette
   * read. `ensureCatalog()` when it only needs to be present.
   */
  async function fetchCatalog() {
    await cache.refresh();
    if (listed.value) derive();
  }

  async function ensureCatalog() {
    await cache.ensure();
  }

  async function get(id: string) {
    return await api.bundles.get(id);
  }

  async function create(body: BundleCreateInput) {
    const row = await api.bundles.create(body);
    if (!listed.value) items.value = [row, ...items.value];
    setCatalog([row, ...catalog.value.filter((i) => i.id !== row.id)]);
    return row;
  }

  function replaced(updated: BundleRow): void {
    if (!listed.value) items.value = replaceRow(items.value, updated);
    setCatalog(replaceRow(catalog.value, updated));
  }

  async function update(id: string, body: BundleUpdateInput) {
    const updated = await api.bundles.update(id, body);
    replaced(updated);
    return updated;
  }

  async function remove(id: string) {
    await api.bundles.delete(id);
    removeLocal(id);
  }

  /** Drop a row the cascade flow already deleted on the server (a second
   *  DELETE there would 404 before the list updates). */
  function removeLocal(id: string) {
    markDeleted([id]);
    if (!listed.value) items.value = items.value.filter((i) => i.id !== id);
    setCatalog(catalog.value.filter((i) => i.id !== id));
  }

  async function toggleFavorite(id: string) {
    const updated = await api.bundles.favorite(id);
    replaced(updated);
    return updated;
  }

  return {
    items, catalog, loading, filter, listed, catalogLoaded: cache.loaded,
    fetchAll, fetchCatalog, ensureCatalog, get, create, update, remove, removeLocal, toggleFavorite,
  };
});
