<script setup lang="ts">
/**
 * A small toolbar over selected text: Explain (asks the chat straight away)
 * and Ask (quotes it in the chat box for your own question). It never takes
 * over the right-click menu, and stays away from inputs and editors.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAiConfig } from "../../composables/useAiConfig";
import { useAiChat } from "../../composables/useAiChat";
import { askableSelection, EXPLAIN_SHORTCUT, useSelectionAsk } from "../../composables/useSelectionAsk";
import { useUiStore } from "../../stores/uiStore";

const GAP = 8;
const CHIP_H = 30;
const SETTLE_MS = 150;

const ai = useAiConfig();
const chat = useAiChat();
const ui = useUiStore();
const { explain, askAbout } = useSelectionAsk();

const text = ref("");
const pos = ref<{ top: number; left: number; below: boolean } | null>(null);
const root = ref<HTMLElement | null>(null);
let pressed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const shown = computed(() => ai.ready.value && ui.explainChip && !!text.value && !!pos.value);

function hide(): void {
  text.value = "";
  pos.value = null;
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
  const below = rect.top - CHIP_H - GAP < GAP;
  const top = below ? rect.bottom + GAP : rect.top - CHIP_H - GAP;
  const left = Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90);
  text.value = picked;
  pos.value = { top, left, below };
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
  <Teleport to="body">
    <div
      v-if="shown && pos"
      ref="root"
      class="wp-ai-sel"
      :data-below="pos.below || undefined"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
      role="toolbar"
      aria-label="Selected text"
      data-test="ai-selection-chip"
      data-ai-no-explain
    >
      <button
        type="button"
        class="wp-ai-sel__btn"
        :disabled="chat.loading.value"
        :title="chat.loading.value ? 'The chat is answering' : `Ask the assistant to explain this (${EXPLAIN_SHORTCUT})`"
        data-test="ai-selection-explain"
        @mousedown.prevent
        @click="onExplain"
      >
        <i class="pi pi-microchip-ai" aria-hidden="true" /> Explain
      </button>
      <span class="wp-ai-sel__sep" aria-hidden="true" />
      <button
        type="button"
        class="wp-ai-sel__btn"
        title="Quote this in the chat and ask your own question"
        data-test="ai-selection-ask"
        @mousedown.prevent
        @click="onAsk"
      >
        <i class="pi pi-comment" aria-hidden="true" /> Ask
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.wp-ai-sel {
  position: fixed; z-index: 9000; transform: translateX(-50%);
  display: inline-flex; align-items: center; height: 30px; padding: 0 3px;
  border-radius: min(8px, var(--wp-radius-cap, 999px)); background: var(--wp-bg-1);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 45%, var(--wp-border));
  box-shadow: var(--wp-shadow-md);
  animation: wp-ai-sel-in 0.14s ease-out both;
}
.wp-ai-sel__btn {
  display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px;
  border: 0; border-radius: min(6px, var(--wp-radius-cap, 999px)); background: transparent; color: var(--wp-text);
  font: inherit; font-size: 12px; cursor: pointer;
}
.wp-ai-sel__btn:hover:not(:disabled), .wp-ai-sel__btn:focus-visible {
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent); outline: none;
}
.wp-ai-sel__btn:disabled { opacity: 0.5; cursor: default; }
.wp-ai-sel__btn .pi { font-size: 12px; color: var(--wp-accent-400, var(--wp-accent-500)); }
.wp-ai-sel__sep { width: 1px; height: 16px; background: var(--wp-border); margin: 0 2px; }
@keyframes wp-ai-sel-in {
  from { opacity: 0; transform: translate(-50%, 4px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
.wp-ai-sel[data-below] { animation-name: wp-ai-sel-in-below; }
@keyframes wp-ai-sel-in-below {
  from { opacity: 0; transform: translate(-50%, -4px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
@media (prefers-reduced-motion: reduce) { .wp-ai-sel { animation: none; } }
</style>
