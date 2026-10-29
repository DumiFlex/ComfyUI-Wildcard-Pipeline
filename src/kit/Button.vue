<script setup lang="ts">
/**
 * Button — single source of truth for app buttons.
 *
 * Variants:
 *   primary   — solid accent; main CTA per surface
 *   secondary — subtle filled; default
 *   ghost     — transparent with hover bg; tertiary
 *   danger    — red-tinted; destructive actions
 *   link      — text-only; inline CTAs
 *   outline   — neutral bordered ghost (not accent: an accent outline read as
 *               a second primary)
 *   add       — dashed, quiet: the "Add a row" button at the end of a list
 *
 * `block` stretches it to the full width of its container. `pressed` makes
 * it a toggle (aria-pressed, accent tint while on).
 *
 * Sizes follow the control scale: sm 24 / md 32 (default) / lg 40.
 *
 * States: default · hover · active · focus-visible · disabled · loading.
 * Disabled fades to 45% with a not-allowed cursor and no hover change.
 * Loading keeps the variant's own colours, swaps the lead icon for the
 * sparkle LoadingMark in the label colour, sets aria-busy and ignores clicks.
 *
 * Icon-only mode auto-engages when no slot content is provided (.wp-btn--icon).
 * Pass `aria-label` for screen reader text when using icon-only mode.
 *
 * The styles live in kit/button.css, shared with the canvas
 * Button twin.
 */
import { computed, useSlots } from "vue";
import Icon from "./Icon.vue";
import LoadingMark from "./LoadingMark.vue";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link" | "outline" | "add";
type Size = "sm" | "md" | "lg";

interface Props {
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  /** Makes it a toggle (`aria-pressed`): on, it wears the accent tint. */
  pressed?: boolean;
  type?: "button" | "submit" | "reset";
  ariaLabel?: string;
}
const props = withDefaults(defineProps<Props>(), {
  variant: "secondary",
  size: "md",
  type: "button",
  pressed: undefined,
});

const emit = defineEmits<{
  (e: "click", evt: MouseEvent): void;
}>();

const slots = useSlots();

const hasContent = computed(() => Boolean(slots.default));

/** Native hover tooltip for icon-only buttons. Their `aria-label` names them
 *  for screen readers, but a sighted user hovering a bare icon gets nothing —
 *  so mirror the label into `title` when there's no visible text. A button with
 *  text already says what it does, so it stays untitled. */
const titleAttr = computed(() =>
  !hasContent.value && props.ariaLabel ? props.ariaLabel : undefined);

const classes = computed(() => [
  "wp-btn",
  `wp-btn--${props.variant}`,
  `wp-btn--${props.size}`,
  !hasContent.value && "wp-btn--icon",
  props.block && "wp-btn--block",
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
    :title="titleAttr"
    :aria-busy="loading || undefined"
    :aria-pressed="pressed === undefined ? undefined : pressed"
    @click="onClick"
  >
    <LoadingMark v-if="loading" variant="sparkle" mono :size="size === 'lg' ? 16 : 14" decorative />
    <Icon v-else-if="icon" :name="icon" />
    <span v-if="hasContent" class="wp-btn__label"><slot /></span>
    <Icon v-if="iconRight" :name="iconRight" />
  </button>
</template>
