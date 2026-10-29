<script setup lang="ts">
import { useSlots, ref, onMounted, onBeforeUnmount } from "vue";

interface Props {
  title?: string | undefined;
  subtitle?: string | undefined;
  padding?: boolean | undefined;
  /** Stick the card header (and its `subheader` slot, e.g. a bulk-edit
   *  toolbar) to the top of the nearest scroll container so its actions stay
   *  reachable when scrolling a long list — new rows always land at the
   *  bottom, so the toolbar must follow. Publishes the measured height of the
   *  whole stuck region as `--wp-card-header-h` so a sticky `<thead>` inside
   *  the body can offset itself right below it (updates as the subheader
   *  toolbar appears/disappears or density changes). */
  stickyHeader?: boolean | undefined;
}
const props = withDefaults(defineProps<Props>(), { padding: true, stickyHeader: false });

const slots = useSlots();
const root = ref<HTMLElement | null>(null);
const stickyEl = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;
/** The stuck region is taller than a third of the window (an AI draft or a
 *  bulk-add box open in the subheader): it would cover the list it belongs
 *  to and the page couldn't scroll past it, so it scrolls with the card. */
const tooTall = ref(false);

function syncStickyHeight(): void {
  if (!root.value || !stickyEl.value) return;
  const h = Math.round(stickyEl.value.getBoundingClientRect().height);
  tooTall.value = typeof window !== "undefined" && window.innerHeight > 0 && h > window.innerHeight / 3;
  root.value.style.setProperty("--wp-card-header-h", tooTall.value ? "0px" : `${h}px`);
}

onMounted(() => {
  if (!props.stickyHeader || !stickyEl.value) return;
  syncStickyHeight();
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(syncStickyHeight);
    ro.observe(stickyEl.value);
  }
  window.addEventListener("resize", syncStickyHeight);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  window.removeEventListener("resize", syncStickyHeight);
});
</script>

<template>
  <section ref="root" class="wp-card" :class="{ 'wp-card--sticky-header': stickyHeader && !tooTall }">
    <div ref="stickyEl" class="wp-card__sticky">
      <header v-if="title || slots.actions" class="wp-card__header">
        <div class="wp-card__title-wrap">
          <h2 v-if="title" class="wp-card__title">{{ title }}</h2>
          <p v-if="subtitle" class="wp-card__subtitle">{{ subtitle }}</p>
        </div>
        <span class="wp-spacer" />
        <slot name="actions" />
      </header>
      <slot name="subheader" />
    </div>
    <div :class="padding ? 'wp-card__body' : ''">
      <slot />
    </div>
  </section>
</template>
