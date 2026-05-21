<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";

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
    <!-- 10px sub-ICON_SM — pill density pass dropped chip font 11→10.5
         and the previous 12px icon read oversized next to the smaller
         label. Matches the new chip body weight. -->
    <Icon v-if="icon" :name="icon" :size="10" />
    <slot />
    <button
      v-if="removable"
      type="button"
      class="wp-chip__close"
      aria-label="Remove"
      @click="onRemove"
    >
      <!-- Close glyph also drops to 10px so chip-with-X stays balanced
           against the slimmer body. Hit target stays 20×20 via the
           button's min sizing in tokens.css. -->
      <Icon name="times" :size="10" />
    </button>
  </span>
</template>
