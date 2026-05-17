<script setup lang="ts">
import { computed } from "vue";
import Icon, { ICON_SM } from "./Icon.vue";

type Tone = "default" | "accent" | "success" | "warn" | "danger" | "info";

interface Props {
  tone?: Tone;
  icon?: string;
  removable?: boolean;
  /**
   * Free-form color (hex or any CSS color). When set, overrides the tone
   * styling and renders the chip as a tinted pill: text uses the raw color,
   * background = `color @ 14%`, border = `color @ 35%`. Mirrors the
   * prototype's `<Chip color>` pattern (ui.jsx:323-337).
   */
  color?: string;
}
const props = withDefaults(defineProps<Props>(), { tone: "default" });

const emit = defineEmits<{
  (e: "remove"): void;
}>();

const classes = computed(() => [
  "wp-chip",
  !props.color && props.tone !== "default" && `wp-chip--${props.tone}`,
]);

const colorStyle = computed(() => {
  if (!props.color) return undefined;
  const c = props.color;
  return {
    color: c,
    background: `color-mix(in oklab, ${c} 18%, transparent)`,
    borderColor: `color-mix(in oklab, ${c} 42%, transparent)`,
  };
});

function onRemove(e: MouseEvent) {
  e.stopPropagation();
  emit("remove");
}
</script>

<template>
  <span :class="classes" :style="colorStyle">
    <!-- Was ~10px historically; promoted to ICON_SM (12) for parity with the
         close icon and consistency with the project-wide icon scale. -->
    <Icon v-if="icon" :name="icon" :size="ICON_SM" />
    <slot />
    <button
      v-if="removable"
      type="button"
      class="wp-chip__close"
      aria-label="Remove"
      @click="onRemove"
    >
      <!-- Was 9px historically; promoted to ICON_SM (12) intentionally —
           close button now matches the prefix icon for visual balance. -->
      <Icon name="times" :size="ICON_SM" />
    </button>
  </span>
</template>
