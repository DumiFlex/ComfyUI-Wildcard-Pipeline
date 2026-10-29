<script setup lang="ts">
/**
 * Close button: the one × that closes a dialog, drawer, panel or banner. A
 * square, quiet icon button on the 24/32/40 height scale, named by `label`
 * for screen readers and shown as its tooltip. Works on the canvas
 * (`size="sm"`) and in the manager (`md`).
 *
 *   <CloseButton @click="close" />
 *   <CloseButton label="Dismiss" size="sm" @click="hide" />
 *
 * Manager icon actions other than closing use `Button` with an icon and no
 * text.
 */
import { vTooltip } from "./tooltip";

withDefaults(defineProps<{
  label?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  /** A shortcut for the tooltip, e.g. "Esc". */
  kbd?: string;
}>(), { label: "Close", size: "md", kbd: undefined });

const emit = defineEmits<{ (e: "click", ev: MouseEvent): void }>();
</script>

<template>
  <button
    v-tooltip="{ text: label, kbd }"
    type="button"
    class="wp-close-btn"
    :data-size="size"
    :aria-label="label"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <i class="pi pi-times" aria-hidden="true" />
  </button>
</template>

<style scoped>
.wp-close-btn {
  display: inline-grid;
  place-items: center;
  flex: none;
  width: var(--wp-control-h-md);
  height: var(--wp-control-h-md);
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--wp-radius);
  background: transparent;
  color: var(--wp-text-muted);
  cursor: pointer;
  transition: background var(--wp-motion-hover), color var(--wp-motion-hover), border-color var(--wp-motion-hover);
}
.wp-close-btn[data-size="sm"] { width: var(--wp-control-h-sm); height: var(--wp-control-h-sm); border-radius: var(--wp-radius-sm); }
.wp-close-btn[data-size="lg"] { width: var(--wp-control-h-lg); height: var(--wp-control-h-lg); }
.wp-close-btn .pi { font-size: 12px; }
.wp-close-btn[data-size="sm"] .pi { font-size: 10px; }
.wp-close-btn[data-size="lg"] .pi { font-size: 14px; }
.wp-close-btn:hover:not(:disabled) { background: var(--wp-bg-3); color: var(--wp-text); border-color: var(--wp-border); }
.wp-close-btn:active:not(:disabled) { background: var(--wp-bg-4); }
.wp-close-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-close-btn:disabled { opacity: 0.45; cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) {
  .wp-close-btn { transition: none; }
}
</style>
