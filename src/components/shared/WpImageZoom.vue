<script setup lang="ts">
/**
 * Image zoom: one picture with real zoom levels. Scroll zooms toward the
 * pointer, drag moves, double-click switches between Fit and 100% at that
 * spot. The bar on top has − / Fit / 100% / 200% / + and the level; when
 * the viewer has focus, + − 0 1 2 do the same.
 *
 * `v-model:zoom` is the level (`null` = Fit). The viewer also keeps the spot
 * it shows when `src` changes, so stepping through a series stays on the same
 * part of each picture (the hands in every frame). Works on the canvas and
 * in the manager.
 *
 *   <WpImageZoom v-model:zoom="zoom" :src="url" alt="Frame 3" />
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import WpButton from "./WpButton.vue";
import {
  centreOf, clampView, fitScale, percent, stepScale, viewAround, zoomAt, type Size, type View,
} from "./image-zoom";

const props = withDefaults(defineProps<{
  src: string;
  alt?: string;
  /** The level as a real-size factor (1 = 100%); null fits the picture in. */
  zoom?: number | null;
  /** Show the zoom bar. */
  controls?: boolean;
  /** Hint shown under the bar's buttons, e.g. "Drag to move · scroll to zoom". */
  hint?: string;
  size?: "sm" | "md";
}>(), { alt: "", zoom: null, controls: true, hint: undefined, size: "sm" });

const emit = defineEmits<{ "update:zoom": [zoom: number | null] }>();

const stage = ref<HTMLElement | null>(null);
const stageSize = ref<Size>({ width: 0, height: 0 });
const image = ref<Size>({ width: 0, height: 0 });
const view = ref<View>({ scale: 1, x: 0, y: 0 });
/** The image point (0..1) at the middle of the stage, carried to the next `src`. */
let centre = { x: 0.5, y: 0.5 };

/** The level shown; follows `zoom`, and works without a v-model too. */
const current = ref<number | null>(props.zoom);
const fit = computed(() => fitScale(image.value, stageSize.value));
const isFit = computed(() => current.value === null);
const ready = computed(() => image.value.width > 0 && stageSize.value.width > 0);
const canPan = computed(() =>
  image.value.width * view.value.scale > stageSize.value.width + 0.5
  || image.value.height * view.value.scale > stageSize.value.height + 0.5,
);

function place(next: View): void {
  view.value = next;
  centre = centreOf(next, image.value, stageSize.value);
}

/** Lay the picture out for the current `zoom` around the kept spot. */
function relayout(): void {
  if (!ready.value) return;
  if (current.value === null) {
    view.value = clampView({ scale: fit.value, x: 0, y: 0 }, image.value, stageSize.value);
    return;
  }
  place(viewAround(current.value, centre, image.value, stageSize.value));
}

/** Change the level around a stage point (default: the middle). */
function setZoom(scale: number | null, at?: { x: number; y: number }): void {
  if (scale === null) {
    current.value = null;
    relayout();
    emit("update:zoom", null);
    return;
  }
  const point = at ?? { x: stageSize.value.width / 2, y: stageSize.value.height / 2 };
  const next = zoomAt(view.value, scale, point, image.value, stageSize.value);
  place(next);
  current.value = next.scale;
  emit("update:zoom", next.scale);
}

function zoomIn(): void { setZoom(stepScale(view.value.scale, 1, fit.value)); }
function zoomOut(): void { setZoom(stepScale(view.value.scale, -1, fit.value)); }

defineExpose({ zoomIn, zoomOut, setZoom });

watch(() => props.zoom, (z) => {
  // A level set from outside (the parent, a key): keep the middle spot.
  if (z === current.value) return;
  current.value = z;
  relayout();
});

function onLoad(ev: Event): void {
  const img = ev.target as HTMLImageElement;
  image.value = { width: img.naturalWidth, height: img.naturalHeight };
  relayout();
}

let observer: ResizeObserver | null = null;
watch(stage, (el) => {
  observer?.disconnect();
  if (!el) return;
  const measure = (): void => {
    stageSize.value = { width: el.clientWidth, height: el.clientHeight };
    relayout();
  };
  measure();
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(measure);
  observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());

function local(ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = stage.value?.getBoundingClientRect();
  return r ? { x: ev.clientX - r.left, y: ev.clientY - r.top } : { x: 0, y: 0 };
}

function onWheel(ev: WheelEvent): void {
  if (!ready.value) return;
  // A mouse notch is ~100 px (or 3 lines); a trackpad pinch sends many small ones.
  const delta = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
  const factor = Math.min(2, Math.max(0.5, Math.exp(-delta * 0.0025)));
  setZoom(view.value.scale * factor, local(ev));
}

let drag: { id: number; x: number; y: number; vx: number; vy: number } | null = null;
const dragging = ref(false);
function onDown(ev: PointerEvent): void {
  if (ev.button !== 0 || !canPan.value) return;
  drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, vx: view.value.x, vy: view.value.y };
  dragging.value = true;
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
}
function onMove(ev: PointerEvent): void {
  if (!drag || drag.id !== ev.pointerId) return;
  place(clampView({ scale: view.value.scale, x: drag.vx + ev.clientX - drag.x, y: drag.vy + ev.clientY - drag.y }, image.value, stageSize.value));
}
function onUp(ev: PointerEvent): void {
  if (!drag || drag.id !== ev.pointerId) return;
  drag = null;
  dragging.value = false;
}
function onDouble(ev: MouseEvent): void {
  if (!ready.value) return;
  if (isFit.value || view.value.scale < 1 - 1e-3) setZoom(1, local(ev));
  else setZoom(null);
}

function onKey(ev: KeyboardEvent): void {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const act: Record<string, () => void> = {
    "+": zoomIn, "=": zoomIn, "-": zoomOut, "_": zoomOut,
    "0": () => setZoom(null), "1": () => setZoom(1), "2": () => setZoom(2),
  };
  const fn = act[ev.key];
  if (!fn) return;
  ev.preventDefault();
  ev.stopPropagation();
  fn();
}

const imgStyle = computed(() => ({
  width: `${image.value.width}px`,
  height: `${image.value.height}px`,
  transform: `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.scale})`,
  visibility: ready.value ? ("visible" as const) : ("hidden" as const),
}));
const level = computed(() => percent(view.value.scale));
const at = (s: number): boolean => !isFit.value && Math.abs(view.value.scale - s) < 1e-3;
</script>

<template>
  <div class="wp-imgzoom" :data-size="size">
    <div v-if="controls" class="wp-imgzoom__bar" role="toolbar" aria-label="Zoom">
      <slot name="bar-start" />
      <WpButton variant="ghost" :size="size" icon="pi-minus" aria-label="Zoom out" kbd="−" data-test="imgzoom-out" @click="zoomOut" />
      <WpButton :variant="isFit ? 'secondary' : 'ghost'" :size="size" kbd="0" hint="Show the whole picture" :aria-pressed="isFit" data-test="imgzoom-fit" @click="setZoom(null)">Fit</WpButton>
      <WpButton :variant="at(1) ? 'secondary' : 'ghost'" :size="size" kbd="1" hint="Real size: one image pixel per screen pixel" :aria-pressed="at(1)" data-test="imgzoom-100" @click="setZoom(1)">100%</WpButton>
      <WpButton :variant="at(2) ? 'secondary' : 'ghost'" :size="size" kbd="2" hint="Twice the real size" :aria-pressed="at(2)" data-test="imgzoom-200" @click="setZoom(2)">200%</WpButton>
      <WpButton variant="ghost" :size="size" icon="pi-plus" aria-label="Zoom in" kbd="+" data-test="imgzoom-in" @click="zoomIn" />
      <span class="wp-imgzoom__level" aria-live="polite" data-test="imgzoom-level">{{ level }}</span>
      <slot name="bar-end" />
    </div>
    <!-- The stage is a focusable viewport: its keys (+ − 0 1 2) and the bar do everything the pointer does. -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div
      ref="stage"
      class="wp-imgzoom__stage"
      :class="{ 'can-pan': canPan, 'is-dragging': dragging }"
      tabindex="0"
      role="application"
      aria-roledescription="picture zoom"
      :aria-label="alt ? `${alt}, ${level}` : `Picture, ${level}`"
      data-test="imgzoom-stage"
      @wheel.prevent="onWheel"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @dblclick="onDouble"
      @keydown="onKey"
    >
      <img
        :src="src"
        alt=""
        class="wp-imgzoom__img"
        :class="{ 'is-pixels': view.scale >= 4 }"
        :style="imgStyle"
        draggable="false"
        @load="onLoad"
      >
      <slot />
    </div>
    <p v-if="hint" class="wp-imgzoom__hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.wp-imgzoom {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.wp-imgzoom__bar {
  position: absolute;
  top: var(--wp-space-3);
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--wp-space-1);
  padding: var(--wp-space-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-md);
  background: var(--wp-bg-2);
  box-shadow: var(--wp-shadow-md);
}
.wp-imgzoom__level {
  min-width: 44px;
  padding: 0 var(--wp-space-2);
  text-align: right;
  font: var(--wp-text-xs) var(--wp-font-mono);
  color: var(--wp-text-muted);
}
.wp-imgzoom__stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--wp-radius);
  background: var(--wp-bg);
  touch-action: none;
  outline: none;
}
.wp-imgzoom__stage:focus-visible { box-shadow: inset 0 0 0 2px var(--wp-border-focus); }
.wp-imgzoom__stage.can-pan { cursor: grab; }
.wp-imgzoom__stage.is-dragging { cursor: grabbing; }
.wp-imgzoom__img {
  position: absolute;
  top: 0;
  left: 0;
  max-width: none;
  transform-origin: 0 0;
  user-select: none;
  pointer-events: none;
}
.wp-imgzoom__img.is-pixels { image-rendering: pixelated; }
.wp-imgzoom__hint {
  position: absolute;
  bottom: var(--wp-space-3);
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: var(--wp-space-1) var(--wp-space-3);
  border-radius: var(--wp-radius-sm);
  /* Over a picture: a dark scrim in both themes, so it reads on any image. */
  background: rgb(0 0 0 / 0.6);
  color: white;
  font: var(--wp-text-xs) var(--wp-font-sans);
  white-space: nowrap;
  pointer-events: none;
}
</style>
