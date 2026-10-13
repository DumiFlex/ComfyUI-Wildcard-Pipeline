<script setup lang="ts">
/**
 * AiPointer — the outline and caption the chat's `highlight` tool draws
 * around a part of the page. Not modal: the page stays usable, focus stays
 * where it was, and the caption is announced politely. Esc (which then
 * closes nothing else), a click
 * anywhere or a new page closes it. It follows the part as the page
 * scrolls or resizes; there is no pulse when the user prefers less motion.
 */
import { onBeforeUnmount, ref, watch } from "vue";
import { clearPointer, pointer } from "../../composables/useAiActions";

const rect = ref<{ top: number; left: number; width: number; height: number } | null>(null);
const below = ref(true);
let frame = 0;

function track(): void {
  const p = pointer.value;
  if (!p || !p.el.isConnected) {
    if (p) clearPointer();
    rect.value = null;
    return;
  }
  const r = p.el.getBoundingClientRect();
  const pad = 4;
  rect.value = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  below.value = r.bottom + 80 < window.innerHeight;
  frame = requestAnimationFrame(track);
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key !== "Escape") return;
  // This Esc closes only the pointer, not the chat or a dialog under it.
  ev.stopPropagation();
  clearPointer();
}

function onDown(): void {
  clearPointer();
}

function listen(on: boolean): void {
  const fn = on ? window.addEventListener : window.removeEventListener;
  fn("keydown", onKey, true);
  fn("pointerdown", onDown, true);
}

watch(pointer, (p, old) => {
  cancelAnimationFrame(frame);
  if (p && !old) listen(true);
  if (!p && old) listen(false);
  if (p) track();
  else rect.value = null;
}, { immediate: true });

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  if (pointer.value) listen(false);
  clearPointer();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="rect && pointer" class="wp-ai-pointer" data-test="ai-pointer" aria-hidden="true">
      <div
        class="wp-ai-pointer__ring"
        :style="{ top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
      />
      <div
        v-if="pointer.caption"
        class="wp-ai-pointer__caption"
        :data-below="below ? 'true' : 'false'"
        :style="below
          ? { top: `${rect.top + rect.height + 8}px`, left: `${Math.max(8, rect.left)}px` }
          : { top: `${rect.top - 8}px`, left: `${Math.max(8, rect.left)}px` }"
      ><i class="pi pi-microchip-ai" /> {{ pointer.caption }}</div>
    </div>
    <p class="wp-sr-only" aria-live="polite" data-test="ai-pointer-live">{{ pointer ? pointer.caption || "Pointed at part of the page" : "" }}</p>
  </Teleport>
</template>

<style scoped>
.wp-ai-pointer { position: fixed; inset: 0; pointer-events: none; z-index: 950; }
.wp-ai-pointer__ring {
  position: fixed;
  border: 2px solid var(--wp-accent-500);
  border-radius: 8px;
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--wp-accent-500) 25%, transparent);
  animation: wp-ai-pointer-pulse 1.4s ease-in-out 3;
}
.wp-ai-pointer__caption {
  position: fixed;
  max-width: min(360px, calc(100vw - 16px));
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--wp-accent-500);
  color: #fff;
  font-size: 12.5px;
  line-height: 1.35;
  box-shadow: 0 6px 18px rgb(0 0 0 / 30%);
}
.wp-ai-pointer__caption[data-below="false"] { transform: translateY(-100%); }
.wp-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@keyframes wp-ai-pointer-pulse {
  50% { box-shadow: 0 0 0 9px color-mix(in oklab, var(--wp-accent-500) 10%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .wp-ai-pointer__ring { animation: none; }
}
</style>
