<script setup lang="ts">
/**
 * A grid of image tiles that fills its width (tiles at least `min-size`
 * wide). A click or Enter opens the image in a Lightbox, where ← / → step
 * through the rest. With `selectable` each tile gets a check box in its
 * corner and `v-model:selected` holds the picked ids.
 *
 *   <ImageGrid :images="outputs" />
 *   <ImageGrid v-model:selected="keep" :images="frames" selectable :min-size="96" />
 *
 * Tiles are buttons in reading order (one Tab stop each); a tile with no
 * `src` draws a Skeleton-like block while it loads.
 */
import { computed, ref } from "vue";
import Lightbox from "./Lightbox.vue";
import WpCheck from "./WpCheck.vue";

export interface GridImage { id: string; src: string; alt: string; thumb?: string; caption?: string }

const props = withDefaults(defineProps<{
  images: GridImage[];
  /** Smallest tile width in px. */
  minSize?: number;
  /** Width / height of a tile. */
  aspect?: number;
  gap?: "sm" | "md";
  selectable?: boolean;
  selected?: string[];
  /** Open the Lightbox on a click (off: emit `open` and do your own thing). */
  lightbox?: boolean;
  ariaLabel?: string;
}>(), { minSize: 120, aspect: 1, gap: "md", selectable: false, selected: () => [], lightbox: true, ariaLabel: "Images" });

const emit = defineEmits<{
  (e: "update:selected", v: string[]): void;
  (e: "open", index: number): void;
}>();

const open = ref(false);
const at = ref(0);
const shots = computed(() => props.images.map((i) => ({ src: i.src, alt: i.alt, caption: i.caption })));

function show(i: number): void {
  emit("open", i);
  if (!props.lightbox) return;
  at.value = i;
  open.value = true;
}

function toggle(id: string, on: boolean): void {
  emit("update:selected", on ? [...props.selected, id] : props.selected.filter((x) => x !== id));
}
</script>

<template>
  <div class="wp-image-grid">
  <ul
    class="wp-image-grid__list"
    :data-gap="gap"
    :aria-label="ariaLabel"
    :style="{ '--_min': `${minSize}px`, '--_aspect': String(aspect) }"
  >
    <li
      v-for="(img, i) in images"
      :key="img.id"
      class="wp-image-grid__tile"
      :data-selected="(selectable && selected.includes(img.id)) || undefined"
    >
      <button
        type="button"
        class="wp-image-grid__open"
        :aria-label="selectable ? `Open ${img.alt}` : img.alt"
        @click="show(i)"
      >
        <img v-if="img.thumb || img.src" class="wp-image-grid__img" :src="img.thumb || img.src" alt="" loading="lazy">
        <span v-else class="wp-image-grid__empty" aria-hidden="true" />
      </button>
      <WpCheck
        v-if="selectable"
        class="wp-image-grid__check"
        :model-value="selected.includes(img.id)"
        :aria-label="`Select ${img.alt}`"
        @update:model-value="toggle(img.id, $event)"
      />
      <span v-if="img.caption" class="wp-image-grid__caption">{{ img.caption }}</span>
    </li>
  </ul>
  <Lightbox v-if="lightbox" v-model:open="open" v-model:index="at" :images="shots" />
  </div>
</template>

<style scoped>
.wp-image-grid { min-width: 0; }
.wp-image-grid__list {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--_min), 1fr));
  gap: var(--wp-space-3); margin: 0; padding: 0; list-style: none;
}
.wp-image-grid__list[data-gap="sm"] { gap: var(--wp-space-1); }
.wp-image-grid__tile { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wp-image-grid__open {
  display: block; width: 100%; aspect-ratio: var(--_aspect); padding: 0; overflow: hidden;
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  background: var(--wp-bg-2); cursor: zoom-in;
  transition: border-color var(--wp-motion-hover), box-shadow var(--wp-motion-hover);
}
.wp-image-grid__open:hover { border-color: var(--wp-border-strong); }
.wp-image-grid__open:focus-visible { outline: none; border-color: var(--wp-border-focus); box-shadow: 0 0 0 3px var(--wp-focus-ring); }
.wp-image-grid__tile[data-selected] .wp-image-grid__open { border-color: var(--wp-accent); box-shadow: 0 0 0 2px var(--wp-accent-glow); }
.wp-image-grid__img { display: block; width: 100%; height: 100%; object-fit: cover; }
.wp-image-grid__empty {
  display: block; width: 100%; height: 100%;
  background: linear-gradient(90deg, var(--wp-bg-2) 0%, var(--wp-bg-3) 50%, var(--wp-bg-2) 100%);
  background-size: 200% 100%; animation: wp-image-grid-shimmer var(--wp-motion-shimmer) infinite;
}
@keyframes wp-image-grid-shimmer { to { background-position: -200% 0; } }
.wp-image-grid__check { position: absolute; top: 6px; left: 6px; }
.wp-image-grid__caption {
  overflow: hidden; color: var(--wp-text-muted); font: 400 var(--wp-text-xs)/1.3 var(--wp-font-sans);
  text-overflow: ellipsis; white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .wp-image-grid__open { transition: none; }
  .wp-image-grid__empty { animation: none; }
}
</style>
