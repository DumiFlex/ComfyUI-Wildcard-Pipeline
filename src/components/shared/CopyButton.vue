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
 */
import { computed, onBeforeUnmount, ref } from "vue";
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
}>(), { label: "Copy", size: "md", variant: "ghost" });

const emit = defineEmits<{ (e: "copied", text: string): void; (e: "failed"): void }>();

const state = ref<"idle" | "copied" | "failed">("idle");
let timer: ReturnType<typeof setTimeout> | undefined;
const RESET_MS = 1600;

const shown = computed(() =>
  state.value === "copied" ? "Copied" : state.value === "failed" ? "Couldn't copy" : props.label);
const icon = computed(() =>
  state.value === "copied" ? "pi-check" : state.value === "failed" ? "pi-times" : "pi-copy");

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
    <i class="pi" :class="icon" aria-hidden="true" />
    <span v-if="showLabel" class="wp-copy-btn__text">{{ shown }}</span>
    <span class="wp-copy-btn__live" aria-live="polite">{{ state === "idle" ? "" : shown }}</span>
  </button>
</template>

<style scoped>
.wp-copy-btn {
  position: relative;
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
.wp-copy-btn .pi { font-size: 12px; }
.wp-copy-btn[data-size="sm"] .pi { font-size: 11px; }
.wp-copy-btn:hover:not(:disabled) { background: var(--wp-bg-3); border-color: var(--wp-border); color: var(--wp-text); }
.wp-copy-btn[data-variant="secondary"]:hover:not(:disabled) { background: var(--wp-bg-4); border-color: var(--wp-border-strong); }
.wp-copy-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-copy-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-copy-btn[data-state="copied"] .pi { color: var(--wp-success); }
.wp-copy-btn[data-state="failed"] .pi { color: var(--wp-danger); }
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
