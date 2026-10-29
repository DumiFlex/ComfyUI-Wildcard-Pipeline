<script setup lang="ts">
/**
 * Slider: a number picked by dragging along a range (a weight, a threshold,
 * a size). Use it when the feel of "more or less" matters more than the
 * exact number; add `with-input` to type the exact number too. Works on the
 * canvas (`size="sm"`) and in the manager (`md`).
 *
 *   <Slider v-model="weight" :min="0" :max="2" :step="0.05" aria-label="Weight" with-input />
 *   <Slider v-model="size" :min="4" :max="160" :marks="[{ value: 32, label: '32' }]" :format="(v) => `${v} px`" />
 *
 * APG slider: the thumb is the focus stop; arrows move one step, PageUp /
 * PageDown ten, Home / End jump to the ends, and `format` gives screen
 * readers the value as words ("32 px"). Clicking the track jumps there and
 * the drag carries on from it.
 */
import { computed, ref } from "vue";
import { keyStep, percentOf, snap, valueAt } from "./slider-math";
import WpNumber from "./WpNumber.vue";

const props = withDefaults(defineProps<{
  modelValue: number;
  min?: number;
  max?: number;
  step?: number;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  ariaLabel?: string;
  /** Labelled ticks under the track. */
  marks?: { value: number; label?: string }[];
  /** How the value reads (the tooltip-free label and screen readers). */
  format?: (v: number) => string;
  /** Show the value after the track. */
  showValue?: boolean;
  /** Put a WpNumber after the track to type the exact value. */
  withInput?: boolean;
}>(), { min: 0, max: 100, step: 1, size: "md", ariaLabel: undefined, marks: undefined });

const emit = defineEmits<{ (e: "update:modelValue", v: number): void; (e: "change", v: number): void }>();

const trackEl = ref<HTMLElement | null>(null);
const dragging = ref(false);

const value = computed(() => snap(props.modelValue, props.min, props.max, props.step));
const pct = computed(() => percentOf(value.value, props.min, props.max));
const text = computed(() => (props.format ? props.format(value.value) : String(value.value)));

function set(v: number): void {
  if (props.disabled) return;
  if (v !== props.modelValue) emit("update:modelValue", v);
}

function fromPointer(ev: PointerEvent): number {
  const r = trackEl.value?.getBoundingClientRect();
  if (!r) return value.value;
  return valueAt(ev.clientX, r.left, r.width, props.min, props.max, props.step);
}

function onPointerDown(ev: PointerEvent): void {
  if (props.disabled || ev.button !== 0) return;
  ev.preventDefault();
  dragging.value = true;
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  set(fromPointer(ev));
  (trackEl.value?.querySelector("[role=slider]") as HTMLElement | null)?.focus();
}

function onPointerMove(ev: PointerEvent): void {
  if (dragging.value) set(fromPointer(ev));
}

function onPointerUp(ev: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
  emit("change", value.value);
}

function onKeydown(ev: KeyboardEvent): void {
  if (props.disabled) return;
  const next = keyStep(ev.key, value.value, props.min, props.max, props.step);
  if (next === null) return;
  ev.preventDefault();
  set(next);
  emit("change", next);
}

function onTyped(v: number | null): void {
  if (v === null) return;
  const next = snap(v, props.min, props.max, props.step);
  set(next);
  emit("change", next);
}
</script>

<template>
  <div class="wp-slider" :data-size="size" :data-disabled="disabled || undefined" :data-dragging="dragging || undefined" :data-marked="marks?.length ? 'true' : undefined">
    <div
      ref="trackEl"
      class="wp-slider__track"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="wp-slider__rail" />
      <div class="wp-slider__fill" :style="{ width: `calc(${pct}% + var(--_thumb) / 2)` }" />
      <span
        v-for="m in marks ?? []"
        :key="m.value"
        class="wp-slider__mark"
        :data-passed="m.value <= value || undefined"
        :style="{ left: `${percentOf(m.value, min, max)}%` }"
        aria-hidden="true"
      ><span v-if="m.label" class="wp-slider__mark-label">{{ m.label }}</span></span>
      <!-- Focusable unless disabled (tabindex is bound). -->
      <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
      <div
        class="wp-slider__thumb"
        role="slider"
        :tabindex="disabled ? -1 : 0"
        :aria-label="ariaLabel"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="value"
        :aria-valuetext="format ? text : undefined"
        :aria-disabled="disabled || undefined"
        :style="{ left: `${pct}%` }"
        @keydown="onKeydown"
      />
    </div>
    <span v-if="showValue && !withInput" class="wp-slider__value" aria-hidden="true">{{ text }}</span>
    <WpNumber
      v-if="withInput"
      class="wp-slider__input"
      :model-value="value"
      :min="min"
      :max="max"
      :step="step"
      :size="size"
      :disabled="disabled"
      :aria-label="ariaLabel ? `${ariaLabel}, exact value` : 'Exact value'"
      @update:model-value="onTyped"
    />
  </div>
</template>

<style scoped>
.wp-slider {
  --_h: var(--wp-control-h-md);
  --_thumb: 16px;
  display: flex; align-items: center; gap: var(--wp-space-4); min-width: 0; width: 100%;
  min-height: var(--_h); font-family: var(--wp-font-sans);
}
.wp-slider[data-size="sm"] { --_h: var(--wp-control-h-sm); --_thumb: 12px; gap: var(--wp-space-3); }
.wp-slider[data-size="lg"] { --_h: var(--wp-control-h-lg); --_thumb: 18px; }
.wp-slider[data-marked] { padding-bottom: 14px; }
.wp-slider__track {
  position: relative; flex: 1; min-width: 60px; height: var(--_h);
  margin: 0 calc(var(--_thumb) / 2); cursor: pointer; touch-action: none;
}
.wp-slider__rail, .wp-slider__fill {
  position: absolute; top: 50%; left: 0; height: 4px; margin-top: -2px; border-radius: var(--wp-radius-cap, 999px);
}
.wp-slider__rail { right: 0; left: calc(var(--_thumb) / -2); right: calc(var(--_thumb) / -2); background: var(--wp-bg-3); box-shadow: inset 0 0 0 1px var(--wp-border-soft); }
.wp-slider__fill { left: calc(var(--_thumb) / -2); background: var(--wp-accent); }
.wp-slider[data-size="sm"] .wp-slider__rail, .wp-slider[data-size="sm"] .wp-slider__fill { height: 3px; margin-top: -1.5px; }
.wp-slider__thumb {
  position: absolute; top: 50%; box-sizing: border-box;
  width: var(--_thumb); height: var(--_thumb); margin: calc(var(--_thumb) / -2) 0 0 calc(var(--_thumb) / -2);
  border: 2px solid var(--wp-accent); border-radius: min(50%, var(--wp-radius-cap, 999px)); background: var(--wp-bg);
  box-shadow: var(--wp-shadow-sm); outline: none;
  transition: transform var(--wp-motion-quick), box-shadow var(--wp-motion-quick);
}
.wp-slider__track:hover .wp-slider__thumb, .wp-slider[data-dragging] .wp-slider__thumb { transform: scale(1.12); }
.wp-slider__thumb:focus-visible { box-shadow: 0 0 0 3px var(--wp-focus-ring); }
.wp-slider__mark {
  position: absolute; top: 50%; width: 2px; height: 8px; margin: -4px 0 0 -1px; border-radius: min(1px, var(--wp-radius-cap, 999px));
  background: var(--wp-border-strong); pointer-events: none;
}
.wp-slider__mark[data-passed] { background: color-mix(in srgb, var(--wp-accent) 60%, var(--wp-bg)); }
.wp-slider__mark-label {
  position: absolute; top: calc(var(--_h) / 2 + 2px); left: 50%; transform: translateX(-50%);
  color: var(--wp-text-dim); font-size: 10px; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.wp-slider__value {
  flex: none; min-width: 3ch; text-align: right; color: var(--wp-text); font: 500 var(--wp-text-sm)/1 var(--wp-font-sans);
  font-variant-numeric: tabular-nums;
}
.wp-slider[data-size="sm"] .wp-slider__value { font-size: var(--wp-text-xs); }
.wp-slider__input { flex: none; width: 84px; }
.wp-slider[data-size="sm"] .wp-slider__input { width: 64px; }
.wp-slider[data-disabled] { opacity: 0.45; }
.wp-slider[data-disabled] .wp-slider__track { cursor: not-allowed; }
.wp-slider[data-disabled] .wp-slider__thumb { transform: none; }
@media (prefers-reduced-motion: reduce) {
  .wp-slider__thumb { transition: none; }
}
</style>
