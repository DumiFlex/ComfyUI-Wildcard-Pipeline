<script setup lang="ts">
/**
 * Collapsible picker section: header (title + count + section-checkbox +
 * "selected / total" caption) over a slot of PickerRow children.
 *
 * Pure presentational. Selection logic stays in the parent — section
 * emits `toggle-all` when the user clicks the section-checkbox; parent
 * decides what "select all of this bucket" actually means.
 *
 * Section-checkbox tri-state: checked when all rows are selected,
 * indeterminate when some are selected, unchecked when none.
 */
import { ref, computed } from "vue";
import Checkbox from "../components/ui/Checkbox.vue";

interface Props {
  title: string;
  totalCount: number;
  selectedCount: number;
  /** Whether the body starts expanded. Defaults to true. */
  defaultOpen?: boolean;
}

const props = withDefaults(defineProps<Props>(), { defaultOpen: true });
const emit = defineEmits<{ (e: "toggle-all", v: boolean): void }>();

const open = ref<boolean>(props.defaultOpen);
const allSelected = computed<boolean>(
  () => props.totalCount > 0 && props.selectedCount === props.totalCount,
);
const indeterminate = computed<boolean>(
  () => props.selectedCount > 0 && props.selectedCount < props.totalCount,
);
</script>

<template>
  <section class="wp-picker-section">
    <header class="wp-picker-section__header">
      <button
        type="button"
        class="wp-picker-section__toggle"
        :aria-expanded="open"
        :aria-label="open ? 'Collapse section' : 'Expand section'"
        @click="open = !open"
      >
        {{ open ? "▼" : "▶" }}
      </button>
      <span class="wp-picker-section__title">{{ title }} ({{ totalCount }})</span>
      <Checkbox
        class="wp-picker-section__check"
        :model-value="allSelected"
        :indeterminate="indeterminate"
        :aria-label="`Select all ${title}`"
        @update:model-value="(v: boolean) => emit('toggle-all', v)"
      />
      <span class="wp-picker-section__count">
        {{ selectedCount }} / {{ totalCount }} selected
      </span>
    </header>
    <div v-if="open" class="wp-picker-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.wp-picker-section {
  margin-bottom: 16px;
}
.wp-picker-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--wp-border);
}
.wp-picker-section__toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 4px;
  color: var(--wp-text2);
  font-family: var(--wp-font-mono);
  font-size: 12px;
  line-height: 1;
}
.wp-picker-section__toggle:hover {
  color: var(--wp-text);
}
.wp-picker-section__title {
  font-weight: 600;
  color: var(--wp-text);
  font-family: var(--wp-font-sans);
}
.wp-picker-section__count {
  margin-left: auto;
  font-size: 12px;
  color: var(--wp-text2);
  font-family: var(--wp-font-sans);
}
.wp-picker-section__body {
  padding-top: 4px;
}
</style>
