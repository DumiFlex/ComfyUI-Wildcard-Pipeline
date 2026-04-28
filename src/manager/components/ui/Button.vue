<script setup lang="ts">
import { computed, useSlots } from "vue";
import Icon from "./Icon.vue";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link" | "outline";
type Size = "sm" | "md" | "lg";

interface Props {
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  ariaLabel?: string;
}
const props = withDefaults(defineProps<Props>(), {
  variant: "secondary",
  size: "md",
  type: "button",
});

const emit = defineEmits<{
  (e: "click", evt: MouseEvent): void;
}>();

const slots = useSlots();

const hasContent = computed(() => Boolean(slots.default));

const classes = computed(() => [
  "wp-btn",
  `wp-btn--${props.variant}`,
  `wp-btn--${props.size}`,
  !hasContent.value && "wp-btn--icon",
]);

function onClick(e: MouseEvent) {
  if (props.disabled || props.loading) return;
  emit("click", e);
}
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <Icon v-if="loading" name="spin pi-spinner" />
    <Icon v-else-if="icon" :name="icon" />
    <slot />
    <Icon v-if="iconRight" :name="iconRight" />
  </button>
</template>
