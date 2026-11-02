<script setup lang="ts">
/**
 * The six-dot grip on a row you drag to reorder (a module row, a bundle
 * child, an injector binding). It only shows where to grab: the row owns the
 * drag (HTML drag-and-drop or pointer events), so the grip is hidden from
 * screen readers and the row gives keyboard users their own way to move it.
 * For a list that the kit should reorder itself, with keyboard moves, use
 * SortableList.
 *
 *   <DragHandle />            the canvas row size
 *   <DragHandle size="md" />  a manager row
 *
 * Reads only the shared tokens, so it works on the canvas and on a page.
 */
withDefaults(defineProps<{
  size?: "sm" | "md" | undefined;
  /** Tooltip on hover. */
  title?: string | undefined;
}>(), { size: "sm", title: "Drag to reorder" });
</script>

<template>
  <span class="wp-drag-grip" :data-size="size" :title="title" aria-hidden="true">
    <svg viewBox="0 0 6 12" fill="currentColor" focusable="false">
      <circle cx="1.5" cy="2" r="1" />
      <circle cx="4.5" cy="2" r="1" />
      <circle cx="1.5" cy="6" r="1" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="1.5" cy="10" r="1" />
      <circle cx="4.5" cy="10" r="1" />
    </svg>
  </span>
</template>

<style scoped>
.wp-drag-grip {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: 12px;
  height: 20px;
  color: var(--wp-text-dim);
  cursor: grab;
}
.wp-drag-grip[data-size="md"] { width: 16px; height: 24px; }
.wp-drag-grip svg { width: 6px; height: 12px; }
.wp-drag-grip[data-size="md"] svg { width: 8px; height: 16px; }
.wp-drag-grip:hover { color: var(--wp-text-muted); }
</style>
