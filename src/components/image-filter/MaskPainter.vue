<script setup lang="ts">
/**
 * MaskPainter — paint a mask over one image in the Image Filter's Detail.
 *
 * The canvas is the image's natural size and is scaled with it, so strokes
 * land where they look. Three tools: a round **brush** (size, hardness for a
 * soft edge, strength), a **lasso** that fills what you circle and a **fill**
 * that takes the connected area of the mask under the click; `erase` turns
 * each of them into taking mask away. The mask itself is a byte per pixel
 * (`mask-ops.ts`); the canvas only shows it in a tint. What goes out
 * (`update:modelValue`) is a PNG whose alpha is the mask (painted = masked,
 * soft edges in between), or "" when nothing is painted. A ring under the
 * pointer shows the brush (dashed when erasing, an inner ring where a soft
 * edge starts).
 */
import { computed, onMounted, ref, watch } from "vue";
import {
  composite, copyBuf, feather, floodFill, fullRect, invertBuf, isBlank, makeBuf, MaskHistory, polygon, segment,
  unionRect, type MaskBuf, type Rect,
} from "./mask-ops";

export type MaskTool = "brush" | "lasso" | "fill";

const props = withDefaults(
  defineProps<{
    src: string;
    /** The saved mask (PNG data URL) or "". */
    modelValue: string;
    tool?: MaskTool;
    /** Take mask away instead of adding it. */
    erase?: boolean;
    /** Brush diameter in screen pixels. */
    size?: number;
    /** Where the soft edge starts, 0..100 (100 = a hard edge). */
    hardness?: number;
    /** How much one stroke, lasso or fill masks, 1..100. */
    strength?: number;
  }>(),
  { tool: "brush", erase: false, size: 40, hardness: 100, strength: 100 },
);
const emit = defineEmits<{ "update:modelValue": [url: string] }>();

const TINT: [number, number, number] = [255, 72, 96];

const img = ref<HTMLImageElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const lassoCanvas = ref<HTMLCanvasElement | null>(null);

/** The mask as last committed, what a stroke is laid over, and what shows. */
let mask: MaskBuf = makeBuf(0, 0);
let cover: MaskBuf = makeBuf(0, 0);
let view: MaskBuf = makeBuf(0, 0);
let pixels: ImageData | null = null;
const history = new MaskHistory(30);
/** Bumped on every history change, so Undo / Redo buttons follow. */
const historyTick = ref(0);
const canUndo = computed(() => historyTick.value >= 0 && history.canUndo);
const canRedo = computed(() => historyTick.value >= 0 && history.canRedo);

let drawing = false;
let last: { x: number; y: number } | null = null;
let strokeRect: Rect | null = null;
/** The lasso's path, in canvas pixels, while it is drawn. */
const lasso = ref<{ x: number; y: number }[]>([]);

/** Draw the lasso's path as a dashed outline over a faint tint. */
watch(lasso, (pts) => {
  const el = lassoCanvas.value;
  const c = el?.getContext("2d");
  if (!el || !c) return;
  if (el.width !== mask.width || el.height !== mask.height) {
    el.width = mask.width;
    el.height = mask.height;
  }
  c.clearRect(0, 0, el.width, el.height);
  if (pts.length < 2) return;
  // Line widths in screen pixels, whatever the image's size on screen.
  const r = el.getBoundingClientRect();
  const k = r.width ? el.width / r.width : 1;
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
  c.fillStyle = `rgb(${TINT.join(" ")} / 0.18)`;
  c.fill();
  c.lineWidth = 3 * k;
  c.strokeStyle = "rgb(0 0 0 / 0.6)";
  c.setLineDash([]);
  c.stroke();
  c.lineWidth = 1.5 * k;
  c.strokeStyle = "white";
  c.setLineDash([5 * k, 4 * k]);
  c.stroke();
});

/** Where the brush ring sits, in px from the painter's top-left; null hides it. */
const ring = ref<{ x: number; y: number } | null>(null);
const ringStyle = computed(() => props.tool === "brush" && ring.value ? ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  transform: `translate(${ring.value.x - props.size / 2}px, ${ring.value.y - props.size / 2}px)`,
}) : null);
/** The inner ring: where a soft brush stops being solid. */
const softPct = computed(() => (props.hardness < 100 ? Math.max(0, Math.min(100, props.hardness)) : null));

function placeRing(ev: PointerEvent): void {
  const r = canvas.value?.getBoundingClientRect();
  ring.value = r ? { x: ev.clientX - r.left, y: ev.clientY - r.top } : null;
}

function ctx(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext("2d") ?? null;
}

/** Draw `rect` of the shown mask onto the canvas, in the tint. */
function render(rect: Rect | null = null): void {
  const c = ctx();
  if (!c || !view.width) return;
  if (!pixels || pixels.width !== view.width || pixels.height !== view.height) {
    pixels = c.createImageData(view.width, view.height);
    rect = fullRect(view);
  }
  const r = rect ?? fullRect(view);
  const d = pixels.data;
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = y * view.width + x;
      const o = i * 4;
      d[o] = TINT[0];
      d[o + 1] = TINT[1];
      d[o + 2] = TINT[2];
      d[o + 3] = view.data[i];
    }
  }
  c.putImageData(pixels, 0, 0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
}

function resetBuffers(width: number, height: number): void {
  mask = makeBuf(width, height);
  cover = makeBuf(width, height);
  view = makeBuf(width, height);
  pixels = null;
}

/** Read a saved mask's alpha into the buffers. */
function load(url: string): void {
  const el = canvas.value;
  if (!el) return;
  resetBuffers(el.width, el.height);
  render();
  if (!url) return;
  const saved = new Image();
  saved.onload = () => {
    const tmp = document.createElement("canvas");
    tmp.width = el.width;
    tmp.height = el.height;
    const t = tmp.getContext("2d");
    if (!t) return;
    t.drawImage(saved, 0, 0, el.width, el.height);
    const data = t.getImageData(0, 0, el.width, el.height).data;
    for (let i = 0; i < mask.data.length; i++) mask.data[i] = data[i * 4 + 3];
    view.data.set(mask.data);
    render();
  };
  saved.src = url;
}

function sizeCanvas(): void {
  const el = canvas.value;
  const im = img.value;
  if (!el || !im || !im.naturalWidth) return;
  if (el.width !== im.naturalWidth || el.height !== im.naturalHeight) {
    el.width = im.naturalWidth;
    el.height = im.naturalHeight;
  }
  load(props.modelValue);
}

// The parent keys this component by image, so one instance paints one image.
let exported = props.modelValue;

onMounted(() => {
  if (img.value?.complete) sizeCanvas();
});
// Reload only for a change that didn't come from our own strokes (a reset
// from outside).
watch(() => props.modelValue, (url) => {
  if (url !== exported) {
    exported = url;
    load(url);
  }
});

function point(ev: PointerEvent): { x: number; y: number; scale: number } | null {
  const el = canvas.value;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const scale = el.width / r.width;
  return { x: (ev.clientX - r.left) * scale, y: (ev.clientY - r.top) * (el.height / r.height), scale };
}

const hard = (): number => Math.max(0, Math.min(100, props.hardness)) / 100;
const strength = (): number => Math.max(1, Math.min(100, props.strength)) / 100;

/** Lay the cover onto the mask inside `rect` and show it. */
function show(rect: Rect | null): void {
  if (!rect) return;
  composite(mask, cover, view, rect, strength(), props.erase);
  render(rect);
}

/** Make what shows the mask, clear the cover, send it out. */
function commit(rect: Rect | null): void {
  mask.data.set(view.data);
  if (rect) for (let y = rect.y0; y < rect.y1; y++) cover.data.fill(0, y * cover.width + rect.x0, y * cover.width + rect.x1);
  emitMask();
}

function brushTo(p: { x: number; y: number; scale: number }): void {
  const radius = (props.size * p.scale) / 2;
  const from = last ?? p;
  const dirty = segment(cover, from.x, from.y, p.x, p.y, radius, hard());
  strokeRect = unionRect(strokeRect, dirty);
  show(dirty);
  last = p;
}

/** A soft edge for lasso and fill: up to half the brush size at hardness 0. */
function featherPx(scale: number): number {
  return (1 - hard()) * (props.size * scale) / 2;
}

function fillAt(p: { x: number; y: number; scale: number }): void {
  history.push(mask);
  historyTick.value++;
  let dirty = floodFill(mask, cover, p.x, p.y);
  if (dirty && hard() < 1) dirty = feather(cover, dirty, featherPx(p.scale));
  show(dirty);
  commit(dirty);
}

function closeLasso(scale: number): void {
  const pts = lasso.value;
  lasso.value = [];
  if (pts.length < 3) return;
  history.push(mask);
  historyTick.value++;
  let dirty = polygon(cover, pts);
  if (dirty && hard() < 1) dirty = feather(cover, dirty, featherPx(scale));
  show(dirty);
  commit(dirty);
}

let lassoScale = 1;

function onDown(ev: PointerEvent): void {
  if (ev.button !== 0) return;
  ev.preventDefault();
  const p = point(ev);
  if (!p || !mask.width) return;
  if (props.tool === "fill") {
    fillAt(p);
    return;
  }
  (ev.target as Element).setPointerCapture?.(ev.pointerId);
  drawing = true;
  if (props.tool === "lasso") {
    lassoScale = p.scale;
    lasso.value = [{ x: p.x, y: p.y }];
    return;
  }
  history.push(mask);
  historyTick.value++;
  last = null;
  strokeRect = null;
  brushTo(p);
}

function onMove(ev: PointerEvent): void {
  placeRing(ev);
  if (!drawing) return;
  const p = point(ev);
  if (!p) return;
  if (props.tool === "lasso") {
    const prev = lasso.value[lasso.value.length - 1];
    // A point every couple of screen pixels is plenty for the outline.
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 2 * p.scale) lasso.value = [...lasso.value, { x: p.x, y: p.y }];
    return;
  }
  brushTo(p);
}

function onLeave(): void {
  ring.value = null;
  // A captured pointer gets no leave until it is let go, so this only ends a
  // stroke the browser couldn't capture.
  onUp();
}

function onUp(): void {
  if (!drawing) return;
  drawing = false;
  if (props.tool === "lasso") {
    closeLasso(lassoScale);
    return;
  }
  last = null;
  commit(strokeRect);
  strokeRect = null;
}

function emitMask(): void {
  let url = "";
  const c = ctx();
  if (c && mask.width && !isBlank(mask)) {
    const out = document.createElement("canvas");
    out.width = mask.width;
    out.height = mask.height;
    const o = out.getContext("2d");
    if (o) {
      const data = o.createImageData(mask.width, mask.height);
      for (let i = 0; i < mask.data.length; i++) {
        data.data[i * 4] = 255;
        data.data[i * 4 + 1] = 255;
        data.data[i * 4 + 2] = 255;
        data.data[i * 4 + 3] = mask.data[i];
      }
      o.putImageData(data, 0, 0);
      url = out.toDataURL("image/png");
    }
  }
  exported = url;
  emit("update:modelValue", url);
}

/** Change the whole mask as one undo step. */
function wholeChange(change: (b: MaskBuf) => void): void {
  if (!mask.width) return;
  history.push(mask);
  historyTick.value++;
  change(mask);
  view.data.set(mask.data);
  render();
  emitMask();
}

function clear(): void {
  wholeChange((b) => b.data.fill(0));
}

function invert(): void {
  wholeChange(invertBuf);
}

function undo(): void {
  if (drawing || !history.undo(mask)) return;
  historyTick.value++;
  view.data.set(mask.data);
  render();
  emitMask();
}

function redo(): void {
  if (drawing || !history.redo(mask)) return;
  historyTick.value++;
  view.data.set(mask.data);
  render();
  emitMask();
}

/** For tests: a copy of the mask as it stands. */
function snapshot(): MaskBuf {
  return copyBuf(mask);
}

defineExpose({ clear, invert, undo, redo, canUndo, canRedo, snapshot });
</script>

<template>
  <div class="wp-ifm" data-test="image-filter-mask">
    <img ref="img" :src="src" class="wp-ifm__img" alt="" draggable="false" @load="sizeCanvas">
    <canvas
      ref="canvas"
      class="wp-ifm__canvas"
      :class="[`is-${tool}`, { 'is-eraser': erase }]"
      :data-tool="tool"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerenter="placeRing"
      @pointerleave="onLeave"
    />
    <canvas v-show="lasso.length > 1" ref="lassoCanvas" class="wp-ifm__lasso" aria-hidden="true" data-test="image-filter-lasso" />
    <span
      v-if="ringStyle"
      class="wp-ifm__ring"
      :class="{ 'is-eraser': erase }"
      :style="ringStyle"
      aria-hidden="true"
      data-test="image-filter-brush-ring"
    >
      <span v-if="softPct !== null" class="wp-ifm__ring-solid" :style="{ width: `${softPct}%`, height: `${softPct}%` }" data-test="image-filter-brush-soft" />
    </span>
  </div>
</template>

<style scoped>
.wp-ifm { position: relative; display: inline-block; line-height: 0; max-width: 100%; }
.wp-ifm__img { display: block; max-width: 100%; max-height: var(--wp-ifp-stage-h, calc(90vh - 200px)); border-radius: min(6px, var(--wp-radius-cap, 999px)); user-select: none; }
.wp-ifm__canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .55; cursor: none; touch-action: none; border-radius: min(6px, var(--wp-radius-cap, 999px)); }
.wp-ifm__canvas.is-lasso, .wp-ifm__canvas.is-fill { cursor: crosshair; }
.wp-ifm__lasso { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
/* The brush ring: white with a dark edge so it reads on any picture. */
.wp-ifm__ring {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1.5px solid white;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6), inset 0 0 0 1px rgb(0 0 0 / 0.6);
  pointer-events: none;
}
.wp-ifm__ring.is-eraser { border-style: dashed; }
.wp-ifm__ring-solid { box-sizing: border-box; flex: none; border: 1px dotted rgb(255 255 255 / 0.85); border-radius: 50%; }
</style>
