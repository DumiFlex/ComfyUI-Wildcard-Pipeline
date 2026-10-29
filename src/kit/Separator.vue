<script setup lang="ts">
/**
 * Separator: a thin line between groups, across or upright, with optional
 * text in the middle ("or"). Works on the canvas and in the manager.
 *
 *   <Separator />
 *   <Separator label="or" />
 *   <Separator orientation="vertical" />   (inside a Toolbar or a row)
 *
 * It is decorative by default (screen readers skip it). Set
 * `decorative=false` when it really divides two parts of the content.
 */
withDefaults(defineProps<{
  orientation?: "horizontal" | "vertical";
  /** Text in the middle of a horizontal line. */
  label?: string;
  decorative?: boolean;
  /** Room around the line. */
  spacing?: "none" | "sm" | "md" | "lg";
}>(), { orientation: "horizontal", label: undefined, decorative: true, spacing: "sm" });
</script>

<template>
  <div
    class="wp-separator"
    :data-orientation="orientation"
    :data-spacing="spacing"
    :data-labelled="label ? 'true' : undefined"
    :role="decorative ? 'none' : 'separator'"
    :aria-orientation="!decorative && orientation === 'vertical' ? 'vertical' : undefined"
  >
    <span v-if="label && orientation === 'horizontal'" class="wp-separator__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.wp-separator { flex: none; align-self: stretch; }
.wp-separator[data-orientation="horizontal"] { height: 1px; width: 100%; background: var(--wp-border); }
.wp-separator[data-orientation="vertical"] { width: 1px; min-height: 1em; background: var(--wp-border); }
.wp-separator[data-orientation="horizontal"][data-spacing="sm"] { margin: var(--wp-space-3) 0; }
.wp-separator[data-orientation="horizontal"][data-spacing="md"] { margin: var(--wp-space-5) 0; }
.wp-separator[data-orientation="horizontal"][data-spacing="lg"] { margin: var(--wp-space-7) 0; }
.wp-separator[data-orientation="vertical"][data-spacing="sm"] { margin: 0 var(--wp-space-2); }
.wp-separator[data-orientation="vertical"][data-spacing="md"] { margin: 0 var(--wp-space-4); }
.wp-separator[data-orientation="vertical"][data-spacing="lg"] { margin: 0 var(--wp-space-6); }
.wp-separator[data-labelled] {
  display: flex; align-items: center; gap: var(--wp-space-4); height: auto; background: none;
  color: var(--wp-text-dim); font: 600 var(--wp-text-xs)/1 var(--wp-font-sans);
  text-transform: uppercase; letter-spacing: 0.06em;
}
.wp-separator[data-labelled]::before, .wp-separator[data-labelled]::after {
  content: ""; flex: 1; height: 1px; background: var(--wp-border);
}
</style>
