<script setup lang="ts">
/**
 * BulkDeleteToolbar — the kit SelectionBar with one action, Delete, for
 * editors whose rows have nothing to bulk-set (fixed-values, constraint
 * exceptions, derivation rules). The richer wildcard bar (apply/remove
 * sub-category, set weight) is SelectionToolbar.
 *
 * Presentational: emits `delete-selected` / `clear`; the host mutates rows +
 * tracks dirty.
 */
import Button from "@/kit/Button.vue";
import SelectionBar from "@/kit/SelectionBar.vue";

defineProps<{
  count: number;
  /** Plural noun for the Delete label, e.g. "values" → "Delete 3 values". */
  noun?: string;
}>();

const emit = defineEmits<{
  (e: "delete-selected"): void;
  (e: "clear"): void;
}>();
</script>

<template>
  <SelectionBar :count="count" @clear="emit('clear')">
    <Button
      variant="danger"
      size="sm"
      icon="pi-trash"
      :disabled="count === 0"
      data-test="bulk-delete"
      @click="emit('delete-selected')"
    >Delete{{ noun ? ` ${count} ${noun}` : "" }}</Button>
  </SelectionBar>
</template>
