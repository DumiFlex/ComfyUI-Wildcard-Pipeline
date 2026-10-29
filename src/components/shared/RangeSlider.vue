<script setup lang="ts">
/**
 * Range slider: a low and a high number on one track (a weight range, a
 * token budget, a sweep's from–to). Two thumbs that can't cross, kept at
 * least `min-gap` apart; `with-input` adds a WpNumber for each end. Works on
 * the canvas (`size="sm"`) and in the manager (`md`).
 *
 *   <RangeSlider v-model="range" :min="0" :max="2" :step="0.1" aria-label="Weight" with-input />
 *
 * Each thumb is an APG slider ("Weight, low end" / "high end") whose
 * min and max are the other thumb, so screen readers hear the real limits.
 * A click on the track moves the nearer thumb.
 */
import { computed, ref } from "vue";
import { keyStep, percentOf, snap, valueAt } from "./slider-math";
import WpNumber from "./WpNumber.vue";

const props = withDefaults(defineProps<{
  modelValue: [number, number];
  min?: number;
  max?: number;
  step?: number;
  /** The smallest distance between the two ends. */
  minGap?: number;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  ariaLabel?: string;
  format?: (v: number) => string;
  withInput?: boolean;
}>(), { min: 0, max: 100, step: 1, minGap: 0, size: "md", ariaLabel: "Range" });

const emit = defineEmits<{ (e: "update:modelValue", v: [number, number]): void; (e: "change", v: [number, number]): void }>();

const trackEl = ref<HTMLElement | null>(null);
const active = ref<0 | 1 | null>(null);

const lo = computed(() => snap(Math.min(props.modelValue[0], props.modelValue[1]), props.min, props.max, props.step));
const hi = computed(() => snap(Math.max(props.modelValue[0], props.modelValue[1]), props.min, props.max, props.step));
const loPct = computed(() => percentOf(lo.value, props.min, props.max));
const hiPct = computed(() => percentOf(hi.value, props.min, props.max));
const text = (v: number): string => (props.format ? props.format(v) : String(v));

/** Put one end at `v`, kept inside the other end minus the gap. */
function setEnd(end: 0 | 1, v: number): [number, number] {
  const next: [number, number] = end === 0
    ? [Math.min(v, snap(hi.value - props.minGap, props.min, props.max, props.step)), hi.value]
    : [lo.value, Math.max(v, snap(lo.value + props.minGap, props.min, props.max, props.step))];
  if (next[0] !== props.modelValue[0] || next[1] !== props.modelValue[1]) emit("update:modelValue", next);
  return next;
}

function fromPointer(ev: PointerEvent): number {
  const r = trackEl.value?.getBoundingClientRect();
  return r ? valueAt(ev.clientX, r.left, r.width, props.min, props.max, props.step) : lo.value;
}

function onPointerDown(ev: PointerEvent): void {
  if (props.disabled || ev.button !== 0) return;
  ev.preventDefault();
  const v = fromPointer(ev);
  active.value = Math.abs(v - lo.value) <= Math.abs(v - hi.value) && !(v > hi.value) ? 0 : 1;
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  setEnd(active.value, v);
  trackEl.value?.querySelectorAll<HTMLElement>("[role=slider]")[active.value]?.focus();
}

function onPointerMove(ev: PointerEvent): void {
  if (active.value !== null) setEnd(active.value, fromPointer(ev));
}

function onPointerUp(ev: PointerEvent): void {
  if (active.value === null) return;
  active.value = null;
  (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
  emit("change", [lo.value, hi.value]);
}

function onKeydown(ev: KeyboardEvent, end: 0 | 1): void {
  if (props.disabled) return;
  const lowLimit = end === 0 ? props.min : lo.value + props.minGap;
  const highLimit = end === 0 ? hi.value - props.minGap : props.max;
  const cur = end === 0 ? lo.value : hi.value;
  const next = keyStep(ev.key, cur, props.min, props.max, props.step);
  if (next === null) return;
  ev.preventDefault();
  const v = ev.key === "Home" ? lowLimit : ev.key === "End" ? highLimit : next;
  emit("change", setEnd(end, v));
}

function onTyped(end: 0 | 1, v: number | null): void {
  if (v === null) return;
  emit("change", setEnd(end, snap(v, props.min, props.max, props.step)));
}
</script>

<template>
  <div class="wp-range-slider" :data-size="size" :data-disabled="disabled || undefined">
    <WpNumber
      v-if="withInput"
      class="wp-range-slider__input"
      :model-value="lo"
      :min="min"
      :max="hi - minGap"
      :step="step"
      :size="size"
      :disabled="disabled"
      :aria-label="`${ariaLabel}, low end`"
      @update:model-value="onTyped(0, $event)"
    />
    <div
      ref="trackEl"
      class="wp-range-slider__track"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="wp-range-slider__rail" />
      <div class="wp-range-slider__fill" :style="{ left: `${loPct}%`, width: `${hiPct - loPct}%` }" />
      <!-- Focusable unless disabled (tabindex is bound). -->
      <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
      <div
        v-for="end in ([0, 1] as const)"
        :key="end"
        class="wp-range-slider__thumb"
        role="slider"
        :tabindex="disabled ? -1 : 0"
        :aria-label="`${ariaLabel}, ${end === 0 ? 'low' : 'high'} end`"
        :aria-valuemin="end === 0 ? min : lo + minGap"
        :aria-valuemax="end === 0 ? hi - minGap : max"
        :aria-valuenow="end === 0 ? lo : hi"
        :aria-valuetext="format ? text(end === 0 ? lo : hi) : undefined"
        :aria-disabled="disabled || undefined"
        :data-active="active === end || undefined"
        :style="{ left: `${end === 0 ? loPct : hiPct}%` }"
        @keydown="onKeydown($event, end)"
      />
    </div>
    <WpNumber
      v-if="withInput"
      class="wp-range-slider__input"
      :model-value="hi"
      :min="lo + minGap"
      :max="max"
      :step="step"
      :size="size"
      :disabled="disabled"
      :aria-label="`${ariaLabel}, high end`"
      @update:model-value="onTyped(1, $event)"
    />
    <span v-else class="wp-range-slider__value" aria-hidden="true">{{ text(lo) }} – {{ text(hi) }}</span>
  </div>
</template>

<style scoped>
.wp-range-slider {
  --_h: var(--wp-control-h-md); --_thumb: 16px;
  display: flex; align-items: center; gap: var(--wp-space-4); min-width: 0; width: 100%; min-height: var(--_h);
  font-family: var(--wp-font-sans);
}
.wp-range-slider[data-size="sm"] { --_h: var(--wp-control-h-sm); --_thumb: 12px; gap: var(--wp-space-3); }
.wp-range-slider[data-size="lg"] { --_h: var(--wp-control-h-lg); --_thumb: 18px; }
.wp-range-slider__track { position: relative; flex: 1; min-width: 80px; height: var(--_h); margin: 0 calc(var(--_thumb) / 2); cursor: pointer; touch-action: none; }
.wp-range-slider__rail, .wp-range-slider__fill { position: absolute; top: 50%; height: 4px; margin-top: -2px; border-radius: var(--wp-radius-cap, 999px); }
.wp-range-slider__rail { left: calc(var(--_thumb) / -2); right: calc(var(--_thumb) / -2); background: var(--wp-bg-3); box-shadow: inset 0 0 0 1px var(--wp-border-soft); }
.wp-range-slider__fill { background: var(--wp-accent); }
.wp-range-slider[data-size="sm"] .wp-range-slider__rail, .wp-range-slider[data-size="sm"] .wp-range-slider__fill { height: 3px; margin-top: -1.5px; }
.wp-range-slider__thumb {
  position: absolute; top: 50%; box-sizing: border-box; width: var(--_thumb); height: var(--_thumb);
  margin: calc(var(--_thumb) / -2) 0 0 calc(var(--_thumb) / -2);
  border: 2px solid var(--wp-accent); border-radius: min(50%, var(--wp-radius-cap, 999px)); background: var(--wp-bg); box-shadow: var(--wp-shadow-sm); outline: none;
  transition: transform var(--wp-motion-quick), box-shadow var(--wp-motion-quick);
}
.wp-range-slider__thumb[data-active], .wp-range-slider__thumb:hover { transform: scale(1.12); }
.wp-range-slider__thumb:focus-visible { box-shadow: 0 0 0 3px var(--wp-focus-ring); z-index: 1; }
.wp-range-slider__value { flex: none; color: var(--wp-text); font: 500 var(--wp-text-sm)/1 var(--wp-font-sans); font-variant-numeric: tabular-nums; white-space: nowrap; }
.wp-range-slider[data-size="sm"] .wp-range-slider__value { font-size: var(--wp-text-xs); }
.wp-range-slider__input { flex: none; width: 76px; }
.wp-range-slider[data-size="sm"] .wp-range-slider__input { width: 60px; }
.wp-range-slider[data-disabled] { opacity: 0.45; }
.wp-range-slider[data-disabled] .wp-range-slider__track { cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) { .wp-range-slider__thumb { transition: none; } }
</style>
