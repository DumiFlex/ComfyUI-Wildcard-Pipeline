<script setup lang="ts">
import { computed } from "vue";

interface Props {
  label?: string;
  hint?: string;
  error?: string;
  for?: string;
  required?: boolean;
}
const props = defineProps<Props>();

const classes = computed(() => [
  "wp-field",
  props.error && "wp-field--error",
]);
</script>

<template>
  <div :class="classes">
    <label v-if="label" :for="props.for" class="wp-field__label">
      {{ label }}<span v-if="required" aria-hidden="true"> *</span>
    </label>
    <slot />
    <div v-if="error" class="wp-field__error" role="alert">{{ error }}</div>
    <div v-else-if="hint" class="wp-field__hint">{{ hint }}</div>
  </div>
</template>
