<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";

type Tone = "default" | "accent" | "success" | "warn" | "danger" | "info";

interface Props {
  tone?: Tone;
  icon?: string;
  count?: number;
}
const props = withDefaults(defineProps<Props>(), { tone: "default" });

const classes = computed(() => [
  "wp-pill",
  props.tone !== "default" && `wp-pill--${props.tone}`,
]);
</script>

<template>
  <span :class="classes">
    <Icon v-if="icon" :name="icon" :size="10" />
    <slot />
    <span v-if="count !== undefined" class="wp-pill__count">{{ count }}</span>
  </span>
</template>
