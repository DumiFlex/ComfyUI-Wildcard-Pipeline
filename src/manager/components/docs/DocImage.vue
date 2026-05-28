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
 * Real images are click-to-zoom: clicking opens a fullscreen lightbox
 * overlay (Teleported to body so its z-index isn't trapped under the
 * docs sidebar) where the image renders at its natural pixel size up
 * to 95vw / 95vh — useful for screenshots dense with small UI text.
 * Close with the X, Esc, or by clicking the dim backdrop. Placeholders
 * stay non-clickable (there's nothing to zoom into).
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";

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

const fullSrc = computed(() =>
  props.src ? `${import.meta.env.BASE_URL}${props.src.replace(/^\/+/, "")}` : "",
);

// Lightbox state. Only entered for REAL images that have loaded; the
// placeholder + failed-image variants stay inert.
const expanded = ref(false);

function openLightbox(): void {
  if (!props.src || failed.value) return;
  expanded.value = true;
}

function closeLightbox(): void {
  expanded.value = false;
}

// Esc closes. Bound at the document level only while the lightbox is
// open so the listener doesn't sit on every page idle, and so multiple
// DocImages on the same page don't all fire on one keypress.
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeLightbox();
  }
}

watch(expanded, (open) => {
  if (typeof window === "undefined") return;
  if (open) {
    window.addEventListener("keydown", onKeydown);
    // Prevent the page underneath from scrolling while the lightbox is
    // open — keeps the focus on the zoomed image. Restored on close.
    document.body.style.overflow = "hidden";
  } else {
    window.removeEventListener("keydown", onKeydown);
    document.body.style.overflow = "";
  }
});

onBeforeUnmount(() => {
  if (typeof window === "undefined") return;
  window.removeEventListener("keydown", onKeydown);
  // Defensive: if a parent un-mounted us with the lightbox still open,
  // restore the page scroll so the body doesn't stay locked.
  if (expanded.value) document.body.style.overflow = "";
});
</script>

<template>
  <figure class="wp-doc-img">
    <button
      v-if="props.src && !failed"
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

  <Teleport to="body">
    <Transition name="wp-doc-img-lightbox">
      <div
        v-if="expanded"
        class="wp-doc-img-lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="`${alt ?? caption} — zoomed view`"
        data-test="doc-image-lightbox"
        @click.self="closeLightbox"
      >
        <button
          type="button"
          class="wp-doc-img-lightbox__close"
          aria-label="Close zoomed image"
          data-test="doc-image-lightbox-close"
          @click="closeLightbox"
        ><i class="pi pi-times" aria-hidden="true" /></button>
        <img
          :src="fullSrc"
          :alt="alt ?? caption"
          class="wp-doc-img-lightbox__img"
        />
        <figcaption class="wp-doc-img-lightbox__cap">{{ caption }}</figcaption>
      </div>
    </Transition>
  </Teleport>
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

<style>
/* Lightbox overlay lives in <body> via <Teleport>, so its styles can't
 * be scoped (the [data-v-…] attribute Vue adds inside the scoped block
 * would never match the teleported nodes). Class names are still
 * `.wp-` prefixed for css-isolation. */
.wp-doc-img-lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: color-mix(in srgb, #000 85%, transparent);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  cursor: zoom-out;
}
.wp-doc-img-lightbox__close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-1);
  color: var(--wp-text);
  cursor: pointer;
  font-size: 14px;
}
.wp-doc-img-lightbox__close:hover {
  background: var(--wp-bg-2);
  border-color: var(--wp-border-strong);
}
.wp-doc-img-lightbox__close:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: 2px;
}
.wp-doc-img-lightbox__img {
  /* Scale to fit the viewport with margin, but cap at the image's
   * natural size so a small screenshot doesn't pixellate when blown
   * up. `max-width/height` does the fitting; the rounded corner +
   * border match the inline render style. */
  max-width: 95vw;
  max-height: calc(95vh - 80px);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: var(--wp-radius-lg);
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-1);
  cursor: default;
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.55);
}
.wp-doc-img-lightbox__cap {
  max-width: min(95vw, 920px);
  font-size: 13px;
  line-height: 1.5;
  color: #e2e8f0;
  text-align: center;
  font-style: italic;
  cursor: default;
}
/* Fade + scale-in enter, fade-out exit. Honors reduce-motion via the
 * `wp-a11y-no-motion` body class the project uses elsewhere. */
.wp-doc-img-lightbox-enter-active,
.wp-doc-img-lightbox-leave-active {
  transition: opacity 140ms ease;
}
.wp-doc-img-lightbox-enter-active .wp-doc-img-lightbox__img,
.wp-doc-img-lightbox-leave-active .wp-doc-img-lightbox__img {
  transition: transform 140ms ease;
}
.wp-doc-img-lightbox-enter-from,
.wp-doc-img-lightbox-leave-to { opacity: 0; }
.wp-doc-img-lightbox-enter-from .wp-doc-img-lightbox__img,
.wp-doc-img-lightbox-leave-to .wp-doc-img-lightbox__img {
  transform: scale(0.97);
}
body.wp-a11y-no-motion .wp-doc-img-lightbox-enter-active,
body.wp-a11y-no-motion .wp-doc-img-lightbox-leave-active,
body.wp-a11y-no-motion .wp-doc-img-lightbox-enter-active .wp-doc-img-lightbox__img,
body.wp-a11y-no-motion .wp-doc-img-lightbox-leave-active .wp-doc-img-lightbox__img {
  transition: none;
}
</style>
