<script setup lang="ts">
/**
 * A small toolbar over selected text: Explain (asks the chat straight away)
 * and Ask (quotes it in the chat box for your own question). It never takes
 * over the right-click menu, and stays away from inputs and editors. A kit
 * Popover over the selection's box (a virtual anchor), that never takes focus.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import Button from "@/kit/Button.vue";
import Popover from "@/kit/Popover.vue";
import { rectAnchor, type VirtualAnchor } from "@/kit/floating";
import { useAiConfig } from "../../composables/useAiConfig";
import { useAiChat } from "../../composables/useAiChat";
import { askableSelection, EXPLAIN_SHORTCUT, useSelectionAsk } from "../../composables/useSelectionAsk";
import { useUiStore } from "../../stores/uiStore";

const SETTLE_MS = 150;

const ai = useAiConfig();
const chat = useAiChat();
const ui = useUiStore();
const { explain, askAbout } = useSelectionAsk();

const text = ref("");
/** The selection's box when it settled. */
const at = shallowRef<VirtualAnchor | null>(null);
const root = ref<HTMLElement | null>(null);
let pressed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const shown = computed(() => ai.ready.value && ui.explainChip && !!text.value && !!at.value);

function hide(): void {
  text.value = "";
  at.value = null;
}

function place(): void {
  const sel = window.getSelection?.() ?? null;
  const picked = askableSelection(sel);
  if (!picked || !sel) {
    hide();
    return;
  }
  if (root.value && sel.anchorNode && root.value.contains(sel.anchorNode)) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hide();
    return;
  }
  text.value = picked;
  at.value = rectAnchor({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
}

function settle(): void {
  if (timer) clearTimeout(timer);
  // While the mouse is still dragging out a selection, wait for the release.
  if (pressed) return;
  timer = setTimeout(place, SETTLE_MS);
}

function onDown(ev: PointerEvent): void {
  if (root.value?.contains(ev.target as Node)) return;
  pressed = true;
  hide();
}
function onUp(): void {
  if (!pressed) return;
  pressed = false;
  settle();
}
function onKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && shown.value) {
    hide();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === "x" && ai.ready.value) {
    const picked = askableSelection();
    if (!picked) return;
    ev.preventDefault();
    if (explain(picked)) hide();
  }
}

function onExplain(): void {
  if (explain(text.value)) {
    window.getSelection?.()?.removeAllRanges();
    hide();
  }
}
function onAsk(): void {
  askAbout(text.value);
  hide();
}

onMounted(() => {
  document.addEventListener("selectionchange", settle);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("pointerup", onUp, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
});
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
  document.removeEventListener("selectionchange", settle);
  document.removeEventListener("pointerdown", onDown, true);
  document.removeEventListener("pointerup", onUp, true);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", hide, true);
  window.removeEventListener("resize", hide);
});
</script>

<template>
  <!-- Above the selection, centred, below it when there is no room. Escape or
       a press elsewhere hides it; scrolling hides it too (the box it was
       placed at has moved). -->
  <!-- The kit Popover's own prop, turning its focus move OFF. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-autofocus -->
  <Popover :autofocus="false"
    :open="shown"
    :anchor="at"
    placement="top"
    role="group"
    label="Selected text"
    class="wp-ai-sel-pop"
    data-ai-no-explain
    @update:open="(v: boolean) => { if (!v) hide(); }"
  >
    <div
      ref="root"
      class="wp-ai-sel"
      role="toolbar"
      aria-label="Selected text"
      data-test="ai-selection-chip"
      data-ai-no-explain
    >
      <Button
        variant="ghost"
        size="sm"
        icon="pi-microchip-ai"
        class="wp-ai-sel__btn"
        :disabled="chat.loading.value"
        :title="chat.loading.value ? 'The chat is answering' : `Ask the assistant to explain this (${EXPLAIN_SHORTCUT})`"
        data-test="ai-selection-explain"
        @mousedown.prevent
        @click="onExplain"
      >
        Explain
      </Button>
      <span class="wp-ai-sel__sep" aria-hidden="true" />
      <Button
        variant="ghost"
        size="sm"
        icon="pi-comment"
        class="wp-ai-sel__btn"
        title="Quote this in the chat and ask your own question"
        data-test="ai-selection-ask"
        @mousedown.prevent
        @click="onAsk"
      >
        Ask
      </Button>
    </div>
  </Popover>
</template>

<style scoped>
.wp-ai-sel {
  display: inline-flex; align-items: center; height: 30px; padding: 0 3px;
  border-radius: min(8px, var(--wp-radius-cap, 999px)); background: var(--wp-bg-1);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 45%, var(--wp-border));
  box-shadow: var(--wp-shadow-md);
}
.wp-ai-sel__btn :deep(.pi) { color: var(--wp-accent-400, var(--wp-accent-500)); }
.wp-ai-sel__sep { width: 1px; height: 16px; background: var(--wp-border); margin: 0 2px; }
</style>

<style>
/* The Popover panel is bare (not scoped: it lives under <body>); the toolbar
   inside draws the chip. Under the overlays the app opens on top of a page. */
.wp-popover.wp-ai-sel-pop {
  z-index: 9000;
  padding: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}
</style>
