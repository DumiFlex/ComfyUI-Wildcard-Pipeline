<script setup lang="ts">
/**
 * Button — single source of truth for app buttons.
 *
 * Variants:
 *   primary   — solid accent; main CTA per surface
 *   secondary — subtle filled; default (alias of the base .wp-btn style)
 *   ghost     — transparent with hover bg; tertiary
 *   danger    — red-tinted; destructive actions
 *   link      — text-only; inline CTAs
 *   outline   — bordered ghost; "neutral but visible"
 *
 * Sizes: sm (28px) / md (32px, default) / lg (40px).
 *
 * States: default · hover · active · focus-visible · disabled · loading.
 * Loading state replaces the lead icon with a spinner, sets
 * aria-busy="true", and disables click events. Disabled and loading
 * apply the same visual treatment (opacity 0.45, cursor: not-allowed).
 *
 * Icon-only mode auto-engages when no slot content is provided (.wp-btn--icon).
 * Pass `aria-label` for screen reader text when using icon-only mode.
 *
 * Variant × State matrix (CSS coverage in tokens.css .wp-btn block):
 *
 *              default  hover  active  focus-visible  disabled  loading
 *   primary      ✓       ✓      ✓         ✓*           ✓†        ✓†
 *   secondary    ✓       ✓      ✓         ✓            ✓†        ✓†
 *   ghost        ✓       ✓      ✓         ✓            ✓†        ✓†
 *   danger       ✓       ✓      ✓         ✓*           ✓†        ✓†
 *   link         ✓       ✓      ✓         ✓*           ✓†        ✓†
 *   outline      ✓       ✓      ✓         ✓            ✓†        ✓†
 *
 *   * variant-specific focus-visible override (different ring color/shadow)
 *   † shared via base .wp-btn:disabled / .wp-btn[aria-busy="true"] rule
 */
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
