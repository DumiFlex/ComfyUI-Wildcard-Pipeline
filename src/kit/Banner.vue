<script setup lang="ts">
/**
 * Banner: an inline message in a tone, with an optional title, actions and
 * a close button. It sits in the flow of the page (not floating), above or
 * inside whatever it talks about. Works on the canvas and in the manager.
 *
 *   <Banner tone="warn" title="2 modules are out of date">
 *     Update them before you publish.
 *     <template #actions><Button size="sm">Update</Button></template>
 *   </Banner>
 *
 * A danger banner is announced at once (`role="alert"`); the others are
 * read politely (`role="status"`). Neither takes focus. `note` is for text
 * that is part of the page (a docs tip): `role="note"`, never announced.
 */
import { computed, useSlots } from "vue";
import CloseButton from "./CloseButton.vue";

export type BannerTone = "neutral" | "info" | "success" | "warn" | "danger" | "accent";

const TONE_ICON: Record<BannerTone, string> = {
  neutral: "pi-info-circle",
  info: "pi-info-circle",
  success: "pi-check-circle",
  warn: "pi-exclamation-triangle",
  danger: "pi-times-circle",
  accent: "pi-sparkles",
};

const props = withDefaults(defineProps<{
  tone?: BannerTone | undefined;
  title?: string | undefined;
  /** A PrimeIcons class to use instead of the tone's icon; `""` for none. */
  icon?: string | undefined;
  size?: "sm" | "md" | undefined;
  /** Show a close button; it emits `dismiss`. */
  dismissible?: boolean | undefined;
  /** The close button's name. */
  dismissLabel?: string | undefined;
  /** Part of the page, not news: `role="note"` instead of a live region. */
  note?: boolean | undefined;
}>(), { tone: "info", size: "md", icon: undefined, dismissLabel: "Dismiss" });

const emit = defineEmits<{ (e: "dismiss"): void }>();
const slots = useSlots();

const iconClass = computed(() => props.icon ?? TONE_ICON[props.tone]);
</script>

<template>
  <div
    class="wp-banner"
    :data-tone="tone"
    :data-size="size"
    :role="note ? 'note' : tone === 'danger' ? 'alert' : 'status'"
  >
    <i v-if="iconClass" class="pi wp-banner__icon" :class="iconClass" aria-hidden="true" />
    <div class="wp-banner__body">
      <p v-if="title" class="wp-banner__title">{{ title }}</p>
      <div v-if="slots.default" class="wp-banner__text"><slot /></div>
    </div>
    <div v-if="slots.actions" class="wp-banner__actions"><slot name="actions" /></div>
    <CloseButton
      v-if="dismissible"
      class="wp-banner__close"
      size="sm"
      :label="dismissLabel"
      @click="emit('dismiss')"
    />
  </div>
</template>

<style scoped>
.wp-banner {
  --_banner-tone: var(--wp-info);
  display: flex;
  align-items: flex-start;
  gap: var(--wp-space-4);
  min-width: 0;
  padding: var(--wp-space-4) var(--wp-space-5);
  border: 1px solid color-mix(in srgb, var(--_banner-tone) 38%, var(--wp-border));
  border-radius: var(--wp-radius-md);
  background: color-mix(in srgb, var(--_banner-tone) 10%, var(--wp-bg-1));
  color: var(--wp-text);
  font: 400 var(--wp-text-sm)/1.45 var(--wp-font-sans);
}
.wp-banner[data-tone="neutral"] { --_banner-tone: var(--wp-text-muted); }
.wp-banner[data-tone="success"] { --_banner-tone: var(--wp-success); }
.wp-banner[data-tone="warn"] { --_banner-tone: var(--wp-warn); }
.wp-banner[data-tone="danger"] { --_banner-tone: var(--wp-danger); }
.wp-banner[data-tone="accent"] { --_banner-tone: var(--wp-accent-500); }
.wp-banner[data-size="sm"] {
  gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-4);
  border-radius: var(--wp-radius);
  font-size: var(--wp-text-xs);
}
.wp-banner__icon {
  flex: none;
  /* Centre the icon on the first line of text. */
  line-height: 1.45;
  font-size: 1.1em;
  color: var(--_banner-tone);
}
.wp-banner[data-tone="accent"] .wp-banner__icon { color: var(--wp-accent-text); }
.wp-banner__body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.wp-banner__title { margin: 0; font-weight: 600; }
.wp-banner__text { color: var(--wp-text-muted); overflow-wrap: anywhere; }
.wp-banner__body > .wp-banner__text:only-child { color: var(--wp-text); }
.wp-banner__text :deep(p) { margin: 0; }
.wp-banner__text :deep(p + p) { margin-top: var(--wp-space-2); }
.wp-banner__actions { display: inline-flex; align-items: center; gap: var(--wp-space-3); flex: none; align-self: center; }
.wp-banner__close { flex: none; margin: -2px calc(var(--wp-space-2) * -1) -2px 0; }
@media (max-width: 520px) {
  .wp-banner { flex-wrap: wrap; }
  .wp-banner__actions { order: 3; width: 100%; padding-left: calc(1.1em + var(--wp-space-4)); }
}
</style>
