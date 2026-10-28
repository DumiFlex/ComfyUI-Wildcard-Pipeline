<script setup lang="ts">
/**
 * Resize handle: the grip on a panel's edge that drags it wider or taller
 * (a drawer's width, a column, a box's height). It owns the size in pixels
 * through v-model; the parent puts that size on the panel. Works on the
 * canvas and in the manager. Two panels side by side use SplitPane, which
 * is built on this.
 *
 *   <aside :style="{ width: `${w}px` }">…<ResizeHandle v-model="w" axis="x" reverse :min="280" :max="720" label="Chat width" /></aside>
 *
 * APG window splitter: `role="separator"` that takes focus; the arrows move
 * it 16 px (Shift: 64), Home / End jump to min / max, Enter or a double
 * click puts back `default-size`. `reverse` is for a handle on a panel's
 * left or top edge, where dragging toward the start makes it bigger.
 */
import { computed, ref } from "vue";

const props = withDefaults(defineProps<{
  /** The panel's size in px. */
  modelValue: number;
  /** x: the handle changes width (an upright bar). y: height (a flat bar). */
  axis?: "x" | "y";
  min?: number;
  max?: number;
  /** Dragging toward the start (left / up) makes the panel bigger. */
  reverse?: boolean;
  /** Where Enter and a double click put it back. */
  defaultSize?: number;
  /** Keyboard step in px. */
  step?: number;
  /** What it resizes, for screen readers ("Chat width"). */
  label: string;
  /** The id of the panel it resizes. */
  controls?: string;
  disabled?: boolean;
}>(), { axis: "x", min: 0, max: Number.POSITIVE_INFINITY, defaultSize: undefined, step: 16, controls: undefined });

const emit = defineEmits<{ (e: "update:modelValue", v: number): void; (e: "end", v: number): void }>();

const dragging = ref(false);
let start = 0;
let startSize = 0;

const clamp = (v: number): number => Math.round(Math.min(props.max, Math.max(props.min, v)));
const finiteMax = computed(() => (Number.isFinite(props.max) ? props.max : undefined));

function set(v: number): void {
  const next = clamp(v);
  if (next !== props.modelValue) emit("update:modelValue", next);
}

function onPointerDown(ev: PointerEvent): void {
  if (props.disabled || ev.button !== 0) return;
  ev.preventDefault();
  dragging.value = true;
  start = props.axis === "x" ? ev.clientX : ev.clientY;
  startSize = props.modelValue;
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
}

function onPointerMove(ev: PointerEvent): void {
  if (!dragging.value) return;
  const d = (props.axis === "x" ? ev.clientX : ev.clientY) - start;
  set(startSize + (props.reverse ? -d : d));
}

function onPointerUp(ev: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
  emit("end", props.modelValue);
}

function reset(): void {
  if (props.defaultSize === undefined || props.disabled) return;
  set(props.defaultSize);
  emit("end", clamp(props.defaultSize));
}

function onKeydown(ev: KeyboardEvent): void {
  if (props.disabled) return;
  const s = ev.shiftKey ? props.step * 4 : props.step;
  const grow = props.reverse ? -1 : 1;
  const fwd = props.axis === "x" ? "ArrowRight" : "ArrowDown";
  const back = props.axis === "x" ? "ArrowLeft" : "ArrowUp";
  let next: number;
  if (ev.key === fwd) next = props.modelValue + s * grow;
  else if (ev.key === back) next = props.modelValue - s * grow;
  else if (ev.key === "Home") next = props.min;
  else if (ev.key === "End" && finiteMax.value !== undefined) next = finiteMax.value;
  else if (ev.key === "Enter") { ev.preventDefault(); reset(); return; }
  else return;
  ev.preventDefault();
  set(next);
  emit("end", clamp(next));
}
</script>

<!-- APG window splitter: a focusable separator is interactive. -->
<!-- eslint-disable vuejs-accessibility/no-static-element-interactions -->
<template>
  <div
    class="wp-resize"
    role="separator"
    :tabindex="disabled ? -1 : 0"
    :aria-label="label"
    :aria-orientation="axis === 'x' ? 'vertical' : 'horizontal'"
    :aria-valuenow="modelValue"
    :aria-valuemin="min"
    :aria-valuemax="finiteMax"
    :aria-controls="controls"
    :aria-disabled="disabled || undefined"
    :data-axis="axis"
    :data-dragging="dragging || undefined"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="reset"
    @keydown="onKeydown"
  />
</template>

<style scoped>
.wp-resize {
  position: relative; flex: none; z-index: 1; outline: none; touch-action: none;
}
.wp-resize[data-axis="x"] { width: 8px; margin: 0 -4px; cursor: col-resize; align-self: stretch; }
.wp-resize[data-axis="y"] { height: 8px; margin: -4px 0; cursor: row-resize; width: 100%; }
.wp-resize::after {
  content: ""; position: absolute; border-radius: min(1px, var(--wp-radius-cap, 999px)); background: transparent;
  transition: background var(--wp-motion-hover);
}
.wp-resize[data-axis="x"]::after { top: 0; bottom: 0; left: 3px; width: 2px; }
.wp-resize[data-axis="y"]::after { left: 0; right: 0; top: 3px; height: 2px; }
.wp-resize:hover::after, .wp-resize[data-dragging]::after { background: var(--wp-accent); }
.wp-resize:focus-visible::after { background: var(--wp-border-focus); box-shadow: 0 0 0 1px var(--wp-border-focus); }
.wp-resize[aria-disabled="true"] { cursor: default; }
.wp-resize[aria-disabled="true"]::after { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .wp-resize::after { transition: none; }
}
</style>
