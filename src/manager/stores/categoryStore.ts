import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api/client";
import type { CategoryCreateInput, CategoryRow } from "../api/types";

/** The app stores a PrimeIcons name bare ("user") and draws it as
 *  `pi pi-<name>`. Rows made by hand, by older seed scripts or by an import
 *  can carry "pi-user" or "pi pi-user", which drew as "pi-pi-user": no icon,
 *  just an empty gap before the name. */
export function bareIconName(icon: string | null | undefined): string | null {
  if (!icon) return icon ?? null;
  const name = icon.trim().replace(/^pi\s+/, "").replace(/^pi-/, "");
  return name || null;
}

function clean(row: CategoryRow): CategoryRow {
  const icon = bareIconName(row.icon);
  return icon === row.icon ? row : { ...row, icon };
}

export const useCategoryStore = defineStore("categories", () => {
  const items = ref<CategoryRow[]>([]);
  const loading = ref(false);
  /** Set once the list has been fetched, so a library refresh only
   *  re-fetches what some page has already loaded. */
  const listed = ref(false);

  async function fetchAll() {
    loading.value = true;
    try {
      const res = await api.categories.list();
      items.value = res.items.map(clean);
      listed.value = true;
    } finally {
      loading.value = false;
    }
  }

  async function create(body: CategoryCreateInput) {
    const row = clean(await api.categories.create(body));
    items.value.push(row);
    return row;
  }

  async function update(id: string, body: Partial<CategoryCreateInput>) {
    const row = clean(await api.categories.update(id, body));
    const idx = items.value.findIndex((c) => c.id === id);
    if (idx >= 0) items.value[idx] = row;
    return row;
  }

  async function remove(id: string) {
    await api.categories.delete(id);
    removeLocal(id);
  }

  /** Drop a row the cascade flow already deleted on the server. Calling
   *  `remove(id)` there sends a second DELETE, which 404s and throws
   *  before the row leaves the list. */
  function removeLocal(id: string) {
    items.value = items.value.filter((c) => c.id !== id);
  }

  return { items, loading, listed, fetchAll, create, update, remove, removeLocal };
});
