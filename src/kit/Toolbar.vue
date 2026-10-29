<script setup lang="ts">
/**
 * Toolbar: a row of controls that is one Tab stop. Inside it the arrow keys
 * move between the controls, Home/End jump to the ends, and the toolbar
 * remembers where you were (APG toolbar). `attached` joins its buttons into
 * one button group. Works on the canvas and in the manager.
 *
 *   <Toolbar label="Text">
 *     <Button variant="ghost" icon="pi-bold" aria-label="Bold" />
 *     <Separator orientation="vertical" />
 *     <Button variant="ghost" icon="pi-copy" aria-label="Copy" />
 *   </Toolbar>
 *
 * Put buttons, toggles and selects in it. A text box inside a toolbar keeps
 * its own left/right keys.
 */
import { onMounted, onUpdated, ref } from "vue";

const props = withDefaults(defineProps<{
  /** The toolbar's name for screen readers. */
  label: string;
  orientation?: "horizontal" | "vertical" | undefined;
  /** Join the buttons into one group with shared borders. */
  attached?: boolean | undefined;
  /** Gap between controls. */
  size?: "sm" | "md" | undefined;
}>(), { orientation: "horizontal", size: "md" });

const rootEl = ref<HTMLElement | null>(null);
const last = ref(0);

const ITEMS = "button:not([disabled]), [role=button]:not([aria-disabled=true]), a[href], input:not([disabled]), select:not([disabled]), [role=switch], [role=checkbox], [role=radio]";

function items(): HTMLElement[] {
  return rootEl.value ? [...rootEl.value.querySelectorAll<HTMLElement>(ITEMS)] : [];
}

/** Roving tabindex: only the remembered control is in the Tab order. */
function sync(): void {
  const list = items();
  if (!list.length) return;
  const at = Math.min(last.value, list.length - 1);
  list.forEach((el, i) => el.setAttribute("tabindex", i === at ? "0" : "-1"));
}

function isTextField(el: Element | null): boolean {
  return !!el && el.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((el as HTMLInputElement).type);
}

function onKeydown(ev: KeyboardEvent): void {
  const list = items();
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const fwd = props.orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const back = props.orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  if (isTextField(document.activeElement) && (ev.key === "ArrowLeft" || ev.key === "ArrowRight" || ev.key === "Home" || ev.key === "End")) return;
  let next: number;
  if (ev.key === fwd) next = (at + 1) % list.length;
  else if (ev.key === back) next = (at - 1 + list.length) % list.length;
  else if (ev.key === "Home") next = 0;
  else if (ev.key === "End") next = list.length - 1;
  else return;
  ev.preventDefault();
  last.value = next;
  sync();
  list[next].focus();
}

function onFocusin(ev: FocusEvent): void {
  const i = items().indexOf(ev.target as HTMLElement);
  if (i >= 0 && i !== last.value) { last.value = i; sync(); }
}

onMounted(sync);
onUpdated(sync);
</script>

<!-- role="toolbar" moves focus between its own controls. -->
<!-- eslint-disable vuejs-accessibility/no-static-element-interactions -->
<template>
  <div
    ref="rootEl"
    class="wp-tools"
    role="toolbar"
    :aria-label="label"
    :aria-orientation="orientation"
    :data-orientation="orientation"
    :data-attached="attached || undefined"
    :data-size="size"
    @keydown="onKeydown"
    @focusin="onFocusin"
  >
    <slot />
  </div>
</template>

<style scoped>
.wp-tools { display: inline-flex; align-items: center; gap: var(--wp-space-2); flex-wrap: wrap; min-width: 0; }
.wp-tools[data-size="md"] { gap: var(--wp-space-3); }
.wp-tools[data-orientation="vertical"] { flex-direction: column; align-items: stretch; flex-wrap: nowrap; }
.wp-tools[data-attached] { gap: 0; flex-wrap: nowrap; }
.wp-tools[data-attached] > :deep(*) { border-radius: 0; }
.wp-tools[data-attached] > :deep(*:not(:first-child)) { margin-left: -1px; }
.wp-tools[data-attached] > :deep(*:first-child) { border-top-left-radius: var(--wp-radius); border-bottom-left-radius: var(--wp-radius); }
.wp-tools[data-attached] > :deep(*:last-child) { border-top-right-radius: var(--wp-radius); border-bottom-right-radius: var(--wp-radius); }
.wp-tools[data-attached] > :deep(*:focus-visible) { position: relative; z-index: 1; }
.wp-tools[data-attached][data-orientation="vertical"] > :deep(*:not(:first-child)) { margin-left: 0; margin-top: -1px; }
.wp-tools[data-attached][data-orientation="vertical"] > :deep(*:first-child) { border-radius: var(--wp-radius) var(--wp-radius) 0 0; }
.wp-tools[data-attached][data-orientation="vertical"] > :deep(*:last-child) { border-radius: 0 0 var(--wp-radius) var(--wp-radius); }
</style>
