<!-- src/manager/components/RefChip.vue -->
<script setup lang="ts">
import { computed } from "vue";

interface Props {
  /** "ref" → @{uuid} chip, "var" → $name chip. */
  kind: "ref" | "var";
  /** Display name. For unresolved refs this is empty; uuid is shown instead. */
  name: string;
  /** UUID of the wildcard library entry (ref-kind only). */
  uuid?: string;
  /** True when the name resolved against the catalog / surface. False → render as red `?` chip. */
  resolved: boolean;
  /** Sub-category filter (ref-kind only). Empty list = unfiltered. */
  subCategories?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  uuid: "",
  subCategories: () => [],
});

const emit = defineEmits<{
  /** Fired when a ref-kind chip body is clicked. The MouseEvent
   *  payload lets the parent read the chip's bounding rect (via
   *  `ev.currentTarget`) so it can anchor a popover near the chip
   *  instead of centred on screen. Var-kind chips don't emit. */
  "click": [event: MouseEvent];
}>();

const isRef = computed(() => props.kind === "ref");
const isFiltered = computed(() => isRef.value && props.subCategories.length > 0);

const label = computed(() => {
  if (!props.resolved) {
    // Unresolved → show the uuid (refs) or name (vars) so the user can debug.
    return props.kind === "ref" ? props.uuid : props.name;
  }
  return (isRef.value ? "@" : "$") + props.name;
});

const icon = computed(() => {
  if (!props.resolved) return "?";
  return isRef.value ? "✦" : "⌘";
});

function onClick(ev: MouseEvent): void {
  // Only ref-kind chips have a click-to-edit affordance. Var-kind chips
  // are pure visual marks — no picker to open.
  if (isRef.value && props.resolved) emit("click", ev);
}
</script>

<template>
  <span
    class="wp-refchip"
    :class="{
      'wp-refchip--var': kind === 'var',
      'wp-refchip--ref': kind === 'ref',
      'wp-refchip--unresolved': !resolved,
      'wp-refchip--filtered': isFiltered,
    }"
    contenteditable="false"
    @click.stop="onClick"
  >
    <span class="wp-refchip__icon" aria-hidden="true">{{ icon }}</span>
    <span class="wp-refchip__label">{{ label }}</span>
    <span v-if="isFiltered" class="wp-refchip__suffix">
      ·&nbsp;{{ subCategories.join(", ") }}
    </span>
  </span>
</template>

<style scoped>
.wp-refchip {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 0 5px;
  margin: 1px 1px;
  border-radius: 3px;
  border: 1px solid;
  font: 10px/1.4 var(--wp-font-mono);
  user-select: none;
  cursor: default;
  vertical-align: baseline;
}
.wp-refchip--var {
  background: color-mix(in srgb, #22c55e 15%, transparent);
  border-color: color-mix(in srgb, #22c55e 50%, transparent);
  color: #86efac;
}
.wp-refchip--ref {
  background: color-mix(in srgb, #a855f7 15%, transparent);
  border-color: color-mix(in srgb, #a855f7 50%, transparent);
  color: #d8b4fe;
  cursor: pointer;
}
.wp-refchip--ref:hover { background: color-mix(in srgb, #a855f7 25%, transparent); }
.wp-refchip--unresolved {
  background: color-mix(in srgb, #ef4444 15%, transparent);
  border-color: color-mix(in srgb, #ef4444 50%, transparent);
  color: #fca5a5;
  cursor: help;
}
.wp-refchip__icon { font-size: 8px; opacity: 0.75; }
.wp-refchip__suffix { color: var(--wp-status-modified, #fbbf24); font-size: 9px; opacity: 0.9; }
</style>
