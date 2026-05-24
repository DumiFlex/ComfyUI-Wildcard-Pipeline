import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../api/client";
import type {
  CleanerPreset,
  CleanerPresetCreateInput,
  CleanerPresetUpdateInput,
} from "../api/types";

export const useCleanerPresetStore = defineStore("cleanerPresets", () => {
  const items = ref<CleanerPreset[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const builtins = computed(() => items.value.filter((p) => p.is_builtin));
  const userPresets = computed(() => items.value.filter((p) => !p.is_builtin));

  async function fetchAll(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const data = await api.cleanerPresets.list();
      items.value = data.items;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function findById(id: string): CleanerPreset | undefined {
    return items.value.find((p) => p.id === id);
  }

  async function create(body: CleanerPresetCreateInput): Promise<CleanerPreset> {
    const row = await api.cleanerPresets.create(body);
    items.value = [...items.value, row];
    return row;
  }

  async function update(
    id: string,
    body: CleanerPresetUpdateInput,
    options: { ifMatch?: number } = {},
  ): Promise<CleanerPreset> {
    const row = await api.cleanerPresets.update(id, body, options);
    items.value = items.value.map((p) => (p.id === id ? row : p));
    return row;
  }

  async function remove(id: string): Promise<void> {
    await api.cleanerPresets.delete(id);
    items.value = items.value.filter((p) => p.id !== id);
  }

  return {
    items, loading, error, builtins, userPresets,
    fetchAll, findById, create, update, remove,
  };
});
