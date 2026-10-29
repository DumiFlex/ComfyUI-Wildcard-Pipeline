<script setup lang="ts">
/**
 * The canvas twin of the manager Button (manager/components/ui/Button.vue).
 * Same variants, sizes and states, same stylesheet (`button.css`), but the
 * icon is a PrimeIcons class, as everywhere on the canvas, and the default
 * size is the canvas `sm`.
 *
 *   <WpButton variant="primary" icon="pi-plus">Add module</WpButton>
 *   <WpButton variant="ghost" icon="pi-download" aria-label="Download snapshot" />
 *   <WpButton variant="add" icon="pi-plus" block>Add rule</WpButton>
 *
 * With no slot content it is an icon button (`.wp-btn--icon`); its
 * `aria-label` is also its tooltip (`hint` sets another, `kbd` adds a key
 * chip). `pressed` turns it into a toggle (a "favourites only" star, a
 * filter panel trigger). Loading swaps the icon for the sparkle, sets
 * aria-busy and ignores clicks.
 *
 * The stylesheet is pulled in scoped, so the canvas never carries the
 * `.wp-btn` classes globally. Row icon buttons are WpIconButton.
 */
import { computed, useSlots } from "vue";
import LoadingMark from "./LoadingMark.vue";
import { vTooltip } from "./tooltip";

const props = withDefaults(defineProps<{
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link" | "outline" | "add" | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  /** PrimeIcons class (e.g. `pi-plus`), drawn before the label. */
  icon?: string | undefined;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Stretch to the container's full width. */
  block?: boolean | undefined;
  /** Makes it a toggle (`aria-pressed`): on, it wears the accent tint. */
  pressed?: boolean | undefined;
  type?: "button" | "submit" | "reset" | undefined;
  ariaLabel?: string | undefined;
  /** Tooltip text; an icon button shows its aria-label when this is unset.
   *  Use this, not `v-tooltip` on the component, which would fight the
   *  button's own. */
  hint?: string | undefined;
  /** A shortcut shown in the tooltip's key chip, e.g. "P". */
  kbd?: string | undefined;
}>(), { variant: "secondary", size: "sm", icon: undefined, type: "button", ariaLabel: undefined, hint: undefined, kbd: undefined, pressed: undefined });

const emit = defineEmits<{ click: [evt: MouseEvent] }>();

const slots = useSlots();
const iconOnly = computed(() => !slots.default);

function onClick(e: MouseEvent): void {
  if (props.disabled || props.loading) return;
  emit("click", e);
}
</script>

<template>
  <button
    v-tooltip="{ text: hint ?? (iconOnly ? ariaLabel : undefined), kbd }"
    :type="type"
    class="wp-btn"
    :class="[`wp-btn--${variant}`, `wp-btn--${size}`, { 'wp-btn--icon': iconOnly, 'wp-btn--block': block }]"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    :aria-pressed="pressed === undefined ? undefined : pressed"
    @click="onClick"
  >
    <LoadingMark v-if="loading" variant="sparkle" mono :size="size === 'lg' ? 16 : size === 'md' ? 14 : 12" decorative />
    <i v-else-if="icon" class="pi" :class="icon" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped src="./button.css"></style>
