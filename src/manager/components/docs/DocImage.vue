<script setup lang="ts">
/**
 * DocImage — an example-image slot for the docs.
 *
 * Until a real screenshot is supplied via `src`, it renders a labelled
 * placeholder whose caption describes WHAT the image should show, so a
 * human can capture + drop it in later. Set `src` (a path under the SPA's
 * public base, e.g. "images/docs/<name>.png") to swap the placeholder for
 * the real image — the caption stays as the figure label.
 *
 * Real images are click-to-zoom: a click opens the page's Lightbox (one per
 * DocPage, see `docs/gallery.ts`) at this image, with zoom levels, and ← / →
 * step through the page's other screenshots. Outside a DocPage it opens a
 * Lightbox of its own. Placeholders stay non-clickable.
 */
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import ImageGrid from "@/kit/ImageGrid.vue";
import Lightbox from "@/kit/Lightbox.vue";
import DocFigureText from "./DocFigureText.vue";
import { DOC_GALLERY, type DocShot } from "../../docs/gallery";

const props = withDefaults(
  defineProps<{
    /** Describes what the image depicts — shown as the caption AND as the
     *  placeholder brief. Always required so an unfilled slot is self-documenting. */
    caption: string;
    /** Real image path once captured. When unset, the placeholder shows. */
    src?: string;
    alt?: string;
    /** CSS aspect-ratio for the placeholder box, e.g. "16 / 9", "4 / 3". */
    ratio?: string;
  }>(),
  { ratio: "16 / 9" },
);

const failed = ref(false);
const gridEl = ref<{ $el: HTMLElement } | null>(null);
/** The picture's own button inside the grid, where focus goes back after the gallery. */
const btnEl = (): HTMLElement | null => gridEl.value?.$el.querySelector<HTMLElement>("button") ?? null;

const fullSrc = computed(() =>
  props.src ? `${import.meta.env.BASE_URL}${props.src.replace(/^\/+/, "")}` : "",
);

const shot = computed<DocShot>(() => ({
  image: { src: fullSrc.value, alt: props.alt ?? props.caption, caption: props.caption },
  el: btnEl,
}));

const gallery = inject(DOC_GALLERY, null);
const ownOpen = ref(false);

// Only real images that loaded join the page's gallery.
let leave: (() => void) | null = null;
watch([shot, failed], () => {
  leave?.();
  leave = gallery && props.src && !failed.value ? gallery.add(shot.value) : null;
}, { immediate: true });
onBeforeUnmount(() => leave?.());

function openLightbox(): void {
  if (!props.src || failed.value) return;
  if (gallery) gallery.open(shot.value);
  else ownOpen.value = true;
}
</script>

<template>
  <figure class="wp-doc-img">
    <div v-if="props.src && !failed" class="wp-doc-img__frame">
      <ImageGrid
        ref="gridEl"
        class="wp-doc-img__grid"
        :images="[{ id: props.src, src: fullSrc, alt: alt ?? caption }]"
        aspect="auto"
        :columns="1"
        hint
        :lightbox="false"
        :aria-label="`Open ${alt ?? caption} at full size`"
        data-test="doc-image-open"
        @open="openLightbox"
        @error="failed = true"
      />
      <!-- Drawn over the picture, in its own box (DocAnnotated's pins). -->
      <slot name="overlay" />
    </div>
    <div v-else class="wp-doc-img__ph" :style="{ aspectRatio: ratio }" role="img" :aria-label="`Placeholder: ${caption}`">
      <i class="pi pi-image wp-doc-img__ph-icon" aria-hidden="true" />
      <span class="wp-doc-img__ph-tag">Example image</span>
    </div>
    <figcaption class="wp-doc-img__cap">{{ caption }}</figcaption>
  </figure>
  <DocFigureText :figure="src" :caption="caption" />
  <Lightbox v-if="!gallery" v-model:open="ownOpen" :images="[shot.image]" zoom />
</template>

<style scoped>
.wp-doc-img { margin: 0; display: flex; flex-direction: column; gap: 8px; }
/* The picture is the kit ImageGrid at its own shape: one tile, full width,
 * a magnifier on hover, and a click opens the page's gallery. */
.wp-doc-img__grid :deep(.wp-image-grid__open) { border-radius: var(--wp-radius-lg); }
.wp-doc-img__frame { position: relative; }
/* The docs prose indents every list; the grid's own list must not be. */
.wp-doc-img__grid :deep(.wp-image-grid__list) { margin: 0; padding: 0; }
.wp-doc-img__ph {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1.5px dashed color-mix(in oklab, var(--wp-accent-500) 40%, var(--wp-border-strong));
  border-radius: var(--wp-radius-lg);
  background:
    repeating-linear-gradient(45deg,
      color-mix(in oklab, var(--wp-accent-500) 4%, transparent) 0 10px,
      transparent 10px 20px),
    var(--wp-bg-1);
  color: var(--wp-text-dim);
}
.wp-doc-img__ph-icon { font-size: 26px; opacity: 0.7; }
.wp-doc-img__ph-tag {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 600;
  color: var(--wp-text-dim);
}
.wp-doc-img__cap {
  font-size: 12px;
  line-height: 1.5;
  color: var(--wp-text-muted);
  text-align: center;
  font-style: italic;
}
</style>

