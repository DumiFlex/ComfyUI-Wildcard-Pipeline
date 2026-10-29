<script setup lang="ts">
/**
 * Badge: a count bubble or a status dot. On its own it sits in the line of
 * text; wrapped around something (a button, an icon, an avatar) it sits on
 * that thing's top-right corner. Works on the canvas and in the manager.
 *
 *   <Badge :count="3" tone="danger" label="3 conflicts"><Button icon="pi-bell" aria-label="Problems" /></Badge>
 *   <Badge dot tone="success" text="Running" />
 *   <Badge dot tone="warn" label="Out of date" />
 *
 * Colour is never the only signal: a dot without `text` needs a `label`,
 * which screen readers read in its place. Counts over `max` read
 * "99+". A count of 0 hides the badge unless `show-zero`.
 */
import { computed, useSlots } from "vue";

const props = withDefaults(defineProps<{
  count?: number;
  /** Counts above this read "max+". */
  max?: number;
  /** A dot instead of a number. */
  dot?: boolean;
  tone?: "neutral" | "info" | "success" | "warn" | "danger" | "accent";
  /** Visible text after the dot or count (a status line). */
  text?: string;
  /** Name for screen readers when the badge has no text, e.g. "3 conflicts". */
  label?: string;
  /** Show a count of 0 instead of hiding the badge. */
  showZero?: boolean;
  /** Draw the dot as a soft pulse (something is running). */
  pulse?: boolean;
}>(), { count: undefined, max: 99, tone: "accent", text: undefined, label: undefined });

const slots = useSlots();
const anchored = computed(() => !!slots.default);
const shown = computed(() => props.dot || (props.count !== undefined && (props.count > 0 || props.showZero)));
const countText = computed(() =>
  props.count === undefined ? "" : props.count > props.max ? `${props.max}+` : String(props.count),
);
</script>

<template>
  <span v-if="anchored" class="wp-badge-anchor">
    <slot />
    <span v-if="shown" class="wp-badge wp-badge--corner" :data-tone="tone" :data-dot="dot || undefined" :data-pulse="pulse || undefined" aria-hidden="true"><template v-if="!dot">{{ countText }}</template></span>
    <span v-if="shown && (label || countText)" class="wp-badge__sr">{{ label ?? countText }}</span>
  </span>
  <span v-else-if="shown || text" class="wp-badge-line" :data-tone="tone">
    <span v-if="shown" class="wp-badge" :data-tone="tone" :data-dot="dot || undefined" :data-pulse="pulse || undefined" aria-hidden="true"><template v-if="!dot">{{ countText }}</template></span>
    <span v-if="!text && (label || countText)" class="wp-badge__sr">{{ label ?? countText }}</span>
    <span v-if="text" class="wp-badge-line__text">{{ text }}</span>
  </span>
</template>

<style scoped>
.wp-badge-anchor { position: relative; display: inline-flex; }
.wp-badge__sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.wp-badge-line {
  display: inline-flex; align-items: center; gap: var(--wp-space-2); min-width: 0;
  color: var(--wp-text-muted); font: 500 var(--wp-text-xs)/1.2 var(--wp-font-sans);
}
.wp-badge-line__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-badge {
  --_tone: var(--wp-accent);
  display: inline-grid; place-items: center; flex: none; box-sizing: border-box;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: var(--wp-radius-cap, 999px); background: var(--_tone); color: var(--wp-bg);
  font: 600 10.5px/1 var(--wp-font-sans); font-variant-numeric: tabular-nums;
}
.wp-badge[data-tone="neutral"] { --_tone: var(--wp-text-dim); }
.wp-badge[data-tone="info"] { --_tone: var(--wp-info); }
.wp-badge[data-tone="success"] { --_tone: var(--wp-success); }
.wp-badge[data-tone="warn"] { --_tone: var(--wp-warn); }
.wp-badge[data-tone="danger"] { --_tone: var(--wp-danger); }
.wp-badge[data-dot] { min-width: 0; width: 8px; height: 8px; padding: 0; }
.wp-badge--corner {
  position: absolute; top: 0; right: 0; transform: translate(40%, -40%);
  box-shadow: 0 0 0 2px var(--wp-bg-1); pointer-events: none;
}
.wp-badge--corner[data-dot] { transform: translate(25%, -25%); }
.wp-badge[data-pulse]::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--_tone);
  animation: wp-badge-pulse 1.6s ease-out infinite;
}
.wp-badge[data-pulse] { position: relative; }
.wp-badge--corner[data-pulse] { position: absolute; }
@keyframes wp-badge-pulse {
  from { opacity: 0.6; transform: scale(1); }
  to { opacity: 0; transform: scale(2.4); }
}
@media (prefers-reduced-motion: reduce) {
  .wp-badge[data-pulse]::after { animation: none; display: none; }
}
</style>
