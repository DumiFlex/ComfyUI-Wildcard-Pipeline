<script setup lang="ts">
import { useSlots, ref, onMounted, onBeforeUnmount } from "vue";

interface Props {
  title?: string;
  subtitle?: string;
  padding?: boolean;
  /** Stick the card header to the top of the nearest scroll container so its
   *  actions (e.g. "Add option") stay reachable when scrolling a long list —
   *  new rows always land at the bottom, so the toolbar must follow. Also
   *  publishes the measured header height as `--wp-card-header-h` on the card
   *  so a sticky `<thead>` inside can offset itself right below the header
   *  (works across density modes / button wrapping). */
  stickyHeader?: boolean;
}
const props = withDefaults(defineProps<Props>(), { padding: true, stickyHeader: false });

const slots = useSlots();
const root = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;

function syncHeaderHeight(): void {
  if (!root.value || !headerEl.value) return;
  const h = Math.round(headerEl.value.getBoundingClientRect().height);
  root.value.style.setProperty("--wp-card-header-h", `${h}px`);
}

onMounted(() => {
  if (!props.stickyHeader || !headerEl.value) return;
  syncHeaderHeight();
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(syncHeaderHeight);
    ro.observe(headerEl.value);
  }
});
onBeforeUnmount(() => { ro?.disconnect(); ro = null; });
</script>

<template>
  <section ref="root" class="wp-card" :class="{ 'wp-card--sticky-header': stickyHeader }">
    <header v-if="title || slots.actions" ref="headerEl" class="wp-card__header">
      <div class="wp-card__title-wrap">
        <h2 v-if="title" class="wp-card__title">{{ title }}</h2>
        <p v-if="subtitle" class="wp-card__subtitle">{{ subtitle }}</p>
      </div>
      <span class="wp-spacer" />
      <slot name="actions" />
    </header>
    <div :class="padding ? 'wp-card__body' : ''">
      <slot />
    </div>
  </section>
</template>
