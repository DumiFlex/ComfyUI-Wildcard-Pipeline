<script setup lang="ts" generic="T extends { id: string }">
import { computed, ref, watch } from "vue";
import DataTable from "primevue/datatable";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import { useConfirm } from "primevue/useconfirm";
import ConfirmDialog from "primevue/confirmdialog";

interface Filter { q?: string; favorites?: boolean; }

const props = defineProps<{
  title: string;
  subtitle: string;
  newLabel: string;
  newRoute: string;
  items: T[];
  loading: boolean;
  filter: Filter;
  emptyMessage: string;
}>();

const emit = defineEmits<{
  fetch: [];
  delete: [item: T];
  bulkDelete: [items: T[]];
}>();

const confirm = useConfirm();
const search = ref(props.filter.q ?? "");
const filterPanelOpen = ref(false);
const selected = ref<T[]>([]);
const expandedRows = ref<Record<string, boolean>>({});

// Public asset served by aiohttp at runtime — use dynamic binding so Vite
// does not try to inline/copy the file during the manager SPA build.
const faviconUrl = "/wp/images/favicon.svg";

watch(search, async (q) => {
  props.filter.q = q || undefined;
  emit("fetch");
});

const activeFilterCount = computed(() => {
  let n = 0;
  if (props.filter.q) n++;
  if (props.filter.favorites) n++;
  return n;
});

function clearFilters() {
  search.value = "";
  props.filter.q = undefined;
  props.filter.favorites = false;
  emit("fetch");
}

function rowClass(row: T): string {
  return (row as T & { is_favorite?: boolean }).is_favorite ? "wp-row-favorite" : "";
}

function confirmBulkDelete() {
  confirm.require({
    message: `Delete ${selected.value.length} selected items?`,
    header: "Confirm bulk delete",
    icon: "pi pi-exclamation-triangle",
    acceptClass: "p-button-danger",
    accept: () => {
      emit("bulkDelete", [...(selected.value as T[])]);
      selected.value = [];
    },
  });
}
</script>

<template>
  <div class="p-6 text-wp-text">
    <ConfirmDialog />

    <div class="flex items-end justify-between mb-4">
      <div>
        <h1 class="text-xl font-semibold m-0">{{ title }}</h1>
        <p class="text-sm text-wp-text2 m-0 mt-1">{{ subtitle }}</p>
      </div>
      <Button :label="newLabel" icon="pi pi-plus" severity="primary" @click="$router.push(newRoute)" />
    </div>

    <div class="flex gap-2 mb-3 items-center flex-wrap">
      <IconField>
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" placeholder="Search by name…" class="w-64" />
      </IconField>
      <Button
        :label="activeFilterCount ? `Filters (${activeFilterCount})` : 'Filters'"
        icon="pi pi-filter"
        :severity="activeFilterCount ? 'primary' : 'secondary'"
        outlined size="small"
        @click="filterPanelOpen = !filterPanelOpen"
      />
      <span class="ml-auto text-xs text-wp-text2">{{ items.length }} item(s)</span>
    </div>

    <div v-if="filterPanelOpen" class="filter-panel mb-3">
      <slot name="filter-panel" :filter="filter" :emit-fetch="() => emit('fetch')" />
    </div>

    <div v-if="activeFilterCount" class="flex gap-2 mb-3 items-center flex-wrap">
      <span class="text-xs text-wp-text2">Active:</span>
      <span v-if="filter.q" class="filter-chip filter-chip--search">
        name: {{ filter.q }}
        <i class="pi pi-times" @click="search = ''" />
      </span>
      <span v-if="filter.favorites" class="filter-chip filter-chip--favorite">
        favorites only
        <i class="pi pi-times" @click="filter.favorites = false; emit('fetch')" />
      </span>
      <Button label="Clear all" text size="small" @click="clearFilters" />
    </div>

    <div v-if="selected.length" class="flex justify-between items-center bulk-bar mb-3">
      <span class="text-sm">
        <strong class="text-wp-accent">{{ selected.length }}</strong> selected
      </span>
      <div class="flex gap-2">
        <Button label="Clear" text size="small" @click="selected = []" />
        <Button
          label="Delete selected" icon="pi pi-trash" severity="danger" outlined size="small"
          @click="confirmBulkDelete"
        />
      </div>
    </div>

    <DataTable
      v-model:selection="selected"
      v-model:expandedRows="expandedRows"
      :value="items" :loading="loading" data-key="id"
      :rows="20" :paginator="items.length > 20"
      :row-class="rowClass"
    >
      <slot name="columns" />
      <template v-if="$slots.expansion" #expansion="slotProps">
        <slot name="expansion" v-bind="slotProps" />
      </template>
      <template #empty>
        <div class="text-center p-8">
          <img :src="faviconUrl" alt="" class="mx-auto mb-3 opacity-70" style="width:64px;height:64px" />
          <p class="text-wp-text2 mb-3">{{ emptyMessage }}</p>
          <Button :label="newLabel" icon="pi pi-plus" severity="primary" @click="$router.push(newRoute)" />
        </div>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.filter-panel {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 12px;
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 11px;
  font-size: 11px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg2);
}
.filter-chip--search { color: var(--wp-accent); border-color: var(--wp-accent); background: var(--wp-accent-glow); }
.filter-chip--favorite { color: var(--wp-amber); border-color: var(--wp-amber); }
.filter-chip i { cursor: pointer; opacity: 0.7; }
.filter-chip i:hover { opacity: 1; }
.bulk-bar {
  background: var(--wp-accent-glow);
  border: 1px solid var(--wp-accent);
  border-radius: var(--wp-radius);
  padding: 8px 12px;
}
:deep(.wp-row-favorite) {
  border-left: 2px solid var(--wp-amber);
}
</style>
