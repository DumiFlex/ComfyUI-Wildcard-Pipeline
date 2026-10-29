<script setup lang="ts">
import Button from "../../components/ui/Button.vue";
import DropdownMenu from "@/kit/DropdownMenu.vue";
import type { ContextMenuEntry } from "@/kit/ContextMenu.vue";
import { useToast } from "../../composables/useToast";

const toast = useToast();
const did = (what: string) => () => toast.push({ severity: "success", summary: what });
const items: ContextMenuEntry[] = [
  { label: "Rename", icon: "pi-pencil", onSelect: did("Renamed") },
  { label: "Duplicate", icon: "pi-copy", onSelect: did("Duplicated") },
  { label: "Move to category", icon: "pi-folder", subtitle: "Characters", onSelect: did("Moved") },
  { section: "Danger" },
  { label: "Delete", icon: "pi-trash", danger: true, onSelect: did("Deleted") },
];
</script>

<template>
  <DropdownMenu :items="items" label="Hair colour actions" :header="{ icon: 'pi-th-large', label: 'Wildcard · Hair colour' }">
    <template #trigger="{ props }">
      <Button v-bind="props" variant="ghost" icon="pi-ellipsis-h" />
    </template>
  </DropdownMenu>
  <DropdownMenu :items="items" placement="bottom-end">
    <template #trigger="{ props }">
      <Button v-bind="props" icon="pi-chevron-down">More</Button>
    </template>
  </DropdownMenu>
</template>
