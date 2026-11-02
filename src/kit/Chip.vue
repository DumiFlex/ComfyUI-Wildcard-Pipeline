<script setup lang="ts">
/**
 * A small tag: a post's tag, a category, a status. `removable` adds a ✕
 * that emits `remove`. `as="button"` (or `as="a"` / a link component such as
 * RouterLink) makes the whole chip something you press, for a chip that
 * takes you somewhere ("show everything tagged portrait"); a pressable
 * chip has no ✕. For a filter that turns on and off, use ChipToggle.
 */
import { computed, type Component } from "vue";
import Icon from "./Icon.vue";

type Tone = "default" | "accent" | "success" | "warn" | "danger" | "info";

interface Props {
  tone?: Tone | undefined;
  icon?: string | null | undefined;
  removable?: boolean | undefined;
  /**
   * Free-form colour (hex or any CSS colour), e.g. a category's. When set it
   * overrides the tone and renders a tinted pill: background = colour @ 18%,
   * border = colour @ 42%, and the text blends the colour toward
   * `--wp-text` so a pale pick stays readable in light mode and a dark pick
   * in dark mode. `null` reads as no colour (a category without one).
   * This is what CategoryChip used to be: `<Chip :color :icon>{{ name }}</Chip>`.
   */
  color?: string | null | undefined;
  /** What to render: a span (default), a button, or a link. */
  as?: string | Component | undefined;
}
const props = withDefaults(defineProps<Props>(), { tone: "default", as: "span" });

const emit = defineEmits<{
  (e: "remove"): void;
}>();

const pressable = computed(() => props.as !== "span");
const classes = computed(() => [
  "wp-chip",
  pressable.value && "wp-chip--action",
  props.color ? "wp-chip--color" : props.tone !== "default" && `wp-chip--${props.tone}`,
]);

const colorStyle = computed(() => {
  if (!props.color) return undefined;
  const c = props.color;
  return {
    color: `color-mix(in oklab, ${c} 65%, var(--wp-text))`,
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
  <component
    :is="as"
    :class="classes"
    :style="colorStyle"
    :type="as === 'button' ? 'button' : undefined"
  >
    <!-- 10px sub-ICON_SM — pill density pass dropped chip font 11→10.5
         and the previous 12px icon read oversized next to the smaller
         label. Matches the new chip body weight. -->
    <Icon v-if="icon" :name="icon" :size="10" />
    <slot />
    <button
      v-if="removable && !pressable"
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
  </component>
</template>

<style scoped>
.wp-chip--action {
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: border-color var(--wp-motion-quick) ease, color var(--wp-motion-quick) ease, filter var(--wp-motion-quick) ease;
}
.wp-chip--action:hover { border-color: var(--wp-border-strong); color: var(--wp-text); }
.wp-chip--action.wp-chip--color:hover,
.wp-chip--action.wp-chip--accent:hover { color: inherit; filter: brightness(1.08); }
.wp-chip--action:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
</style>
