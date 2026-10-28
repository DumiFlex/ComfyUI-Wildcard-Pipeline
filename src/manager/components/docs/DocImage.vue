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
import Lightbox from "@/components/shared/Lightbox.vue";
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
const btnEl = ref<HTMLElement | null>(null);

const fullSrc = computed(() =>
  props.src ? `${import.meta.env.BASE_URL}${props.src.replace(/^\/+/, "")}` : "",
);

const shot = computed<DocShot>(() => ({
  image: { src: fullSrc.value, alt: props.alt ?? props.caption, caption: props.caption },
  el: () => btnEl.value,
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
    <button
      v-if="props.src && !failed"
      ref="btnEl"
      type="button"
      class="wp-doc-img__btn"
      :aria-label="`Open ${alt ?? caption} at full size`"
      data-test="doc-image-open"
      @click="openLightbox"
    >
      <img
        :src="fullSrc"
        :alt="alt ?? caption"
        class="wp-doc-img__real"
        @error="failed = true"
      />
      <span class="wp-doc-img__zoom-hint" aria-hidden="true">
        <i class="pi pi-search-plus" />
      </span>
    </button>
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
/* The image is wrapped in a button so the whole canvas is keyboard-
 * focusable + click-activated. Reset native button chrome so the wrap
 * doesn't add background/border around the screenshot. */
.wp-doc-img__btn {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  margin: 0;
  background: transparent;
  border: none;
  cursor: zoom-in;
  border-radius: var(--wp-radius-lg);
  /* Keep keyboard focus visible without obscuring the image edge — the
   * outline sits OUTSIDE the bounding box. */
}
.wp-doc-img__btn:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 2px;
}
.wp-doc-img__real {
  width: 100%;
  border-radius: var(--wp-radius-lg);
  border: 1px solid var(--wp-border);
  display: block;
  transition: filter 120ms ease;
}
.wp-doc-img__btn:hover .wp-doc-img__real {
  filter: brightness(1.05);
}
/* Floating zoom-in glyph — surfaces the click affordance without
 * cluttering the screenshot. Becomes more opaque on hover so the
 * "you can click this" hint is obvious. */
.wp-doc-img__zoom-hint {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wp-bg-1) 70%, transparent);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  opacity: 0.55;
  transition: opacity 120ms ease, background 120ms ease;
  pointer-events: none;
  font-size: 12px;
}
.wp-doc-img__btn:hover .wp-doc-img__zoom-hint,
.wp-doc-img__btn:focus-visible .wp-doc-img__zoom-hint {
  opacity: 1;
  background: var(--wp-bg-1);
}
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

