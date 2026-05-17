<script setup lang="ts">
/**
 * HsvPicker — saturation/value square + hue slider. Replaces the
 * native browser `<input type="color">` so the picker theming matches
 * the rest of the manager UI across OSes (Windows' system dialog was
 * the trigger for moving away from native).
 *
 * Pure CSS gradient render — no canvas. The SV square stacks three
 * gradients to produce the HSV picker visual: black-to-transparent
 * (vertical) over white-to-transparent (horizontal) over the chosen
 * hue at full saturation/value. The hue strip is a single multi-stop
 * linear gradient across the spectrum.
 *
 * Pointer-events power drag. `setPointerCapture` on the active surface
 * ensures we keep getting `pointermove` even when the cursor leaves
 * the element, which is what users expect when dragging quickly.
 */
import { computed, ref, watch } from "vue";
import {
  hexToHsv,
  hsvToHex,
  type Hsv,
} from "../utils/hsv";

interface Props {
  modelValue: string;
  ariaLabel?: string;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

// Local HSV state — driven by the external hex but mutated by drags.
const hsv = ref<Hsv>({ h: 0, s: 1, v: 1 });

function syncFromProp(hex: string) {
  const parsed = hexToHsv(hex);
  if (!parsed) return;
  // Preserve the local hue when the incoming RGB is pure black/white —
  // otherwise the user's hue selection snaps to 0 every time s or v
  // hits 0, which is jarring during a vertical drag.
  if (parsed.s === 0) parsed.h = hsv.value.h;
  hsv.value = parsed;
}

watch(() => props.modelValue, syncFromProp, { immediate: true });

function emitHex() {
  emit("update:modelValue", hsvToHex(hsv.value));
}

const hueBg = computed(() => `hsl(${hsv.value.h}, 100%, 50%)`);

// ── SV square ────────────────────────────────────────────────────
const svEl = ref<HTMLDivElement | null>(null);

function handleSvPointer(evt: PointerEvent) {
  const el = svEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
  hsv.value = {
    h: hsv.value.h,
    s: x / rect.width,
    v: 1 - (y / rect.height),
  };
  emitHex();
}

function onSvPointerDown(evt: PointerEvent) {
  if (svEl.value) svEl.value.setPointerCapture(evt.pointerId);
  handleSvPointer(evt);
}
function onSvPointerMove(evt: PointerEvent) {
  if (!(evt.buttons & 1)) return;
  handleSvPointer(evt);
}
function onSvPointerUp(evt: PointerEvent) {
  if (svEl.value?.hasPointerCapture(evt.pointerId)) {
    svEl.value.releasePointerCapture(evt.pointerId);
  }
}

// ── Hue strip ────────────────────────────────────────────────────
const hueEl = ref<HTMLDivElement | null>(null);

function handleHuePointer(evt: PointerEvent) {
  const el = hueEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
  hsv.value = {
    h: (x / rect.width) * 360,
    s: hsv.value.s,
    v: hsv.value.v,
  };
  emitHex();
}

function onHuePointerDown(evt: PointerEvent) {
  if (hueEl.value) hueEl.value.setPointerCapture(evt.pointerId);
  handleHuePointer(evt);
}
function onHuePointerMove(evt: PointerEvent) {
  if (!(evt.buttons & 1)) return;
  handleHuePointer(evt);
}
function onHuePointerUp(evt: PointerEvent) {
  if (hueEl.value?.hasPointerCapture(evt.pointerId)) {
    hueEl.value.releasePointerCapture(evt.pointerId);
  }
}

const svCursorStyle = computed(() => ({
  left: `${hsv.value.s * 100}%`,
  top: `${(1 - hsv.value.v) * 100}%`,
}));

const hueCursorStyle = computed(() => ({
  left: `${(hsv.value.h / 360) * 100}%`,
}));
</script>

<template>
  <div class="wp-hsv-picker" :aria-label="ariaLabel">
    <div
      ref="svEl"
      class="wp-hsv-picker__sv"
      :style="{ '--wp-hsv-hue': hueBg }"
      :aria-label="`Saturation and brightness, current ${Math.round(hsv.s * 100)}% / ${Math.round(hsv.v * 100)}%`"
      data-test="hsv-sv"
      @pointerdown="onSvPointerDown"
      @pointermove="onSvPointerMove"
      @pointerup="onSvPointerUp"
      @pointercancel="onSvPointerUp"
    >
      <div class="wp-hsv-picker__sv-cursor" :style="svCursorStyle" />
    </div>
    <div
      ref="hueEl"
      class="wp-hsv-picker__hue"
      :aria-label="`Hue, current ${Math.round(hsv.h)}°`"
      data-test="hsv-hue"
      @pointerdown="onHuePointerDown"
      @pointermove="onHuePointerMove"
      @pointerup="onHuePointerUp"
      @pointercancel="onHuePointerUp"
    >
      <div class="wp-hsv-picker__hue-cursor" :style="hueCursorStyle" />
    </div>
  </div>
</template>

<style scoped>
.wp-hsv-picker {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
  width: 100%;
}

.wp-hsv-picker__sv {
  position: relative;
  width: 100%;
  height: 120px;
  border-radius: var(--wp-radius-sm);
  border: 1px solid var(--wp-border);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
  background:
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, transparent),
    var(--wp-hsv-hue, hsl(0, 100%, 50%));
}
.wp-hsv-picker__sv-cursor {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.45);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.wp-hsv-picker__hue {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: var(--wp-radius-sm);
  border: 1px solid var(--wp-border);
  cursor: ew-resize;
  touch-action: none;
  user-select: none;
  background: linear-gradient(
    to right,
    hsl(0, 100%, 50%),
    hsl(60, 100%, 50%),
    hsl(120, 100%, 50%),
    hsl(180, 100%, 50%),
    hsl(240, 100%, 50%),
    hsl(300, 100%, 50%),
    hsl(360, 100%, 50%)
  );
}
.wp-hsv-picker__hue-cursor {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 16px;
  border-radius: var(--wp-radius-sm);
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.45);
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: transparent;
}
</style>
