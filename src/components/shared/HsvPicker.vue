<script setup lang="ts">
/**
 * HsvPicker — saturation/value square + hue slider.
 *
 * Shared between manager ColorPicker / TweaksPanel AND the canvas
 * bundle modal. CSS uses `--wp-*` tokens with hardcoded fallbacks so
 * the picker renders inside the extension where the manager spacing
 * tokens (`--wp-space-*`) aren't loaded.
 *
 * Pure CSS gradient render — no canvas. The SV square stacks three
 * gradients to produce the HSV picker visual; the hue strip is a
 * single multi-stop linear gradient across the spectrum.
 *
 * Drag is driven by document-level `pointermove` + `pointerup`
 * listeners attached on pointerdown and detached on release. The
 * earlier `setPointerCapture`-based approach locked up the hue
 * slider when the SV picker reached an edge: in certain hosts
 * (notably the canvas Teleport popover), capture wasn't always
 * released cleanly, so subsequent pointerdown events on the hue
 * slider got rerouted back to the SV element and the slider read
 * as "stuck". Document-level handlers don't depend on element
 * capture and always cleanly tear down on pointerup, even when the
 * release happens outside the picker.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { hexToHsv, hsvToHex, type Hsv } from "./hsv";

interface Props {
  modelValue: string;
  ariaLabel?: string;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const hsv = ref<Hsv>({ h: 0, s: 1, v: 1 });

function syncFromProp(hex: string) {
  const parsed = hexToHsv(hex);
  if (!parsed) return;
  // Preserve the local hue when incoming RGB is pure black/white —
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

const svEl = ref<HTMLDivElement | null>(null);
const hueEl = ref<HTMLDivElement | null>(null);

/** Document-level drag state. Only one drag can be active at a time
 *  (one mouse / one finger), so a single `activeDrag` ref tracking
 *  which surface owns the current pointer is sufficient. */
let activeDrag: "sv" | "hue" | null = null;

function handleSvMove(evt: PointerEvent) {
  const el = svEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, evt.clientY - rect.top));
  hsv.value = { h: hsv.value.h, s: x / rect.width, v: 1 - (y / rect.height) };
  emitHex();
}

function handleHueMove(evt: PointerEvent) {
  const el = hueEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, evt.clientX - rect.left));
  hsv.value = { h: (x / rect.width) * 360, s: hsv.value.s, v: hsv.value.v };
  emitHex();
}

function onDocPointerMove(evt: PointerEvent) {
  if (activeDrag === "sv") handleSvMove(evt);
  else if (activeDrag === "hue") handleHueMove(evt);
}

function onDocPointerUp() {
  activeDrag = null;
  document.removeEventListener("pointermove", onDocPointerMove);
  document.removeEventListener("pointerup", onDocPointerUp);
  document.removeEventListener("pointercancel", onDocPointerUp);
}

function startDrag(kind: "sv" | "hue", evt: PointerEvent) {
  activeDrag = kind;
  if (kind === "sv") handleSvMove(evt);
  else handleHueMove(evt);
  document.addEventListener("pointermove", onDocPointerMove);
  document.addEventListener("pointerup", onDocPointerUp);
  document.addEventListener("pointercancel", onDocPointerUp);
}

function onSvPointerDown(evt: PointerEvent) {
  evt.preventDefault();
  startDrag("sv", evt);
}
function onHuePointerDown(evt: PointerEvent) {
  evt.preventDefault();
  startDrag("hue", evt);
}

onBeforeUnmount(onDocPointerUp);

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
    >
      <div class="wp-hsv-picker__sv-cursor" :style="svCursorStyle" />
    </div>
    <div
      ref="hueEl"
      class="wp-hsv-picker__hue"
      :aria-label="`Hue, current ${Math.round(hsv.h)}°`"
      data-test="hsv-hue"
      @pointerdown="onHuePointerDown"
    >
      <div class="wp-hsv-picker__hue-cursor" :style="hueCursorStyle" />
    </div>
  </div>
</template>

<style scoped>
.wp-hsv-picker { display: flex; flex-direction: column; gap: var(--wp-space-4, 8px); width: 100%; }
.wp-hsv-picker__sv {
  position: relative;
  width: 100%;
  height: 120px;
  border-radius: var(--wp-radius-sm, 4px);
  border: 1px solid var(--wp-border, #3a3a3a);
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
  border-radius: var(--wp-radius-sm, 4px);
  border: 1px solid var(--wp-border, #3a3a3a);
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
  border-radius: var(--wp-radius-sm, 4px);
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.45);
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: transparent;
}
</style>
