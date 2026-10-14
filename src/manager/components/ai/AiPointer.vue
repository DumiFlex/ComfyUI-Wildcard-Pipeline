<script setup lang="ts">
/**
 * AiPointer — the outlines and captions the chat's `highlight` tool draws
 * around parts of the page (numbered when there are several), and the
 * quoted words it marks inside a part. Not modal: the page stays usable,
 * focus stays where it was, and the captions are announced politely. Esc
 * (which then closes nothing else), a click anywhere or a new page closes
 * it. It follows the parts as the page scrolls or resizes. Captions stay
 * inside the page area, left of the chat: they flip above or below the
 * part and slide sideways to fit, and stick to the top or bottom edge with
 * an arrow when the part is scrolled out of sight. No pulse when the user
 * prefers less motion.
 */
import { onBeforeUnmount, ref, watch } from "vue";
import { clearPointer, pointers, type AiPointer } from "../../composables/useAiActions";

interface Box { top: number; left: number; width: number; height: number }
interface Drawn {
  ring: Box | null;
  cap: { top: number; left: number };
  /** Where the part is when it is scrolled out of sight. */
  off: "" | "up" | "down";
}

const drawn = ref<Drawn[]>([]);
/** Caption elements by pointer index, to measure them. */
const caps: Array<HTMLElement | undefined> = [];
function setCap(i: number, el: unknown): void {
  caps[i] = el instanceof HTMLElement ? el : undefined;
}
let frame = 0;
const GAP = 8;
const HIGHLIGHT = "wp-ai-text";

function rectOf(p: AiPointer): DOMRect {
  if (p.range) {
    const r = p.range.getBoundingClientRect();
    if (r.width || r.height) return r;
  }
  return p.el.getBoundingClientRect();
}

/** The part of the window captions may use: not under the chat drawer. */
function area(): { left: number; right: number; top: number; bottom: number } {
  const out = { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
  const chat = document.querySelector<HTMLElement>(".wp-ai-chat");
  const r = chat?.getBoundingClientRect();
  if (r && r.width && r.left > out.right / 3) out.right = Math.min(out.right, r.left);
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, Math.max(lo, hi)));
}

function track(): void {
  const list = pointers.value;
  if (list.some((p) => !p.el.isConnected)) {
    clearPointer();
    return;
  }
  const a = area();
  const pad = 4;
  drawn.value = list.map((p, i) => {
    const r = rectOf(p);
    const cap = caps[i];
    const w = cap?.offsetWidth ?? 0;
    const h = cap?.offsetHeight ?? 0;
    const left = clamp(r.left, a.left + GAP, a.right - w - GAP);
    if (r.bottom < a.top) return { ring: null, cap: { top: a.top + GAP, left }, off: "up" };
    if (r.top > a.bottom) return { ring: null, cap: { top: a.bottom - h - GAP, left }, off: "down" };
    let top: number;
    if (r.bottom + GAP + h <= a.bottom - GAP) top = r.bottom + GAP;
    else if (r.top - GAP - h >= a.top + GAP) top = r.top - GAP - h;
    // Taller than the window: inside the part, at the top of what shows.
    else top = clamp(r.top + GAP, a.top + GAP, a.bottom - h - GAP);
    return {
      ring: { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 },
      cap: { top, left },
      off: "",
    };
  });
  frame = requestAnimationFrame(track);
}

/** Paint the quoted words (CSS Custom Highlight API, where the browser has it). */
function paint(list: AiPointer[]): void {
  const reg = typeof CSS !== "undefined" ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
  const Ctor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !Ctor) return;
  const ranges = list.flatMap((p) => (p.range ? [p.range] : []));
  if (ranges.length) reg.set(HIGHLIGHT, new Ctor(...ranges));
  else reg.delete(HIGHLIGHT);
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

watch(pointers, (list, old) => {
  cancelAnimationFrame(frame);
  const had = !!old?.length;
  if (list.length && !had) listen(true);
  if (!list.length && had) listen(false);
  paint(list);
  if (list.length) track();
  else drawn.value = [];
}, { immediate: true });

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  if (pointers.value.length) listen(false);
  paint([]);
  clearPointer();
});

function announce(list: AiPointer[]): string {
  if (!list.length) return "";
  return list.map((p) => p.caption).filter(Boolean).join(". ") || "Pointed at part of the page";
}
</script>

<template>
  <Teleport to="body">
    <div v-if="pointers.length && drawn.length" class="wp-ai-pointer" data-test="ai-pointer" aria-hidden="true">
      <template v-for="(p, i) in pointers" :key="i">
        <div
          v-if="drawn[i]?.ring"
          class="wp-ai-pointer__ring"
          :data-text="p.range ? 'true' : undefined"
          :style="{ top: `${drawn[i].ring!.top}px`, left: `${drawn[i].ring!.left}px`, width: `${drawn[i].ring!.width}px`, height: `${drawn[i].ring!.height}px` }"
        >
          <span v-if="pointers.length > 1" class="wp-ai-pointer__num">{{ i + 1 }}</span>
        </div>
        <div
          v-if="p.caption || drawn[i]?.off"
          :ref="(el) => setCap(i, el)"
          class="wp-ai-pointer__caption"
          data-test="ai-pointer-caption"
          :data-off="drawn[i]?.off || undefined"
          :style="drawn[i] ? { top: `${drawn[i].cap.top}px`, left: `${drawn[i].cap.left}px` } : undefined"
        >
          <i
            class="pi"
            :class="drawn[i]?.off === 'up' ? 'pi-arrow-up' : drawn[i]?.off === 'down' ? 'pi-arrow-down' : 'pi-microchip-ai'"
          />
          <b v-if="pointers.length > 1">{{ i + 1 }}.</b> {{ p.caption || "Scroll to see it" }}
        </div>
      </template>
    </div>
    <p class="wp-sr-only" aria-live="polite" data-test="ai-pointer-live">{{ announce(pointers) }}</p>
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
.wp-ai-pointer__ring[data-text="true"] { border-radius: 4px; }
.wp-ai-pointer__num {
  position: absolute;
  top: -11px;
  left: -11px;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--wp-accent-500);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
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
.wp-ai-pointer__caption[data-off] { opacity: 0.92; }
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

<style>
/* Quoted words the chat marked; not scoped, a scope attribute can't reach
   a highlight pseudo-element. */
::highlight(wp-ai-text) {
  background-color: color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
  color: inherit;
}
</style>
