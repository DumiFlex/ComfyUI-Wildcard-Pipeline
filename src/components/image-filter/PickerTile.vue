<script setup lang="ts">
/** One image in the Image Filter picker grid: a kit Button toggle (`pressed`)
 *  wrapping the picture and its corner marks. With `aspect` every tile is one
 *  cell shape (`--wp-ifp-tile` on its long side) and a picture of another
 *  size or shape sits inside it, so a run of mixed sizes still lines up. */
import { computed } from "vue";
import Button from "@/kit/Button.vue";
const props = defineProps<{
  src: string;
  picked: boolean;
  /** Small corner number (1-based image index); 0 hides it. */
  index: number;
  edited?: boolean;
  masked?: boolean;
  testId?: string;
  /** The cell shape (height over width); unset shows the picture at its own shape. */
  aspect?: number;
  /** A small "1024 × 1536" mark, for runs that mix sizes. */
  size?: string;
}>();
/** The cell's share of the tile size on each side. */
const cellStyle = computed(() => {
  const a = props.aspect;
  if (!a || !Number.isFinite(a) || a <= 0) return undefined;
  return { "--wp-ifp-cell-w": String(Math.min(1, 1 / a)), "--wp-ifp-cell-h": String(Math.min(1, a)) };
});
const emit = defineEmits<{ toggle: []; zoom: []; hover: [on: boolean] }>();

function onToggle(e: MouseEvent): void {
  e.stopPropagation();
  emit("toggle");
}
</script>

<template>
  <Button
    variant="ghost"
    class="wp-ifp-tile"
    :class="{ 'is-picked': picked, 'is-cell': !!cellStyle }"
    :style="cellStyle"
    :pressed="picked"
    :data-test="testId"
    @click="onToggle"
    @dblclick.stop="emit('zoom')"
    @mouseenter="emit('hover', true)"
    @mouseleave="emit('hover', false)"
  >
    <img :src="src" alt="" loading="lazy" draggable="false">
    <span v-if="picked" class="wp-ifp-tile__check" aria-hidden="true">✓</span>
    <span v-if="size" class="wp-ifp-tile__size" data-test="image-filter-tile-size-mark">{{ size }}</span>
    <span v-if="index" class="wp-ifp-tile__idx">{{ index }}</span>
    <span v-if="edited || masked" class="wp-ifp-tile__marks">
      <span v-if="edited" title="Prompt edited">✎</span>
      <span v-if="masked" title="Mask painted">◐</span>
    </span>
  </Button>
</template>

<style scoped>
/* The kit Button drawn as a picture tile: no padding, height or tint of its
 * own; the label box holds the picture at its natural size. */
.wp-btn.wp-ifp-tile, .wp-btn.wp-ifp-tile[aria-pressed] {
  position: relative; display: block; width: auto; height: auto; min-width: 0; padding: 0;
  border: 2px solid transparent; border-radius: min(5px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg3); color: inherit; cursor: pointer; overflow: hidden; line-height: 0;
}
.wp-ifp-tile :deep(.wp-btn__label) { display: block; text-box: normal; line-height: 0; }
.wp-ifp-tile img { display: block; max-width: var(--wp-ifp-tile, 200px); max-height: var(--wp-ifp-tile, 200px); width: auto; height: auto; user-select: none; }
/* One cell shape for every tile; the picture fits inside it (scaled up or down). */
.wp-btn.wp-ifp-tile.is-cell { width: calc(var(--wp-ifp-tile, 200px) * var(--wp-ifp-cell-w) + 4px); height: calc(var(--wp-ifp-tile, 200px) * var(--wp-ifp-cell-h) + 4px); }
.wp-ifp-tile.is-cell :deep(.wp-btn__label) { width: 100%; height: 100%; }
.wp-ifp-tile.is-cell img { width: 100%; height: 100%; max-width: none; max-height: none; object-fit: contain; }
.wp-btn.wp-ifp-tile:hover { border-color: var(--wp-border2, var(--wp-text-dim)); }
.wp-btn.wp-ifp-tile.is-picked { border-color: var(--wp-green); box-shadow: 0 0 0 2px color-mix(in srgb, var(--wp-green) 35%, transparent); }
.wp-ifp-tile__check { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 50%; background: var(--wp-green); color: color-mix(in srgb, var(--wp-green) 20%, black); font: 800 11px/18px var(--wp-font-sans); text-align: center; }
.wp-ifp-tile__idx { position: absolute; left: 4px; bottom: 3px; font: 10px/1 var(--wp-font-mono, monospace); color: var(--wp-on-media); text-shadow: 0 1px 2px var(--wp-scrim); }
.wp-ifp-tile__size { position: absolute; left: 4px; top: 4px; padding: 0 4px; border-radius: min(3px, var(--wp-radius-cap, 999px)); background: var(--wp-scrim); font: 10px/15px var(--wp-font-mono, monospace); color: var(--wp-on-media); }
.wp-ifp-tile__marks { position: absolute; right: 4px; bottom: 3px; display: flex; gap: 3px; font: 11px/1 var(--wp-font-sans); color: var(--wp-on-media); text-shadow: 0 1px 2px var(--wp-scrim); }
</style>
