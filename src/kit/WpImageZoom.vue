<script setup lang="ts">
/**
 * Image zoom: one picture with real zoom levels. Scroll zooms toward the
 * pointer, drag moves, double-click switches between Fit and 100% at that
 * spot. The bar on top has − / Fit / 100% / 200% / + and the level; when
 * the viewer has focus, + − 0 1 2 do the same. With `fullscreen` the bar
 * also gets a Fullscreen button (key F) that fills the screen with the
 * viewer, bar and slots included; Esc leaves it.
 *
 * `minimap` adds a small copy of the picture in the corner once it is bigger
 * than the stage; its box shows the part in view and a click or drag there
 * moves the view. `autohide` fades the bar, hint and mini-map after
 * `IDLE_MS` without a pointer move or key (hovering the bar keeps them).
 * `second` shows another picture beside the first, both locked to the same
 * level and spot (a synced compare; the first picture's size drives the
 * maths). Slots: `bar-start` / `bar-end` in the bar, `first` / `second` over
 * each picture, `fullscreen` along the bottom only while fullscreen (it fades
 * with the bar), default over the whole stage.
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
  centreOf, clampView, fitScale, percent, stepScale, viewAround, visibleRect, zoomAt, IDLE_MS, type Size, type View,
} from "./image-zoom";

/** The gap between the two pictures of a synced compare. */
const PANE_GAP = 8;

const props = withDefaults(defineProps<{
  src: string;
  alt?: string | undefined;
  /** The level as a real-size factor (1 = 100%); null fits the picture in. */
  zoom?: number | null | undefined;
  /** Show the zoom bar. */
  controls?: boolean | undefined;
  /** Hint shown under the bar's buttons, e.g. "Drag to move · scroll to zoom". */
  hint?: string | undefined;
  /** Offer a Fullscreen button (and key F). */
  fullscreen?: boolean | undefined;
  /** Show a mini-map once the picture is bigger than the stage. */
  minimap?: boolean | undefined;
  /** Fade the bar, hint and mini-map while the pointer and keys are still. */
  autohide?: boolean | undefined;
  /** A second picture beside the first, locked to the same level and spot. */
  second?: string | null | undefined;
  secondAlt?: string | undefined;
  size?: "sm" | "md" | undefined;
}>(), {
  alt: "", zoom: null, controls: true, hint: undefined, fullscreen: false,
  minimap: false, autohide: false, second: null, secondAlt: "", size: "sm",
});

const emit = defineEmits<{ "update:zoom": [zoom: number | null] }>();

const root = ref<HTMLElement | null>(null);
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

const isFull = ref(false);
const canFull = computed(() => props.fullscreen && typeof document !== "undefined" && document.fullscreenEnabled !== false);
function onFullChange(): void {
  isFull.value = !!root.value && document.fullscreenElement === root.value;
}
function toggleFullscreen(): void {
  if (!canFull.value || !root.value) return;
  if (document.fullscreenElement === root.value) void document.exitFullscreen?.();
  else void root.value.requestFullscreen?.().then(() => stage.value?.focus()).catch(() => undefined);
}
if (typeof document !== "undefined") document.addEventListener("fullscreenchange", onFullChange);
onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", onFullChange);
  if (root.value && document.fullscreenElement === root.value) void document.exitFullscreen?.();
});

defineExpose({ zoomIn, zoomOut, setZoom, toggleFullscreen });

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
let measureStage: (() => void) | null = null;
watch(() => !!props.second, () => measureStage?.());
watch(stage, (el) => {
  observer?.disconnect();
  if (!el) return;
  const measure = (): void => {
    // A synced compare splits the stage into two panes that share one view.
    const width = props.second ? Math.max(0, (el.clientWidth - PANE_GAP) / 2) : el.clientWidth;
    stageSize.value = { width, height: el.clientHeight };
    relayout();
  };
  measureStage = measure;
  measure();
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(measure);
  observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());

/** A pointer position in pane px; in a synced compare, in whichever pane it is over. */
function local(ev: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = stage.value?.getBoundingClientRect();
  if (!r) return { x: 0, y: 0 };
  let x = ev.clientX - r.left;
  const pane = stageSize.value.width;
  if (props.second && x > pane + PANE_GAP / 2) x -= pane + PANE_GAP;
  return { x, y: ev.clientY - r.top };
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
  if (canFull.value) { act.f = toggleFullscreen; act.F = toggleFullscreen; }
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

/* Mini-map: the box is the part in view; a click or drag centres the view there. */
const showMap = computed(() => props.minimap && ready.value && canPan.value);
const mapBox = computed(() => {
  const r = visibleRect(view.value, image.value, stageSize.value);
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` };
});
const mapStyle = computed(() => ({ aspectRatio: `${image.value.width} / ${image.value.height}` }));
let mapId: number | null = null;
function mapTo(ev: PointerEvent): void {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return;
  const at = { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
  place(viewAround(view.value.scale, at, image.value, stageSize.value));
}
function onMapDown(ev: PointerEvent): void {
  if (ev.button !== 0) return;
  ev.stopPropagation();
  mapId = ev.pointerId;
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  mapTo(ev);
}
function onMapMove(ev: PointerEvent): void {
  if (mapId === ev.pointerId) mapTo(ev);
}
function onMapUp(ev: PointerEvent): void {
  if (mapId === ev.pointerId) mapId = null;
}

/* Autohide: the chrome fades after IDLE_MS without a move or key, and stays while hovered. */
const idle = ref(false);
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let onChrome = false;
function wake(): void {
  idle.value = false;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!props.autohide || onChrome) return;
  idleTimer = setTimeout(() => { idle.value = true; }, IDLE_MS);
}
function chromeEnter(): void { onChrome = true; wake(); }
function chromeLeave(): void { onChrome = false; wake(); }
watch(() => props.autohide, wake, { immediate: true });
// Stepping to another picture or changing the level (keys from the parent too) counts as activity.
watch(() => [props.src, props.second, current.value], wake);
// Any move or key anywhere in the viewer (slots included) brings the chrome back.
watch(root, (el, old) => {
  old?.removeEventListener("pointermove", wake);
  old?.removeEventListener("keydown", wake, true);
  el?.addEventListener("pointermove", wake);
  el?.addEventListener("keydown", wake, true);
});
onBeforeUnmount(() => { if (idleTimer) clearTimeout(idleTimer); });
const at = (s: number): boolean => !isFit.value && Math.abs(view.value.scale - s) < 1e-3;
</script>

<template>
  <div
    ref="root"
    class="wp-imgzoom"
    :class="{ 'is-full': isFull, 'is-idle': idle, 'is-pair': !!second }"
    :data-size="size"
  >
    <!-- eslint-disable-next-line vuejs-accessibility/mouse-events-have-key-events -->
    <div
      v-if="controls"
      class="wp-imgzoom__bar wp-imgzoom__chrome"
      role="toolbar"
      aria-label="Zoom"
      @pointerenter="chromeEnter"
      @pointerleave="chromeLeave"
      @focusin="chromeEnter"
      @focusout="chromeLeave"
    >
      <slot name="bar-start" />
      <WpButton variant="ghost" :size="size" icon="pi-minus" aria-label="Zoom out" kbd="−" data-test="imgzoom-out" @click="zoomOut" />
      <WpButton :variant="isFit ? 'secondary' : 'ghost'" :size="size" kbd="0" hint="Show the whole picture" :aria-pressed="isFit" data-test="imgzoom-fit" @click="setZoom(null)">Fit</WpButton>
      <WpButton :variant="at(1) ? 'secondary' : 'ghost'" :size="size" kbd="1" hint="Real size: one image pixel per screen pixel" :aria-pressed="at(1)" data-test="imgzoom-100" @click="setZoom(1)">100%</WpButton>
      <WpButton :variant="at(2) ? 'secondary' : 'ghost'" :size="size" kbd="2" hint="Twice the real size" :aria-pressed="at(2)" data-test="imgzoom-200" @click="setZoom(2)">200%</WpButton>
      <WpButton variant="ghost" :size="size" icon="pi-plus" aria-label="Zoom in" kbd="+" data-test="imgzoom-in" @click="zoomIn" />
      <span class="wp-imgzoom__level" aria-live="polite" data-test="imgzoom-level">{{ level }}</span>
      <WpButton
        v-if="canFull"
        variant="ghost"
        :size="size"
        :icon="isFull ? 'pi-window-minimize' : 'pi-window-maximize'"
        :aria-label="isFull ? 'Leave fullscreen' : 'Fullscreen'"
        :aria-pressed="isFull"
        kbd="F"
        data-test="imgzoom-full"
        @click="toggleFullscreen"
      />
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
      <div class="wp-imgzoom__pane">
        <img
          :src="src"
          alt=""
          class="wp-imgzoom__img"
          :class="{ 'is-pixels': view.scale >= 4 }"
          :style="imgStyle"
          draggable="false"
          @load="onLoad"
        >
        <slot name="first" />
      </div>
      <div v-if="second" class="wp-imgzoom__pane" data-test="imgzoom-second">
        <img
          :src="second"
          :alt="secondAlt"
          class="wp-imgzoom__img"
          :class="{ 'is-pixels': view.scale >= 4 }"
          :style="imgStyle"
          draggable="false"
        >
        <slot name="second" />
      </div>
      <slot />
      <!-- The mini-map takes its own pointer drags, so the stage behind it never pans. -->
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <div
        v-if="showMap"
        class="wp-imgzoom__map wp-imgzoom__chrome"
        :style="mapStyle"
        aria-hidden="true"
        data-test="imgzoom-map"
        @pointerdown="onMapDown"
        @pointermove="onMapMove"
        @pointerup="onMapUp"
        @pointercancel="onMapUp"
        @pointerenter="chromeEnter"
        @pointerleave="chromeLeave"
      >
        <img :src="src" alt="" draggable="false">
        <span class="wp-imgzoom__map-box" :style="mapBox" data-test="imgzoom-map-box" />
      </div>
    </div>
    <div v-if="hint || (isFull && $slots.fullscreen)" class="wp-imgzoom__bottom">
      <p v-if="hint" class="wp-imgzoom__hint wp-imgzoom__chrome">{{ hint }}</p>
      <!-- eslint-disable-next-line vuejs-accessibility/mouse-events-have-key-events -->
      <div
        v-if="isFull && $slots.fullscreen"
        class="wp-imgzoom__full-foot wp-imgzoom__chrome"
        data-test="imgzoom-full-foot"
        @pointerenter="chromeEnter"
        @pointerleave="chromeLeave"
        @focusin="chromeEnter"
        @focusout="chromeLeave"
      >
        <slot name="fullscreen" />
      </div>
    </div>
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
.wp-imgzoom.is-full {
  width: 100vw;
  height: 100vh;
  padding: var(--wp-space-3);
  box-sizing: border-box;
  background: var(--wp-bg);
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
  display: flex;
  gap: 8px; /* PANE_GAP */
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--wp-radius);
  touch-action: none;
  outline: none;
}
.wp-imgzoom__pane {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--wp-radius);
  background: var(--wp-bg);
}
.wp-imgzoom__chrome { transition: opacity 0.25s ease; }
.wp-imgzoom.is-idle .wp-imgzoom__chrome { opacity: 0; pointer-events: none; }
.wp-imgzoom.is-idle .wp-imgzoom__stage.can-pan { cursor: none; }
@media (prefers-reduced-motion: reduce) {
  .wp-imgzoom__chrome { transition: none; }
}
.wp-imgzoom__map {
  position: absolute;
  /* Top right: the bottom holds the hint, the slots' captions and the fullscreen strip. */
  top: var(--wp-space-3);
  right: var(--wp-space-3);
  z-index: 2;
  width: 96px;
  max-height: 128px;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: var(--wp-radius-sm);
  background: black;
  box-shadow: var(--wp-shadow-md);
  cursor: pointer;
  touch-action: none;
}
.wp-imgzoom__map img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  opacity: 0.6;
  pointer-events: none;
  user-select: none;
}
.wp-imgzoom__map-box {
  position: absolute;
  border: 1.5px solid white;
  /* Darken what is out of view; the map clips the spread. */
  box-shadow: 0 0 0 999px rgb(0 0 0 / 0.35);
  pointer-events: none;
}
.wp-imgzoom__bottom {
  position: absolute;
  bottom: var(--wp-space-3);
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--wp-space-2);
  max-width: calc(100% - 2 * var(--wp-space-3));
  pointer-events: none;
}
.wp-imgzoom.is-full .wp-imgzoom__bottom { bottom: calc(var(--wp-space-3) * 2); }
.wp-imgzoom__full-foot {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  padding: var(--wp-space-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-md);
  background: var(--wp-bg-2);
  box-shadow: var(--wp-shadow-md);
  pointer-events: auto;
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
