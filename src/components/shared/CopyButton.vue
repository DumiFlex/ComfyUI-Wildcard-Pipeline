<script setup lang="ts">
/**
 * Copy button: copies text and says so in place. The icon turns into a
 * check ("Copied") or a cross ("Couldn't copy") for a moment, the tooltip
 * and a polite live region say the same, so the message is the same
 * everywhere and nobody needs a toast for it. Works on the canvas and in the
 * manager, and on plain-http pages (see `clipboard.ts`).
 *
 *   <CopyButton :text="prompt" label="Copy prompt" />
 *   <CopyButton :text="() => buildExport()" label="Copy JSON" show-label />
 *
 * `text` may be a function (also async) so costly text is built on click.
 *
 * With slot content it is an inline copy target instead (an id in a row):
 * the slot is the visible text, styled by the caller, and the icon shows on
 * hover, on focus and after a copy.
 *
 *   <CopyButton :text="row.id" :label="`Copy ID ${row.id}`" class="wp-id">{{ row.id }}</CopyButton>
 */
import { computed, onBeforeUnmount, ref, useSlots } from "vue";
import { copyText } from "./clipboard";
import { vTooltip } from "./tooltip";

const props = withDefaults(defineProps<{
  text: string | (() => string | Promise<string>);
  /** The button's name and tooltip, e.g. "Copy prompt". */
  label?: string;
  /** Show the label next to the icon. */
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  /** `ghost` (default) for rows and toolbars, `secondary` for a filled button. */
  variant?: "ghost" | "secondary";
  disabled?: boolean;
  /** The PrimeIcons class shown before a copy, e.g. "pi-link" for a link. */
  icon?: string;
}>(), { icon: "pi-copy", label: "Copy", size: "md", variant: "ghost" });

const emit = defineEmits<{ (e: "copied", text: string): void; (e: "failed"): void }>();

const slots = useSlots();
const state = ref<"idle" | "copied" | "failed">("idle");
let timer: ReturnType<typeof setTimeout> | undefined;
const RESET_MS = 1600;

const shown = computed(() =>
  state.value === "copied" ? "Copied" : state.value === "failed" ? "Couldn't copy" : props.label);
const icon = computed(() =>
  state.value === "copied" ? "pi-check" : state.value === "failed" ? "pi-times" : props.icon);

async function onClick(): Promise<void> {
  if (props.disabled) return;
  let value = "";
  try {
    value = typeof props.text === "function" ? await props.text() : props.text;
  } catch {
    value = "";
  }
  const ok = value !== "" && await copyText(value);
  state.value = ok ? "copied" : "failed";
  if (ok) emit("copied", value);
  else emit("failed");
  clearTimeout(timer);
  timer = setTimeout(() => { state.value = "idle"; }, RESET_MS);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <button
    v-tooltip="showLabel ? null : shown"
    :data-inline="slots.default ? 'true' : undefined"
    type="button"
    class="wp-copy-btn"
    :data-size="size"
    :data-variant="variant"
    :data-state="state"
    :data-labelled="showLabel || undefined"
    :aria-label="showLabel ? undefined : label"
    :disabled="disabled"
    @click="onClick"
  >
    <template v-if="slots.default">
      <slot />
      <i class="pi wp-copy-btn__inline-icon" :class="icon" aria-hidden="true" />
    </template>
    <template v-else>
      <i class="pi" :class="icon" aria-hidden="true" />
      <span v-if="showLabel" class="wp-copy-btn__text">{{ shown }}</span>
    </template>
    <span class="wp-copy-btn__live" aria-live="polite">{{ state === "idle" ? "" : shown }}</span>
  </button>
</template>

<style scoped>
.wp-copy-btn { position: relative; }
.wp-copy-btn:not([data-inline]) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: none;
  min-width: var(--wp-control-h-md);
  height: var(--wp-control-h-md);
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--wp-radius);
  background: transparent;
  color: var(--wp-text-muted);
  font: 500 var(--wp-text-sm)/1 var(--wp-font-sans);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--wp-motion-hover), color var(--wp-motion-hover), border-color var(--wp-motion-hover);
}
.wp-copy-btn[data-labelled] { padding: 0 var(--wp-space-5); }
.wp-copy-btn[data-size="sm"] { min-width: var(--wp-control-h-sm); height: var(--wp-control-h-sm); border-radius: var(--wp-radius-sm); font-size: var(--wp-text-xs); gap: 4px; }
.wp-copy-btn[data-size="sm"][data-labelled] { padding: 0 var(--wp-space-4); }
.wp-copy-btn[data-size="lg"] { min-width: var(--wp-control-h-lg); height: var(--wp-control-h-lg); }
.wp-copy-btn[data-variant="secondary"] { background: var(--wp-bg-3); border-color: var(--wp-border); color: var(--wp-text); }
.wp-copy-btn:not([data-inline]) .pi { font-size: 12px; }
.wp-copy-btn[data-size="sm"]:not([data-inline]) .pi { font-size: 11px; }
.wp-copy-btn:not([data-inline]):hover:not(:disabled) { background: var(--wp-bg-3); border-color: var(--wp-border); color: var(--wp-text); }
.wp-copy-btn[data-variant="secondary"]:hover:not(:disabled) { background: var(--wp-bg-4); border-color: var(--wp-border-strong); }
.wp-copy-btn:not([data-inline]):focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-copy-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-copy-btn[data-state="copied"] .pi { color: var(--wp-success); }
.wp-copy-btn[data-state="failed"] .pi { color: var(--wp-danger); }
/* Inline: the caller's class draws the text; only the icon is ours. */
.wp-copy-btn[data-inline] {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  border: 0;
  border-radius: var(--wp-radius-sm);
  text-align: left;
  cursor: copy;
}
.wp-copy-btn[data-inline]:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-copy-btn__inline-icon { font-size: 0.85em; opacity: 0; transition: opacity var(--wp-motion-hover); }
.wp-copy-btn[data-inline]:hover .wp-copy-btn__inline-icon,
.wp-copy-btn[data-inline]:focus-visible .wp-copy-btn__inline-icon,
.wp-copy-btn[data-inline]:not([data-state="idle"]) .wp-copy-btn__inline-icon { opacity: 1; }
.wp-copy-btn__live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .wp-copy-btn { transition: none; }
}
</style>
