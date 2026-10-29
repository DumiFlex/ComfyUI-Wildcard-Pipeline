<script setup lang="ts">
/**
 * The manager's on/off switch: the shared WpSwitch at the
 * manager size, so the canvas and the manager draw one switch. Use it for a
 * setting that takes effect at once.
 */
import WpSwitch from "./WpSwitch.vue";

interface Props {
  modelValue: boolean;
  label?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  invalid?: boolean;
  /** @deprecated use `invalid`. */
  error?: boolean;
  ariaLabel?: string;
}
const props = withDefaults(defineProps<Props>(), { size: "md", label: undefined, ariaLabel: undefined });

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
}>();
</script>

<template>
  <WpSwitch
    :model-value="props.modelValue"
    :size="props.size"
    :label="props.label"
    :aria-label="props.ariaLabel ?? props.label"
    :disabled="props.disabled"
    :invalid="props.invalid || props.error"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
