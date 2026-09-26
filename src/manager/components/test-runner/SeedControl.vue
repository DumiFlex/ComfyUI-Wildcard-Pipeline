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
    <button type="button" :data-on="mode === 'range' ? 'true' : 'false'" data-test="seed-mode-range" @click="setMode('range')">Seeds from</button>
    <input
      v-if="mode === 'range'"
      id="wp-tr-seed-from"
      class="wp-trsd__num"
      type="number"
      min="0"
      :value="from"
      aria-label="First seed"
      data-test="seed-from"
      @change="setFrom(($event.target as HTMLInputElement).value)"
    >
    <span class="wp-trsd__x">{{ mode === 'range' ? '×' : '' }}</span>
    <input
      id="wp-tr-seed-count"
      class="wp-trsd__num"
      type="number"
      min="1"
      :max="MAX"
      :value="count"
      aria-label="Number of seeds"
      data-test="seed-count"
      @change="setCount(($event.target as HTMLInputElement).value)"
    >
    <button type="button" :data-on="mode === 'random' ? 'true' : 'false'" data-test="seed-mode-random" @click="setMode('random')">Random</button>
  </div>
</template>

<style scoped>
.wp-trsd {
  display: inline-flex; align-items: center;
  border: 1px solid var(--wp-border-strong); border-radius: var(--wp-radius-sm);
  overflow: hidden; font-size: var(--wp-text-sm);
}
.wp-trsd button {
  background: none; border: 0; color: var(--wp-text-muted); cursor: pointer;
  padding: var(--wp-space-3) var(--wp-space-5); height: 100%;
}
.wp-trsd button[data-on="true"] { background: var(--wp-bg-4); color: var(--wp-text); }
.wp-trsd button:focus-visible { outline: 2px solid var(--wp-border-focus); outline-offset: -2px; }
.wp-trsd__num {
  width: 84px; background: var(--wp-bg-2); color: var(--wp-text);
  border: 0; border-left: 1px solid var(--wp-border-strong);
  padding: var(--wp-space-3) var(--wp-space-4); font: var(--wp-text-sm) var(--wp-font-mono);
}
.wp-trsd__num:focus-visible { outline: 2px solid var(--wp-border-focus); outline-offset: -2px; }
.wp-trsd__x { color: var(--wp-text-dim); padding: 0 var(--wp-space-2); }
</style>
