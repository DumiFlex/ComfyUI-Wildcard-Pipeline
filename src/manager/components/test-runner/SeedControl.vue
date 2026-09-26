<script setup lang="ts">
/**
 * Seed spec editor: a consecutive range ("from S, N seeds") or N random
 * seeds. A range is reproducible — seed S here is seed S on the canvas — so
 * it is the default; random is for a quick look at variety.
 */
import { computed } from "vue";
import type { ScenarioSeedSpec } from "../../api/types";

const MAX = 10_000;

const props = defineProps<{ modelValue: ScenarioSeedSpec }>();
const emit = defineEmits<{ (e: "update:modelValue", v: ScenarioSeedSpec): void }>();

const mode = computed(() => ("random" in props.modelValue ? "random" : "range"));
const count = computed(() => ("list" in props.modelValue ? props.modelValue.list.length : props.modelValue.count));
const from = computed(() => ("from" in props.modelValue ? props.modelValue.from : 0));

function clampCount(v: number): number {
  return Math.min(MAX, Math.max(1, Math.round(v) || 1));
}

function setMode(m: "range" | "random"): void {
  emit("update:modelValue", m === "random" ? { random: true, count: count.value } : { from: from.value, count: count.value });
}
function setFrom(v: string): void {
  emit("update:modelValue", { from: Math.max(0, Math.round(Number(v)) || 0), count: count.value });
}
function setCount(v: string): void {
  const n = clampCount(Number(v));
  emit("update:modelValue", mode.value === "random" ? { random: true, count: n } : { from: from.value, count: n });
}
</script>

<template>
  <div class="wp-trsd" role="group" aria-label="Seeds" data-test="seed-control">
    <div class="wp-trsd__mode" role="radiogroup" aria-label="Seed mode">
      <button
        type="button"
        role="radio"
        :aria-checked="mode === 'range'"
        title="Consecutive seeds: seed N here is seed N on the canvas"
        data-test="seed-mode-range"
        @click="setMode('range')"
      >Range</button>
      <button
        type="button"
        role="radio"
        :aria-checked="mode === 'random'"
        title="A fresh random set of seeds on every run"
        data-test="seed-mode-random"
        @click="setMode('random')"
      >Random</button>
    </div>
    <label v-if="mode === 'range'" class="wp-trsd__field" for="wp-tr-seed-from">
      <span>from</span>
      <input
        id="wp-tr-seed-from"
        type="number"
        min="0"
        :value="from"
        aria-label="First seed"
        data-test="seed-from"
        @change="setFrom(($event.target as HTMLInputElement).value)"
      >
    </label>
    <label class="wp-trsd__field" for="wp-tr-seed-count">
      <input
        id="wp-tr-seed-count"
        type="number"
        min="1"
        :max="MAX"
        :value="count"
        aria-label="Number of seeds"
        data-test="seed-count"
        @change="setCount(($event.target as HTMLInputElement).value)"
      >
      <span>seeds</span>
    </label>
  </div>
</template>

<style scoped>
.wp-trsd {
  display: inline-flex; align-items: stretch; height: var(--wp-control-h-md);
  border: 1px solid var(--wp-border-strong); border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-1); font-size: var(--wp-text-sm);
}
.wp-trsd__mode { display: inline-flex; padding: var(--wp-space-1); gap: var(--wp-space-1); border-right: 1px solid var(--wp-border); }
.wp-trsd__mode button {
  background: none; border: 0; color: var(--wp-text-muted); cursor: pointer;
  padding: 0 var(--wp-space-4); border-radius: var(--wp-radius-sm); font-size: var(--wp-text-sm);
}
.wp-trsd__mode button:hover { color: var(--wp-text); }
.wp-trsd__mode button[aria-checked="true"] { background: var(--wp-bg-4); color: var(--wp-text); }
.wp-trsd__mode button:focus-visible { outline: 2px solid var(--wp-border-focus); outline-offset: -2px; }
.wp-trsd__field {
  display: inline-flex; align-items: center; gap: var(--wp-space-2);
  padding: 0 var(--wp-space-4); color: var(--wp-text-dim);
}
.wp-trsd__field + .wp-trsd__field { border-left: 1px solid var(--wp-border); }
.wp-trsd__field input {
  width: 64px; background: none; border: 0; color: var(--wp-text);
  font: var(--wp-text-sm) var(--wp-font-mono); text-align: right;
  appearance: textfield; -moz-appearance: textfield;
}
.wp-trsd__field input::-webkit-outer-spin-button,
.wp-trsd__field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.wp-trsd__field:focus-within { color: var(--wp-text-muted); }
.wp-trsd__field input:focus-visible { outline: none; }
.wp-trsd:focus-within { border-color: var(--wp-border-focus); }
</style>
