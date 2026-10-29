<script setup lang="ts">
/**
 * Visually hidden: text for screen readers only (a table header with no
 * visible name, "(opens in a new tab)", a live status line). With
 * `focusable` it shows itself while it has focus, for a "Skip to the list"
 * link. Works on the canvas and in the manager.
 *
 *   <VisuallyHidden>Select</VisuallyHidden>
 *   <VisuallyHidden as="div" aria-live="polite">{{ status }}</VisuallyHidden>
 */
withDefaults(defineProps<{
  /** The element to draw. */
  as?: string;
  /** Show while focused (skip links). */
  focusable?: boolean;
}>(), { as: "span" });
</script>

<template>
  <component :is="as" class="wp-visually-hidden" :data-focusable="focusable || undefined"><slot /></component>
</template>

<style scoped>
.wp-visually-hidden:not([data-focusable]),
.wp-visually-hidden[data-focusable]:not(:focus):not(:focus-within) {
  position: absolute !important; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
</style>
