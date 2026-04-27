<script setup lang="ts">
interface Props {
  modelValue: boolean;
  label?: string;
  disabled?: boolean;
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
  <label class="wp-toggle-row" :class="{ 'is-disabled': disabled }">
    <button
      type="button"
      class="wp-toggle"
      :data-on="modelValue ? 'true' : 'false'"
      :aria-checked="modelValue"
      :aria-label="ariaLabel ?? label"
      :disabled="disabled"
      role="switch"
      @click="toggle"
    />
    <span v-if="label" class="wp-toggle-row__label">{{ label }}</span>
  </label>
</template>
