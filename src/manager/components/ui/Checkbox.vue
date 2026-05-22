<script setup lang="ts">
import { computed } from "vue";

interface Props {
  modelValue: boolean;
  label?: string;
  disabled?: boolean;
  error?: boolean;
  id?: string;
  ariaLabel?: string;
  /**
   * Tri-state indicator. When true AND `modelValue` is false, the
   * checkbox renders a horizontal dash instead of a checkmark and
   * announces `aria-checked="mixed"`. Used by group/select-all
   * controls where the underlying collection is partially selected.
   * `modelValue=true` always wins — a fully-checked box never
   * renders as indeterminate even if the prop is set.
   */
  indeterminate?: boolean;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
}>();

const showIndeterminate = computed<boolean>(
  () => !!props.indeterminate && !props.modelValue,
);

const ariaChecked = computed<"true" | "false" | "mixed">(() => {
  if (props.modelValue) return "true";
  if (showIndeterminate.value) return "mixed";
  return "false";
});

function toggle() {
  if (props.disabled) return;
  emit("update:modelValue", !props.modelValue);
}
</script>

<template>
  <!-- Wrapper is a <span> rather than a <label> on purpose. Native <label>
       re-dispatches click on its associated form control in some pointer
       paths (notably when the click target is the SVG inside the button),
       firing the button's @click twice — which double-toggled and left
       the underlying model unchanged when a parent also wired a click
       handler. The span wrapper has no synthetic-dispatch behavior. -->
  <span class="wp-checkbox" :class="{ 'is-disabled': disabled }">
    <button
      type="button"
      class="wp-check"
      :data-checked="modelValue ? 'true' : 'false'"
      :data-indeterminate="showIndeterminate ? 'true' : 'false'"
      :aria-checked="ariaChecked"
      :aria-label="ariaLabel ?? label"
      :aria-invalid="error || undefined"
      :disabled="disabled"
      role="checkbox"
      @click="toggle"
    >
      <!-- pointer-events: none on the visual SVG so the entire button area
           (including the check mark) is a single click target — clicks land
           on the button itself, not the SVG child. Without this, a click
           on the SVG centerpoint could route through wrapper-bubble paths
           in some browsers/automation drivers and double-fire toggle. -->
      <svg
        v-if="modelValue"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        style="display: block; pointer-events: none"
      >
        <path
          d="M3 6.2l2.2 2.2L9 4.4"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <!-- Indeterminate dash. Same pointer-events override as the
           checkmark above so the box stays a single click target. -->
      <svg
        v-else-if="showIndeterminate"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        style="display: block; pointer-events: none"
      >
        <path
          d="M3 6h6"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <span v-if="label" class="wp-checkbox__label" @click="toggle">{{ label }}</span>
  </span>
</template>
