<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";

type Tone = "default" | "accent" | "success" | "warn" | "danger" | "info";

interface Props {
  tone?: Tone;
  icon?: string;
  removable?: boolean;
}
const props = withDefaults(defineProps<Props>(), { tone: "default" });

const emit = defineEmits<{
  (e: "remove"): void;
}>();

const classes = computed(() => [
  "wp-chip",
  props.tone !== "default" && `wp-chip--${props.tone}`,
]);

function onRemove(e: MouseEvent) {
  e.stopPropagation();
  emit("remove");
}
</script>

<template>
  <span :class="classes">
    <Icon v-if="icon" :name="icon" :size="10" />
    <slot />
    <button
      v-if="removable"
      type="button"
      class="wp-chip__close"
      aria-label="Remove"
      @click="onRemove"
    >
      <Icon name="times" :size="9" />
    </button>
  </span>
</template>
