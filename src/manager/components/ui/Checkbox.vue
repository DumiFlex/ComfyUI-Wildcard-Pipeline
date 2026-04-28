<script setup lang="ts">
interface Props {
  modelValue: boolean;
  label?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
}>();

function toggle() {
  if (props.disabled) return;
  emit("update:modelValue", !props.modelValue);
}
</script>

<template>
  <label class="wp-checkbox" :class="{ 'is-disabled': disabled }">
    <button
      type="button"
      class="wp-check"
      :data-checked="modelValue ? 'true' : 'false'"
      :aria-checked="modelValue"
      :aria-label="ariaLabel ?? label"
      :disabled="disabled"
      role="checkbox"
      @click="toggle"
    >
      <svg
        v-if="modelValue"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        style="display: block"
      >
        <path
          d="M3 6.2l2.2 2.2L9 4.4"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <span v-if="label" class="wp-checkbox__label">{{ label }}</span>
  </label>
</template>
