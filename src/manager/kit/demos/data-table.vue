<script setup lang="ts">
import { ref } from "vue";
import DataTable, { type DataColumn, type DataSort } from "../../components/ui/DataTable.vue";
import Chip from "../../components/ui/Chip.vue";
import Button from "../../components/ui/Button.vue";

interface Row { id: string; tag: string; modules: number; bundles: number }
const rows: Row[] = [
  { id: "a", tag: "hair", modules: 12, bundles: 2 },
  { id: "b", tag: "lighting", modules: 7, bundles: 0 },
  { id: "c", tag: "pose", modules: 21, bundles: 4 },
  { id: "d", tag: "outfit", modules: 3, bundles: 1 },
];
const columns: DataColumn<Row>[] = [
  { key: "tag", label: "Tag", sortable: true },
  { key: "modules", label: "Modules", sortable: true, align: "right", mono: true, firstDir: "desc", width: "110px" },
  { key: "bundles", label: "Bundles", sortable: true, align: "right", mono: true, firstDir: "desc", width: "110px" },
  { key: "actions", label: "Actions", hideLabel: true, align: "right", width: "60px" },
];
const sort = ref<DataSort | null>({ key: "modules", dir: "desc" });
const picked = ref<string[]>(["c"]);
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <DataTable v-model:sort="sort" v-model:selected="picked" :columns="columns" :rows="rows" row-key="id" selectable aria-label="Tags">
      <template #cell-tag="{ row }"><Chip tone="accent">{{ row.tag }}</Chip></template>
      <template #cell-actions="{ row }"><Button size="sm" variant="ghost" icon="pi-trash" :aria-label="`Delete ${row.tag}`" /></template>
    </DataTable>
    <p class="wp-kit__muted">{{ picked.length }} selected. Loading and empty:</p>
    <DataTable :columns="columns.slice(0, 3)" :rows="[]" row-key="id" loading :loading-rows="2" size="sm" aria-label="Loading" />
    <DataTable :columns="columns.slice(0, 3)" :rows="[]" row-key="id" size="sm" empty-text="No tags yet." aria-label="Empty" />
  </div>
</template>
