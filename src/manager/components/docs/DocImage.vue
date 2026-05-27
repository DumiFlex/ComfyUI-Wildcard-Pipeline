<script setup lang="ts">
/**
 * DocImage — an example-image slot for the docs.
 *
 * Until a real screenshot is supplied via `src`, it renders a labelled
 * placeholder whose caption describes WHAT the image should show, so a
 * human can capture + drop it in later. Set `src` (a path under the SPA's
 * public base, e.g. "images/docs/<name>.png") to swap the placeholder for
 * the real image — the caption stays as the figure label.
 */
withDefaults(
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
</script>

<template>
  <figure class="wp-doc-img">
    <img v-if="src" :src="src" :alt="alt ?? caption" class="wp-doc-img__real" />
    <div v-else class="wp-doc-img__ph" :style="{ aspectRatio: ratio }" role="img" :aria-label="`Placeholder: ${caption}`">
      <i class="pi pi-image wp-doc-img__ph-icon" aria-hidden="true" />
      <span class="wp-doc-img__ph-tag">Example image</span>
    </div>
    <figcaption class="wp-doc-img__cap">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped>
.wp-doc-img { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.wp-doc-img__real {
  width: 100%;
  border-radius: var(--wp-radius-lg);
  border: 1px solid var(--wp-border);
  display: block;
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
