<script setup lang="ts">
/**
 * The canvas twin of the manager Button (manager/components/ui/Button.vue).
 * Same variants, sizes and states, same stylesheet (`button.css`), but the
 * icon is a PrimeIcons class, as everywhere on the canvas, and the default
 * size is the canvas `sm`.
 *
 *   <WpButton variant="primary" icon="pi-plus">Add module</WpButton>
 *   <WpButton variant="ghost" icon="pi-download" aria-label="Download snapshot" />
 *
 * With no slot content it is an icon button (`.wp-btn--icon`); its
 * `aria-label` is also its tooltip. Loading swaps the icon for the sparkle,
 * sets aria-busy and ignores clicks.
 *
 * The stylesheet is pulled in scoped: loading button.css globally on the
 * canvas would also restyle the row icon buttons that share its tone class
 * names (`.wp-btn--danger` on `.wp-btn--icon-sm`).
 */
import { computed, useSlots } from "vue";
import LoadingMark from "./LoadingMark.vue";
import { vTooltip } from "./tooltip";

const props = withDefaults(defineProps<{
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link" | "outline";
  size?: "sm" | "md" | "lg";
  /** PrimeIcons class (e.g. `pi-plus`), drawn before the label. */
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  ariaLabel?: string;
}>(), { variant: "secondary", size: "sm", icon: undefined, type: "button", ariaLabel: undefined });

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
    v-tooltip="iconOnly ? ariaLabel : undefined"
    :type="type"
    class="wp-btn"
    :class="[`wp-btn--${variant}`, `wp-btn--${size}`, { 'wp-btn--icon': iconOnly }]"
    :disabled="disabled || loading"
    :aria-label="ariaLabel"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <LoadingMark v-if="loading" variant="sparkle" mono :size="size === 'lg' ? 16 : size === 'md' ? 14 : 12" decorative />
    <i v-else-if="icon" class="pi" :class="icon" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped src="./button.css"></style>
