import { markDeleted } from "../composables/useLibraryChanged";
import { defineStore } from "pinia";
import { reactive, ref, shallowRef } from "vue";
import { api } from "../api/client";
import type { TemplateCreateInput, TemplateRow, TemplateUpdateInput } from "../api/types";
import { createLibraryCache, filterRows, replaceRow } from "./libraryCache";

interface Filter {
  category?: string | null;
  q?: string;
  favorites?: boolean;
  tags?: string[];
  sortBy?: string;
}

export const useTemplateStore = defineStore("templates", () => {
  /** Every template (see `libraryCache.ts`: shallow, replaced on change). */
  const cache = createLibraryCache<TemplateRow>(() => api.templates.list({}));
  const catalog = cache.rows;
  const items = shallowRef<TemplateRow[]>([]);
  const loading = ref(false);
  const filter = reactive<Filter>({});
  /** Set once a list view has fetched `items`, so a library refresh only
   *  re-derives what some page has already loaded. */
  const listed = ref(false);
  let ticket = 0;

  function derive(): void {
    items.value = filterRows(catalog.value, filter);
  }

  function setCatalog(next: TemplateRow[]): void {
    cache.set(next);
    if (listed.value) derive();
  }

  /** The Templates page's rows for `filter`, filtered on the client (see
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

  async function fetchCatalog() {
    await cache.refresh();
    if (listed.value) derive();
  }

  async function ensureCatalog() {
    await cache.ensure();
  }

  async function get(id: string) {
    return await api.templates.get(id);
  }

  async function create(body: TemplateCreateInput) {
    const row = await api.templates.create(body);
    if (!listed.value) items.value = [row, ...items.value];
    setCatalog([row, ...catalog.value.filter((i) => i.id !== row.id)]);
    return row;
  }

  function replaced(updated: TemplateRow): void {
    if (!listed.value) items.value = replaceRow(items.value, updated);
    setCatalog(replaceRow(catalog.value, updated));
  }

  async function update(id: string, body: TemplateUpdateInput) {
    const updated = await api.templates.update(id, body);
    replaced(updated);
    return updated;
  }

  async function remove(id: string) {
    await api.templates.delete(id);
    markDeleted([id]);
    if (!listed.value) items.value = items.value.filter((i) => i.id !== id);
    setCatalog(catalog.value.filter((i) => i.id !== id));
  }

  async function toggleFavorite(id: string) {
    const updated = await api.templates.favorite(id);
    replaced(updated);
    return updated;
  }

  return {
    items, catalog, loading, filter, listed, catalogLoaded: cache.loaded,
    fetchAll, fetchCatalog, ensureCatalog, get, create, update, remove, toggleFavorite,
  };
});
