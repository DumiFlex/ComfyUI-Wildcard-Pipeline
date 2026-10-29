<script setup lang="ts">
/**
 * Progress bar: how far along a job is. Give `value` (0 to `max`) for a bar that
 * fills; leave it out (or `null`) when nobody knows yet, and the bar sweeps.
 * Works on the canvas (`size="sm"`) and in the manager (`md`).
 *
 *   <ProgressBar :value="done" :max="total" label="Testing seeds" show-value />
 *   <ProgressBar label="Loading the model" />
 *
 * It is an APG progressbar: `aria-valuenow` only while the value is known,
 * so a screen reader says "busy" instead of a made-up number. The sweep
 * stands still under reduced motion.
 */
import { computed } from "vue";

const props = withDefaults(defineProps<{
  /** How far along, 0 to `max`; `null` or left out = not known yet. */
  value?: number | null | undefined;
  max?: number | undefined;
  tone?: "accent" | "success" | "warn" | "danger" | undefined;
  size?: "sm" | "md" | undefined;
  /** The job's name for screen readers, and the line above the bar with `show-value`. */
  label?: string | undefined;
  /** Show the label and the percentage above the bar. */
  showValue?: boolean | undefined;
}>(), { value: null, max: 100, tone: "accent", size: "md", label: undefined });

const known = computed(() => typeof props.value === "number" && Number.isFinite(props.value));
const pct = computed(() => {
  if (!known.value || props.max <= 0) return 0;
  return Math.min(100, Math.max(0, ((props.value as number) / props.max) * 100));
});
const pctText = computed(() => `${Math.round(pct.value)}%`);
</script>

<template>
  <div class="wp-progress" :data-size="size" :data-tone="tone">
    <div v-if="showValue && (label || known)" class="wp-progress__head" aria-hidden="true">
      <span class="wp-progress__label">{{ label }}</span>
      <span v-if="known" class="wp-progress__value">{{ pctText }}</span>
    </div>
    <div
      class="wp-progress__track"
      role="progressbar"
      :aria-label="label"
      aria-valuemin="0"
      :aria-valuemax="known ? max : undefined"
      :aria-valuenow="known ? value ?? undefined : undefined"
      :aria-valuetext="known ? pctText : undefined"
      :aria-busy="known ? undefined : 'true'"
      :data-indeterminate="known ? undefined : 'true'"
    >
      <div class="wp-progress__fill" :style="known ? { width: `${pct}%` } : undefined" />
    </div>
  </div>
</template>

<style scoped>
.wp-progress { --_tone: var(--wp-accent); display: flex; flex-direction: column; gap: var(--wp-space-2); min-width: 0; width: 100%; }
.wp-progress[data-tone="success"] { --_tone: var(--wp-success); }
.wp-progress[data-tone="warn"] { --_tone: var(--wp-warn); }
.wp-progress[data-tone="danger"] { --_tone: var(--wp-danger); }
.wp-progress__head {
  display: flex; justify-content: space-between; gap: var(--wp-space-3);
  color: var(--wp-text-muted); font: 500 var(--wp-text-xs)/1.3 var(--wp-font-sans);
}
.wp-progress__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-progress__value { flex: none; font-variant-numeric: tabular-nums; color: var(--wp-text); }
.wp-progress__track {
  position: relative; overflow: hidden; height: 6px;
  border-radius: var(--wp-radius-cap, 999px); background: var(--wp-bg-3);
}
.wp-progress[data-size="sm"] .wp-progress__track { height: 4px; }
.wp-progress__fill {
  height: 100%; border-radius: inherit; background: var(--_tone);
  transition: width var(--wp-motion-swap);
}
.wp-progress__track[data-indeterminate] .wp-progress__fill {
  position: absolute; inset: 0 auto 0 0; width: 40%;
  animation: wp-progress-sweep 1.4s var(--wp-motion-curve-collapse) infinite;
}
@keyframes wp-progress-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .wp-progress__fill { transition: none; }
  .wp-progress__track[data-indeterminate] .wp-progress__fill { animation: none; width: 100%; opacity: 0.45; }
}
</style>
