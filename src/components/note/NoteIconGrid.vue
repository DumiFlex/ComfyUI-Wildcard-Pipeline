<script setup lang="ts">
import { computed, ref } from "vue";
import { vTooltip } from "../../kit/tooltip";
import { PI_ICONS } from "./pi-icons";

/** Every PrimeIcons glyph in a grid you can search. Emits the picked name
 *  (no `pi-` prefix). `selected` marks the current one. */
const props = withDefaults(defineProps<{
  selected?: string | undefined;
  color?: string | undefined;
  /** Offer "No icon" first. */
  allowNone?: boolean | undefined;
}>(), { selected: "", color: "", allowNone: false });

const emit = defineEmits<{ (e: "pick", icon: string): void }>();

const query = ref("");
const shown = computed(() => {
  const q = query.value.trim().toLowerCase().replace(/^pi-/, "").replace(/\s+/g, "-");
  return q ? PI_ICONS.filter((n) => n.includes(q)) : PI_ICONS;
});
function words(name: string): string {
  return name.replace(/-/g, " ");
}
</script>

<template>
  <div class="wp-note-icons" data-test="note-icon-grid">
    <input
      v-model="query"
      class="wp-note-icons__search"
      type="search"
      placeholder="Search icons…"
      aria-label="Search icons"
      data-test="note-icon-search"
    />
    <div class="wp-note-icons__grid" role="listbox" aria-label="Icons">
      <button
        v-if="allowNone"
        v-tooltip="'No icon'"
        type="button"
        role="option"
        class="wp-note-icons__cell"
        :aria-selected="!selected"
        aria-label="No icon"
        data-test="note-icon-none"
        @click="emit('pick', '')"
      ><i class="pi pi-ban" aria-hidden="true"></i></button>
      <button
        v-for="name in shown"
        :key="name"
        v-tooltip="words(name)"
        type="button"
        role="option"
        class="wp-note-icons__cell"
        :aria-selected="name === selected"
        :aria-label="words(name)"
        :data-test="`note-icon-${name}`"
        @click="emit('pick', name)"
      ><i class="pi" :class="`pi-${name}`" :style="props.color ? { color: props.color } : undefined" aria-hidden="true"></i></button>
      <p v-if="!shown.length" class="wp-note-icons__empty">No icon matches "{{ query }}".</p>
    </div>
  </div>
</template>

<style scoped>
.wp-note-icons { display: flex; flex-direction: column; gap: 6px; }
.wp-note-icons__search {
  box-sizing: border-box;
  width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-3, transparent);
  color: var(--wp-text);
  font: inherit;
  font-size: 12px;
}
.wp-note-icons__search:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 1px; }
.wp-note-icons__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
  gap: 2px;
  max-height: 148px;
  overflow-y: auto;
}
.wp-note-icons__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: none;
  color: var(--wp-text-muted, var(--wp-text));
  cursor: pointer;
}
.wp-note-icons__cell .pi { font-size: 14px; }
.wp-note-icons__cell:hover { background: var(--wp-bg-4, var(--wp-bg-3)); color: var(--wp-text); }
.wp-note-icons__cell[aria-selected="true"] { border-color: var(--wp-accent); background: color-mix(in srgb, var(--wp-accent) 18%, transparent); }
.wp-note-icons__cell:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 1px; }
.wp-note-icons__empty { grid-column: 1 / -1; margin: 4px 0; color: var(--wp-text-dim); font-size: 12px; }
</style>
