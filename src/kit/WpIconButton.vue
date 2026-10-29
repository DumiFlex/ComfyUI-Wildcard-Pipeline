<script setup lang="ts">
/**
 * WpIconButton: the 20 px square icon button inside a canvas row (module,
 * injector, bundle and model rows, the Context toolbar). Rows are too tight
 * for the 24 px `WpButton size="sm"`, so this is the one smaller control on
 * the canvas, still at the 20 px hit-target floor.
 *
 *   <WpIconButton icon="pi-trash" label="Remove module" tone="danger" @click="remove" />
 *   <WpIconButton icon="pi-lock" label="Lock seed" tone="warn" :pressed="locked" />
 *   <WpIconButton variant="bare" :icon="open ? 'pi-caret-down' : 'pi-caret-right'" label="Collapse" />
 *
 * - `tone` tints the icon on hover, and the whole button while `pressed`.
 * - `pressed` makes it a toggle (`aria-pressed`); `"mixed"` is the bundle
 *   master toggle's "some children" state (dashed, half tint).
 * - `variant="bare"` is the row's fold caret: no box, drawn 14 px wide but
 *   still 20 px to click.
 * - `label` names it for screen readers and is its tooltip, unless `hint`
 *   gives a longer one.
 */
import { vTooltip } from "./tooltip";

withDefaults(defineProps<{
  /** PrimeIcons class, e.g. `pi-trash`. Leave it out to draw a short
   *  glyph from the slot instead (the loop's Σ toggle). */
  icon?: string | undefined;
  label: string;
  /** A longer tooltip than the label. */
  hint?: string | undefined;
  tone?: "neutral" | "accent" | "warn" | "danger" | undefined;
  pressed?: boolean | "mixed" | undefined;
  variant?: "quiet" | "bare" | undefined;
  disabled?: boolean | undefined;
}>(), { icon: undefined, hint: undefined, tone: "neutral", pressed: undefined, variant: "quiet" });

const emit = defineEmits<{ click: [evt: MouseEvent] }>();
</script>

<template>
  <button
    v-tooltip="hint ?? label"
    type="button"
    class="wp-icon-btn"
    :data-tone="tone"
    :data-variant="variant"
    :aria-label="label"
    :aria-pressed="pressed"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <i v-if="icon" class="pi" :class="icon" aria-hidden="true" />
    <span v-else class="wp-icon-btn__glyph" aria-hidden="true"><slot /></span>
  </button>
</template>

<style scoped>
.wp-icon-btn {
  --tone: var(--wp-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
  color: var(--wp-text);
  font: 500 11px/1 var(--wp-font-sans);
  cursor: pointer;
  transition: background var(--wp-motion-quick), border-color var(--wp-motion-quick), color var(--wp-motion-quick);
}
.wp-icon-btn[data-tone="accent"] { --tone: var(--wp-accent); }
.wp-icon-btn[data-tone="warn"] { --tone: var(--wp-warn); }
.wp-icon-btn[data-tone="danger"] { --tone: var(--wp-danger); }
.wp-icon-btn .pi { font-size: 11px; }
.wp-icon-btn__glyph { font: 600 11px/1 var(--wp-font-mono); }
.wp-icon-btn:hover:not(:disabled) { background: var(--wp-bg-4); color: var(--tone); }
.wp-icon-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-icon-btn:disabled { opacity: 0.45; cursor: not-allowed; }
/* On: the tone tints the icon and washes the box, the same tint as hover. */
.wp-icon-btn[aria-pressed="true"] {
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 14%, transparent);
}
.wp-icon-btn[aria-pressed="mixed"] {
  color: var(--tone);
  background: color-mix(in srgb, var(--tone) 7%, transparent);
  border-style: dashed;
  opacity: 0.75;
}
/* The fold caret: no box, 14 px of layout, 20 px of hit area. */
.wp-icon-btn[data-variant="bare"] {
  width: 20px;
  margin-inline: -3px;
  border-color: transparent;
  background: none;
  color: var(--wp-text-dim);
}
.wp-icon-btn[data-variant="bare"] .pi { font-size: 10px; }
.wp-icon-btn[data-variant="bare"]:hover:not(:disabled) { background: none; color: var(--wp-text); }
@media (prefers-reduced-motion: reduce) {
  .wp-icon-btn { transition: none; }
}
</style>
