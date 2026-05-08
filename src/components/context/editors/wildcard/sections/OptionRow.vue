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

/** Distinguish two reasons a row might be disabled:
 *   - per-option toggle off (`enabled_options` array excludes this id)
 *   - sub-category filtered out (`category_filter` excludes this option's bucket)
 *
 * Per-option toggle remains interactive (user can re-check).
 * Category-filtered rows are read-only — the sub-category chip is the
 * authority. Clicking the per-option checkbox while filtered would write
 * to `enabled_options` invisibly and surprise the user when they re-enable
 * the category. So we no-op the click in that case.
 */
const filteredByCategory = computed(() => {
  const filter = props.instance.category_filter;
  if (!Array.isArray(filter) || filter.length === 0) return false;
  if (!props.option.sub_category) return true;
  return !filter.includes(props.option.sub_category);
});
const probability = computed(() => probabilityFor(props.option, props.allOptions, props.instance));
const weight = computed(() => effectiveWeight(props.option, props.instance));
const overrideWeight = computed(
  () => typeof props.instance.option_weights?.[props.option.id] === "number",
);

function onToggle(): void {
  if (filteredByCategory.value) return;
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

const WEIGHT_STEP = 0.1;

function bumpWeight(direction: 1 | -1): void {
  if (!enabled.value) return;
  // Round to 1 decimal so 1.0 + 0.1 doesn't drift to 1.0999... visually.
  const next = Math.max(0, Math.round((weight.value + direction * WEIGHT_STEP) * 10) / 10);
  emit("weight", props.option.id, next);
}

function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
</script>

<template>
  <div
    class="opt"
    :class="{
      'opt--on': enabled,
      'opt--off': !enabled,
      'opt--weighted': overrideWeight,
      'opt--filtered': filteredByCategory,
    }"
  >
    <span
      class="opt__check"
      :class="{ 'opt__check--on': enabled }"
      data-test="opt-check"
      role="checkbox"
      :aria-checked="enabled"
      :aria-disabled="filteredByCategory"
      :tabindex="filteredByCategory ? -1 : 0"
      @click="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <!-- Inline SVG checkmark instead of PrimeIcon: precise sizing
           (8×8 inside 14px box) without the icon-font's intrinsic
           line-height inflating the glyph past the box edge. -->
      <svg
        v-if="enabled"
        class="opt__check-tick"
        width="8"
        height="8"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path d="M2.5 6.5 L5 9 L9.5 3.5"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
    <span class="opt__name" data-test="opt-name">{{ option.value }}</span>
    <span class="opt__prob">
      <span class="opt__prob-bar" aria-hidden="true">
        <span :style="{ width: `${Math.round(probability * 100)}%` }" />
      </span>
      <span class="opt__prob-pct" data-test="opt-prob-pct">{{ fmtPct(probability) }}</span>
    </span>
    <span class="opt__weight-wrap" :class="{ 'opt__weight-wrap--off': !enabled }">
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
      <span class="opt__spin">
        <button
          type="button"
          class="opt__spin-btn"
          data-test="opt-weight-up"
          tabindex="-1"
          :disabled="!enabled"
          :aria-label="`Increase weight for ${option.value}`"
          @click="bumpWeight(1)"
        ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
          <path d="M0 5 L4 0 L8 5 Z" fill="currentColor" />
        </svg></button>
        <button
          type="button"
          class="opt__spin-btn"
          data-test="opt-weight-down"
          tabindex="-1"
          :disabled="!enabled"
          :aria-label="`Decrease weight for ${option.value}`"
          @click="bumpWeight(-1)"
        ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
          <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
        </svg></button>
      </span>
    </span>
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
  background: var(--wp-bg);
  flex-shrink: 0;
}
.opt__check-tick {
  display: block;
}
.opt__check--on {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}
/* Category-filtered rows are read-only — the chip controls them.
 * Show a "not-allowed" cursor + slight opacity so the user knows the
 * per-option checkbox is intentionally inert in this state. */
.opt--filtered .opt__check {
  cursor: not-allowed;
  opacity: 0.45;
}
.opt--filtered { cursor: default; }
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
/* Weight input wrapper holds the number field plus a stacked custom
 * spinner pair. The wrapper carries the border + bg so the input and
 * spinner read as a single themed control. Native browser spinners
 * are hidden via `appearance: textfield` (FF) + ::-webkit pseudo
 * elements; the up/down buttons we render do the same job but
 * styled to fit the dark/light theme. */
.opt__weight-wrap {
  display: inline-flex;
  align-items: stretch;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 2px;
  width: 100%;
  height: 22px;
  overflow: hidden;
}
.opt__weight-wrap:focus-within {
  border-color: var(--wp-accent);
}
.opt__weight {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0 6px;
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  text-align: right;
  width: 100%;
  min-width: 0;
  -moz-appearance: textfield;
}
.opt__weight::-webkit-outer-spin-button,
.opt__weight::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.opt__weight:focus {
  outline: none;
  color: var(--wp-text);
}
.opt--weighted .opt__weight {
  color: var(--wp-accent-text, var(--wp-text));
}
.opt--weighted .opt__weight-wrap {
  border-color: var(--wp-accent);
}
.opt--off .opt__weight-wrap {
  background: transparent;
  border-color: var(--wp-border-soft, var(--wp-border));
}
.opt--off .opt__weight {
  color: var(--wp-text-dim, var(--wp-text3));
}
.opt__spin {
  display: flex;
  flex-direction: column;
  width: 14px;
  flex-shrink: 0;
  border-left: 1px solid var(--wp-border);
  background: var(--wp-bg-deep, var(--wp-bg));
}
.opt__spin-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  line-height: 0;
}
.opt__spin-btn + .opt__spin-btn {
  border-top: 1px solid var(--wp-border);
}
.opt__spin-btn:hover { color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,0.10); }
.opt__spin-btn:disabled {
  cursor: not-allowed;
  color: var(--wp-text-dim, var(--wp-text3));
  opacity: 0.4;
  background: transparent;
}
.opt__cat {
  font: 9px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  text-align: right;
}
</style>
