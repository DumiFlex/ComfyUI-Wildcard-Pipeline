import { markDeleted } from "../composables/useLibraryChanged";
import { defineStore } from "pinia";
import { computed, reactive, ref, shallowRef } from "vue";
import { api } from "../api/client";
import type { ModuleCreateInput, ModuleRow, ModuleType, ModuleUpdateInput } from "../api/types";
import { createLibraryCache, filterRows, replaceRow } from "./libraryCache";

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
  /** Every module (see `libraryCache.ts`: shallow, replaced on change). */
  const cache = createLibraryCache<ModuleRow>(() => api.modules.list({}));
  const catalog = cache.rows;
  /** The active list page's rows: `catalog` through `filter`. */
  const items = shallowRef<ModuleRow[]>([]);
  const loading = ref(false);
  const filter = reactive<Filter>({});
  /** Set once a list view has fetched `items`, so a library refresh only
   *  re-derives what some page has already loaded. */
  const listed = ref(false);

  /** The kind the rows in `items` are, and the newest request. */
  let listedType: ModuleType | undefined;
  let ticket = 0;

  function derive(): void {
    items.value = filterRows(catalog.value, filter);
  }

  /** Swap the catalog and keep a list page's rows in step with it. */
  function setCatalog(next: ModuleRow[]): void {
    cache.set(next);
    if (listed.value) derive();
  }

  /**
   * The list page's rows for `filter`. Filters the catalog on the client
   * (the server would send the same rows with the same payloads), so a
   * search keystroke costs no request; the first call waits for the
   * catalog, later ones only revalidate a stale copy in the background.
   */
  async function fetchAll() {
    const mine = ++ticket;
    // Another kind's page (Wildcards → Constraints) must not show the last
    // kind's rows under its columns while it loads; a search or filter on
    // the same kind keeps them up until the new ones land.
    if (filter.type !== listedType) {
      if (!cache.loaded.value) items.value = [];
      listedType = filter.type;
    }
    const waiting = !cache.loaded.value;
    if (waiting) loading.value = true;
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
   * Fetch the full module catalog, ignoring the persistent `filter.*` state.
   *
   * The permanent unfiltered cache read by list pages, sidebar count
   * badges, Cmd+K palette, and editors that need cross-kind references
   * (`$var` autocomplete, Constraint wildcard pickers, …). Editors must read
   * `store.catalog` for cross-refs, not `store.items` (which is scoped to the
   * current list view's filter). A page that only needs it present calls
   * `ensureCatalog()`, which doesn't send a second request.
   */
  async function fetchCatalog() {
    await cache.refresh();
    if (listed.value) derive();
  }

  /** The catalog, without a request when a fresh copy is there. */
  async function ensureCatalog() {
    await cache.ensure();
  }

  async function get(id: string) {
    return await api.modules.get(id);
  }

  async function create(body: ModuleCreateInput) {
    const row = await api.modules.create(body);
    if (!listed.value) items.value = [row, ...items.value];
    setCatalog([row, ...catalog.value.filter((i) => i.id !== row.id)]);
    return row;
  }

  function replaced(updated: ModuleRow): void {
    if (!listed.value) items.value = replaceRow(items.value, updated);
    setCatalog(replaceRow(catalog.value, updated));
  }

  async function update(id: string, body: ModuleUpdateInput) {
    const updated = await api.modules.update(id, body);
    replaced(updated);
    return updated;
  }

  async function remove(id: string) {
    await api.modules.delete(id);
    removeLocal(id);
  }

  /** Drop a row from the local store without hitting the API.
   *
   * Used after a cascade-apply that already deleted the row server-side
   * (cascade flow owns the network call; this just keeps the in-memory
   * list in sync). Calling `remove(id)` here would round-trip a second
   * DELETE and 404. */
  function removeLocal(id: string) {
    markDeleted([id]);
    if (!listed.value) items.value = items.value.filter((i) => i.id !== id);
    setCatalog(catalog.value.filter((i) => i.id !== id));
  }

  async function duplicate(id: string) {
    const copy = await api.modules.duplicate(id);
    if (!listed.value) items.value = [copy, ...items.value];
    setCatalog([copy, ...catalog.value.filter((i) => i.id !== copy.id)]);
    return copy;
  }

  async function toggleFavorite(id: string) {
    const updated = await api.modules.favorite(id);
    replaced(updated);
    return updated;
  }

  const wildcards = computed(() => items.value.filter((i) => i.type === "wildcard"));
  const fixedValues = computed(() => items.value.filter((i) => i.type === "fixed_values"));

  return {
    items, catalog, loading, filter, listed, catalogLoaded: cache.loaded,
    fetchAll, fetchCatalog, ensureCatalog, get, create, update, remove, removeLocal, duplicate,
    toggleFavorite, wildcards, fixedValues,
  };
});
