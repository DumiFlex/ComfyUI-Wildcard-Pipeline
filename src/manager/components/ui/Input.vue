<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";

interface Props {
  modelValue: string | number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  size?: "sm" | "md";
  icon?: string;
  addon?: string;
  id?: string;
  ariaLabel?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
}
const props = withDefaults(defineProps<Props>(), {
  type: "text",
  size: "md",
});

const emit = defineEmits<{
  (e: "update:modelValue", v: string | number): void;
  (e: "blur", evt: FocusEvent): void;
  (e: "focus", evt: FocusEvent): void;
}>();

const inputClasses = computed(() => [
  "wp-input",
  props.size === "sm" && "wp-input--sm",
  props.type === "number" && "wp-input--number",
]);

const isNumber = computed(() => props.type === "number");
const wrapped = computed(() => Boolean(props.icon || props.addon) || isNumber.value);

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  // Coerce numeric inputs back to number for v-model parity.
  if (isNumber.value && target.value !== "") {
    let n = Number(target.value);
    if (Number.isFinite(n)) {
      // Snap to 3 decimals on emit so float-fuzz tails (e.g. from a
      // stray native step or paste of `1.2999999999999998`) don't leak
      // into stored values. Doesn't clobber legit 2-decimal precision.
      n = Math.round(n * 1000) / 1000;
    }
    emit("update:modelValue", n);
  } else {
    emit("update:modelValue", target.value);
  }
}

/** Route ArrowUp / ArrowDown on number inputs through `bump()` so the
 *  step is applied with step-precision rounding. Native browser
 *  arrow-stepping does the math in float64 and surfaces fuzz (e.g.
 *  `1.4 - 0.1 = 1.2999999999999998`). Mouse wheel does the same. */
function onKeydown(e: KeyboardEvent) {
  if (!isNumber.value) return;
  if (e.key === "ArrowUp") {
    e.preventDefault();
    bump(1);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    bump(-1);
  }
}
function onWheel(e: WheelEvent) {
  if (!isNumber.value) return;
  const target = e.target as HTMLInputElement;
  if (document.activeElement !== target) return; // only when focused
  e.preventDefault();
  bump(e.deltaY < 0 ? 1 : -1);
}

/** Step the numeric value by the configured `step` (default 1), clamped
 *  to min/max when provided. Bound to the up/down chevrons rendered next
 *  to numeric inputs — replaces native browser spin buttons (which are
 *  hidden via CSS) so the chevron style matches the ComfyUI widget.
 *
 *  The bumped value is rounded to the step's decimal precision so we
 *  don't surface JS floating-point fuzz (e.g. `1 + 0.2 = 1.2000000000000002`)
 *  into the input. Bug filed by Daisy: clicking the up chevron on an
 *  option's weight=1 with step=0.1 produced `1,2000000000000002` (locale
 *  comma decimal separator) which read as "20000" in the UI. */
function bump(direction: 1 | -1) {
  if (props.disabled) return;
  const stepNum = Number(props.step ?? 1) || 1;
  const current = Number(props.modelValue) || 0;
  let next = current + direction * stepNum;
  if (props.min !== undefined && next < Number(props.min)) next = Number(props.min);
  if (props.max !== undefined && next > Number(props.max)) next = Number(props.max);
  // Round to the step's decimal precision. `step=0.1` → 1 decimal,
  // `step=0.01` → 2 decimals, `step=1` → 0 decimals.
  const stepStr = String(stepNum);
  const dot = stepStr.indexOf(".");
  const decimals = dot >= 0 ? stepStr.length - dot - 1 : 0;
  if (decimals > 0) {
    const factor = Math.pow(10, decimals);
    next = Math.round(next * factor) / factor;
  }
  emit("update:modelValue", next);
}
</script>

<template>
  <div v-if="wrapped" class="wp-input-group" :class="{ 'wp-input-group--number': isNumber }">
    <span v-if="icon" class="wp-input-group__addon">
      <Icon :name="icon" />
    </span>
    <input
      :id="id"
      :class="inputClasses"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-invalid="error || undefined"
      :min="min"
      :max="max"
      :step="step"
      @input="onInput"
      @keydown="onKeydown"
      @wheel="onWheel"
      @blur="(e) => emit('blur', e)"
      @focus="(e) => emit('focus', e)"
    />
    <!-- Number stepper — stacked chevrons on the right, matching the
         ComfyUI widget's spinner placement but using the SPA's themed
         icon set. Native browser spin buttons are hidden via CSS so the
         two don't double up. -->
    <span v-if="isNumber" class="wp-input-number__stepper" aria-hidden="true">
      <button
        type="button"
        class="wp-input-number__btn"
        tabindex="-1"
        :disabled="disabled"
        @click="bump(1)"
      ><Icon name="pi-chevron-up" :size="9" /></button>
      <button
        type="button"
        class="wp-input-number__btn"
        tabindex="-1"
        :disabled="disabled"
        @click="bump(-1)"
      ><Icon name="pi-chevron-down" :size="9" /></button>
    </span>
    <span v-if="addon" class="wp-input-group__addon wp-input-group__addon--right">{{ addon }}</span>
  </div>
  <input
    v-else
    :id="id"
    :class="inputClasses"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="ariaLabel"
    :aria-invalid="error || undefined"
    :min="min"
    :max="max"
    :step="step"
    @input="onInput"
    @blur="(e) => emit('blur', e)"
    @focus="(e) => emit('focus', e)"
  />
</template>

<style scoped>
/* Number-input stepper — stacked up/down chevrons docked to the right
 * edge of the input. Suppresses native browser spin buttons so the
 * styled stepper doesn't double up. */
.wp-input-group--number {
  position: relative;
}
.wp-input-group--number .wp-input--number {
  padding-right: 22px;
}
.wp-input-group--number .wp-input--number::-webkit-outer-spin-button,
.wp-input-group--number .wp-input--number::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.wp-input-group--number .wp-input--number {
  appearance: textfield;
  -moz-appearance: textfield;
}
.wp-input-number__stepper {
  position: absolute;
  top: 2px;
  bottom: 2px;
  right: 4px;
  display: flex;
  flex-direction: column;
  width: 14px;
  pointer-events: auto;
}
.wp-input-number__btn {
  flex: 1;
  display: grid;
  place-items: center;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--wp-text-muted);
  border-radius: 2px;
  min-width: 0;
  line-height: 1;
}
.wp-input-number__btn:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-input-number__btn:disabled { cursor: not-allowed; opacity: 0.4; }
.wp-input-number__btn .pi { font-size: 9px; }
</style>
