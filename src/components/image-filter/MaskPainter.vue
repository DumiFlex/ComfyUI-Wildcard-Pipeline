<script setup lang="ts">
/**
 * MaskPainter — paint a mask over one image in the Image Filter zoom.
 *
 * The canvas is the image's natural size and is scaled with it, so strokes
 * land where they look. Strokes are drawn in a tint for display; what goes
 * out (`update:modelValue`) is a PNG whose alpha is the mask (painted =
 * masked), or "" when nothing is painted. The node reads that alpha and
 * resizes it to the image.
 */
import { onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    src: string;
    /** The saved mask (PNG data URL) or "". */
    modelValue: string;
    tool?: "brush" | "eraser";
    /** Brush diameter in screen pixels. */
    size?: number;
  }>(),
  { tool: "brush", size: 40 },
);
const emit = defineEmits<{ "update:modelValue": [url: string] }>();

const TINT = "rgb(255, 72, 96)";

const img = ref<HTMLImageElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
let drawing = false;
let last: { x: number; y: number } | null = null;

function ctx(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext("2d") ?? null;
}

/** Re-tint a saved (white-alpha) mask after drawing it in. */
function load(url: string): void {
  const c = ctx();
  const el = canvas.value;
  if (!c || !el) return;
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, el.width, el.height);
  if (!url) return;
  const saved = new Image();
  saved.onload = () => {
    c.globalCompositeOperation = "source-over";
    c.drawImage(saved, 0, 0, el.width, el.height);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = TINT;
    c.fillRect(0, 0, el.width, el.height);
    c.globalCompositeOperation = "source-over";
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
// Reload only for a change that didn't come from our own strokes (an undo
// from outside, a reset).
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

function stroke(to: { x: number; y: number; scale: number }): void {
  const c = ctx();
  if (!c) return;
  c.globalCompositeOperation = props.tool === "eraser" ? "destination-out" : "source-over";
  c.strokeStyle = TINT;
  c.fillStyle = TINT;
  c.lineWidth = props.size * to.scale;
  c.lineCap = "round";
  c.lineJoin = "round";
  const from = last ?? to;
  c.beginPath();
  c.moveTo(from.x, from.y);
  c.lineTo(to.x, to.y);
  c.stroke();
  if (!last) {
    c.beginPath();
    c.arc(to.x, to.y, c.lineWidth / 2, 0, Math.PI * 2);
    c.fill();
  }
  last = to;
}

function onDown(ev: PointerEvent): void {
  if (ev.button !== 0) return;
  ev.preventDefault();
  (ev.target as Element).setPointerCapture?.(ev.pointerId);
  drawing = true;
  last = null;
  const p = point(ev);
  if (p) stroke(p);
}

function onMove(ev: PointerEvent): void {
  if (!drawing) return;
  const p = point(ev);
  if (p) stroke(p);
}

function onUp(): void {
  if (!drawing) return;
  drawing = false;
  last = null;
  emitMask();
}

function isEmpty(): boolean {
  const el = canvas.value;
  const c = ctx();
  if (!el || !c || !el.width) return true;
  const data = c.getImageData(0, 0, el.width, el.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return false;
  return true;
}

function emitMask(): void {
  const el = canvas.value;
  if (!el) return;
  let url = "";
  if (!isEmpty()) {
    const out = document.createElement("canvas");
    out.width = el.width;
    out.height = el.height;
    const o = out.getContext("2d");
    if (o) {
      o.drawImage(el, 0, 0);
      o.globalCompositeOperation = "source-in";
      o.fillStyle = "#fff";
      o.fillRect(0, 0, out.width, out.height);
      url = out.toDataURL("image/png");
    }
  }
  exported = url;
  emit("update:modelValue", url);
}

function clear(): void {
  const el = canvas.value;
  ctx()?.clearRect(0, 0, el?.width ?? 0, el?.height ?? 0);
  emitMask();
}

function invert(): void {
  const el = canvas.value;
  const c = ctx();
  if (!el || !c) return;
  const copy = document.createElement("canvas");
  copy.width = el.width;
  copy.height = el.height;
  copy.getContext("2d")?.drawImage(el, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, el.width, el.height);
  c.fillStyle = TINT;
  c.fillRect(0, 0, el.width, el.height);
  c.globalCompositeOperation = "destination-out";
  c.drawImage(copy, 0, 0);
  c.globalCompositeOperation = "source-over";
  emitMask();
}

defineExpose({ clear, invert });
</script>

<template>
  <div class="wp-ifm" data-test="image-filter-mask">
    <img ref="img" :src="src" class="wp-ifm__img" alt="" draggable="false" @load="sizeCanvas">
    <canvas
      ref="canvas"
      class="wp-ifm__canvas"
      :class="{ 'is-eraser': tool === 'eraser' }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onUp"
    />
  </div>
</template>

<style scoped>
.wp-ifm { position: relative; display: inline-block; line-height: 0; max-width: 100%; }
.wp-ifm__img { display: block; max-width: 100%; max-height: calc(90vh - 200px); border-radius: 6px; user-select: none; }
.wp-ifm__canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .55; cursor: crosshair; touch-action: none; border-radius: 6px; }
.wp-ifm__canvas.is-eraser { cursor: cell; }
</style>
