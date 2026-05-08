<script setup lang="ts">
import { computed } from "vue";
import {
  effectiveWeight,
  isEnabled,
  probabilityFor,
  type InstanceLike,
  type WildcardOption,
} from "../probability";

interface OptionFull extends WildcardOption {
  value: string;
}

const props = defineProps<{
  option: OptionFull;
  allOptions: readonly OptionFull[];
  instance: InstanceLike;
}>();

const emit = defineEmits<{
  "toggle": [optionId: string];
  "weight": [optionId: string, weight: number | null];
}>();

const enabled = computed(() => isEnabled(props.option, props.instance));
const probability = computed(() => probabilityFor(props.option, props.allOptions, props.instance));
const weight = computed(() => effectiveWeight(props.option, props.instance));
const overrideWeight = computed(
  () => typeof props.instance.option_weights?.[props.option.id] === "number",
);

function onToggle(): void {
  emit("toggle", props.option.id);
}

function onWeightInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value.trim();
  if (raw === "") {
    emit("weight", props.option.id, null);
    return;
  }
  const n = Number(raw);
  if (Number.isFinite(n)) {
    emit("weight", props.option.id, n);
  }
}

function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
</script>

<template>
  <div
    class="opt"
    :class="{ 'opt--on': enabled, 'opt--off': !enabled, 'opt--weighted': overrideWeight }"
  >
    <span
      class="opt__check"
      :class="{ 'opt__check--on': enabled }"
      data-test="opt-check"
      role="checkbox"
      :aria-checked="enabled"
      tabindex="0"
      @click="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <i v-if="enabled" class="pi pi-check" aria-hidden="true" />
    </span>
    <span class="opt__name" data-test="opt-name">{{ option.value }}</span>
    <span class="opt__prob">
      <span class="opt__prob-bar" aria-hidden="true">
        <span :style="{ width: `${Math.round(probability * 100)}%` }" />
      </span>
      <span class="opt__prob-pct" data-test="opt-prob-pct">{{ fmtPct(probability) }}</span>
    </span>
    <input
      class="opt__weight"
      data-test="opt-weight"
      type="number"
      step="0.1"
      min="0"
      :value="weight"
      :disabled="!enabled"
      :aria-label="`Weight for ${option.value}`"
      @input="onWeightInput"
    />
    <span class="opt__cat" data-test="opt-cat">{{ option.sub_category ?? "" }}</span>
  </div>
</template>

<style scoped>
.opt {
  display: grid;
  grid-template-columns: 22px 130px 1fr 56px 60px;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  cursor: pointer;
}
.opt:last-child { border-bottom: none; }
.opt:hover { background: rgba(255, 255, 255, 0.02); }
.opt__check {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--wp-border-soft, var(--wp-border));
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 9px;
  background: var(--wp-bg);
}
.opt__check--on {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}
.opt__name {
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
}
.opt--off .opt__name {
  color: var(--wp-text-dim, var(--wp-text3));
  text-decoration: line-through;
}
.opt__prob {
  display: flex;
  align-items: center;
  gap: 8px;
}
.opt__prob-bar {
  flex: 1;
  height: 4px;
  background: var(--wp-bg);
  border-radius: 2px;
  overflow: hidden;
}
.opt__prob-bar > span {
  display: block;
  height: 100%;
  background: var(--wp-accent);
  border-radius: 2px;
  transition: width 0.15s ease;
}
.opt__prob-pct {
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  width: 36px;
  text-align: right;
}
.opt--off .opt__prob-pct { color: var(--wp-text-dim, var(--wp-text3)); }
.opt__weight {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 2px;
  padding: 3px 6px;
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  text-align: right;
  width: 100%;
}
.opt__weight:focus {
  border-color: var(--wp-accent);
  outline: none;
  color: var(--wp-text);
}
.opt--weighted .opt__weight {
  color: var(--wp-accent-text, var(--wp-text));
  border-color: var(--wp-accent);
}
.opt--off .opt__weight {
  background: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
}
.opt__cat {
  font: 9px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  text-align: right;
}
</style>
