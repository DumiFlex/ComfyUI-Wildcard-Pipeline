<script setup lang="ts">
/**
 * A pill you press to turn a filter or flag on and off: a tag filter, a
 * module-type filter, "Recommended" on a version, a category you pick.
 * `pressed` lights it in the accent, or in `color` (a kind colour, a
 * category's colour) when given; with `color` the icon wears it even when
 * off, so a row of type filters reads at a glance. `count` shows a small
 * number after the label.
 *
 *   <ChipToggle :pressed="tag === t.slug" icon="pi-tag" :count="t.usage" @click="pick(t)">{{ t.name }}</ChipToggle>
 *   <ChipToggle :pressed="kind === 'wildcard'" color="var(--wp-kind-wildcard)" icon="pi-sparkles">Wildcard</ChipToggle>
 *
 * A real `<button>` with `aria-pressed`; it reads only the shared tokens, so
 * it works on a page and on the canvas.
 */
import { computed } from "vue";
import Icon from "./Icon.vue";

const props = withDefaults(defineProps<{
  pressed?: boolean | undefined;
  /** PrimeIcons name (`tag` or `pi-tag`) before the label. */
  icon?: string | undefined;
  /** Tint when pressed (and of the icon): any CSS colour. Default the accent. */
  color?: string | null | undefined;
  count?: number | string | undefined;
  size?: "sm" | "md" | undefined;
  disabled?: boolean | undefined;
}>(), { pressed: false, size: "sm" });

const style = computed(() => (props.color ? { "--chip-toggle-c": props.color } : undefined));
</script>

<template>
  <button
    type="button"
    class="wp-chip-toggle"
    :class="[`wp-chip-toggle--${size}`, { 'wp-chip-toggle--tinted': !!color }]"
    :style="style"
    :aria-pressed="pressed"
    :disabled="disabled"
  >
    <Icon v-if="icon" class="wp-chip-toggle__icon" :name="icon" :size="11" />
    <span class="wp-chip-toggle__label"><slot /></span>
    <span v-if="count !== undefined" class="wp-chip-toggle__count">{{ count }}</span>
  </button>
</template>

<style scoped>
.wp-chip-toggle {
  --chip-toggle-c: var(--wp-accent-500);
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  height: var(--wp-control-h-sm);
  padding: 0 var(--wp-space-4);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  font: inherit;
  font-family: var(--wp-font-sans);
  font-size: var(--wp-text-sm);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--wp-motion-quick) ease, border-color var(--wp-motion-quick) ease, color var(--wp-motion-quick) ease;
}
.wp-chip-toggle--md { height: var(--wp-control-h-md); padding: 0 var(--wp-space-5); font-size: var(--wp-text-base); }
.wp-chip-toggle:hover:not(:disabled) { border-color: var(--wp-border-strong); color: var(--wp-text); }
.wp-chip-toggle:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.wp-chip-toggle:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-chip-toggle--tinted .wp-chip-toggle__icon { color: var(--chip-toggle-c); }
.wp-chip-toggle[aria-pressed="true"] {
  border-color: color-mix(in oklab, var(--chip-toggle-c) 45%, transparent);
  background: color-mix(in oklab, var(--chip-toggle-c) 16%, transparent);
  color: var(--wp-accent-text-strong);
}
.wp-chip-toggle--tinted[aria-pressed="true"] { color: var(--chip-toggle-c); }
.wp-chip-toggle__count {
  padding: 1px var(--wp-space-3);
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-bg-4, var(--wp-bg-2));
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-xs);
}
.wp-chip-toggle[aria-pressed="true"] .wp-chip-toggle__count {
  background: color-mix(in oklab, var(--chip-toggle-c) 22%, transparent);
  color: inherit;
}
</style>
