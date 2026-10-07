<script setup lang="ts">
/** One image in the Image Filter picker grid. */
defineProps<{
  src: string;
  picked: boolean;
  /** Small corner number (1-based image index); 0 hides it. */
  index: number;
  edited?: boolean;
  masked?: boolean;
  testId?: string;
}>();
defineEmits<{ toggle: []; zoom: []; hover: [on: boolean] }>();
</script>

<template>
  <button
    type="button"
    class="wp-ifp-tile"
    :class="{ 'is-picked': picked }"
    :aria-pressed="picked"
    :data-test="testId"
    @click.stop="$emit('toggle')"
    @dblclick.stop="$emit('zoom')"
    @mouseenter="$emit('hover', true)"
    @mouseleave="$emit('hover', false)"
  >
    <img :src="src" alt="" loading="lazy" draggable="false">
    <span v-if="picked" class="wp-ifp-tile__check" aria-hidden="true">✓</span>
    <span v-if="index" class="wp-ifp-tile__idx">{{ index }}</span>
    <span v-if="edited || masked" class="wp-ifp-tile__marks">
      <span v-if="edited" title="Prompt edited">✎</span>
      <span v-if="masked" title="Mask painted">◐</span>
    </span>
  </button>
</template>

<style scoped>
.wp-ifp-tile { position: relative; padding: 0; border: 2px solid transparent; border-radius: 5px; background: var(--wp-bg3); cursor: pointer; overflow: hidden; line-height: 0; }
.wp-ifp-tile img { display: block; max-width: var(--wp-ifp-tile, 200px); max-height: var(--wp-ifp-tile, 200px); width: auto; height: auto; user-select: none; }
.wp-ifp-tile:hover { border-color: var(--wp-border2, var(--wp-text-dim, #666)); }
.wp-ifp-tile.is-picked { border-color: var(--wp-green, #34c47c); box-shadow: 0 0 0 2px color-mix(in srgb, var(--wp-green, #34c47c) 35%, transparent); }
.wp-ifp-tile__check { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 50%; background: var(--wp-green, #34c47c); color: #0d2a1b; font: 800 11px/18px var(--wp-font-sans); text-align: center; }
.wp-ifp-tile__idx { position: absolute; left: 4px; bottom: 3px; font: 10px/1 var(--wp-font-mono, monospace); color: #fff; text-shadow: 0 1px 2px #000; }
.wp-ifp-tile__marks { position: absolute; right: 4px; bottom: 3px; display: flex; gap: 3px; font: 11px/1 var(--wp-font-sans); color: #fff; text-shadow: 0 1px 2px #000; }
</style>
