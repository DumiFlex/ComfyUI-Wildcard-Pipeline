<script setup lang="ts">
import { ref, watch } from "vue";

interface Props {
  /** Sub-categories declared by the picked wildcard's payload. */
  subCategories: string[];
  /** Initial selection — empty for fresh insert, prepopulated for edit. */
  initialSelection: string[];
  /** "insert" hides the Delete button; "edit" shows it. */
  mode: "insert" | "edit";
}

const props = withDefaults(defineProps<Props>(), {
  initialSelection: () => [],
  mode: "insert",
});

const emit = defineEmits<{
  /** User confirmed a filter selection (possibly empty). */
  "apply": [subCategories: string[]];
  /** User wants to insert / keep the ref WITHOUT a filter. */
  "skip": [];
  /** Edit mode only — user wants to remove the ref entirely. */
  "delete": [];
}>();

const selected = ref<Set<string>>(new Set(props.initialSelection));

// External prop changes (e.g. opening the picker on a different chip)
// reset the local selection.
watch(() => props.initialSelection, (next) => {
  selected.value = new Set(next);
});

function toggle(subcat: string): void {
  if (selected.value.has(subcat)) selected.value.delete(subcat);
  else selected.value.add(subcat);
  // Trigger reactivity — Vue 3's reactive Set wrappers don't track .add/.delete
  // on a plain Set referenced through ref(), so reassign.
  selected.value = new Set(selected.value);
}

function onApply(): void {
  // Preserve the input order of subCategories so applied output is stable.
  const ordered = props.subCategories.filter((s) => selected.value.has(s));
  emit("apply", ordered);
}
</script>

<template>
  <div class="wp-subcat-picker" data-test="subcat-picker">
    <div v-if="subCategories.length === 0" class="wp-subcat-picker__hint">
      This wildcard has no sub-categories declared — no filter possible.
    </div>
    <div v-else class="wp-subcat-picker__chips">
      <button
        v-for="sub in subCategories"
        :key="sub"
        type="button"
        class="wp-subcat-chip"
        :class="{ 'wp-subcat-chip--selected': selected.has(sub) }"
        :data-test="'subcat-chip'"
        :data-value="sub"
        @click="toggle(sub)"
      >
        <span v-if="selected.has(sub)" aria-hidden="true">✓</span>
        {{ sub }}
      </button>
    </div>
    <div class="wp-subcat-picker__actions">
      <button
        v-if="mode === 'edit'"
        type="button"
        class="wp-btn wp-btn--danger"
        data-test="picker-delete"
        @click="emit('delete')"
      >Delete</button>
      <button
        type="button"
        class="wp-btn"
        data-test="picker-skip"
        @click="emit('skip')"
      >Skip</button>
      <button
        type="button"
        class="wp-btn wp-btn--primary"
        data-test="picker-apply"
        @click="onApply"
      >Apply</button>
    </div>
  </div>
</template>

<style scoped>
.wp-subcat-picker {
  padding: 10px 12px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-accent);
  border-radius: 6px;
  min-width: 200px;
}
.wp-subcat-picker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.wp-subcat-chip {
  padding: 3px 9px;
  border-radius: 11px;
  border: 1px solid var(--wp-border);
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-subcat-chip--selected {
  background: color-mix(in srgb, #22c55e 25%, transparent);
  border-color: color-mix(in srgb, #22c55e 60%, transparent);
  color: #fff;
}
.wp-subcat-picker__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.wp-subcat-picker__hint {
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  padding: 4px 0;
}
</style>
