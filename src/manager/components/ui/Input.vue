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
    emit("update:modelValue", Number(target.value));
  } else {
    emit("update:modelValue", target.value);
  }
}

/** Step the numeric value by the configured `step` (default 1), clamped
 *  to min/max when provided. Bound to the up/down chevrons rendered next
 *  to numeric inputs — replaces native browser spin buttons (which are
 *  hidden via CSS) so the chevron style matches the ComfyUI widget. */
function bump(direction: 1 | -1) {
  if (props.disabled) return;
  const stepNum = Number(props.step ?? 1) || 1;
  const current = Number(props.modelValue) || 0;
  let next = current + direction * stepNum;
  if (props.min !== undefined && next < Number(props.min)) next = Number(props.min);
  if (props.max !== undefined && next > Number(props.max)) next = Number(props.max);
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
