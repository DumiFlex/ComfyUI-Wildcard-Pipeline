<script setup lang="ts">
/**
 * Floating drop indicator bar. Rendered inside every drop-container
 * (top-level wp-list + every wp-bundle-children). Position is computed
 * from the resolved DropZone — when the zone targets this container,
 * the bar appears at the correct slot; otherwise it stays hidden.
 *
 * The bar is absolutely positioned, sized to the container's content
 * width (via left/right inset = 0). Drop-inside zones (kind:"empty"
 * + the container itself) toggle a separate `--inside` modifier the
 * parent frame paints — this SFC only handles the gap-bar variant.
 *
 * The container provides a `dropBarFor(containerUid)` lookup through
 * BundleFrameCtx. ContextWidget owns the dragOver ref + the rect math;
 * this component is purely declarative.
 *
 * **No rAF refinement here.** dropBarFor uses `offsetTop` walkers
 * (CSS pixels, zoom-independent) instead of getBoundingClientRect
 * (viewport pixels, scaled by the canvas zoom transform). offsetTop
 * is layout-stable across Vue's flush:"post" boundary, so a simple
 * computed off the resolved zone is enough — no second-pass refinement
 * needed. Earlier rAF-based refinement was added when the position
 * used getBoundingClientRect; that machinery is no longer required
 * and removing it eliminates a potential double-paint glitch when
 * the bundle moves under wp-gap-before margin and the rAF callback
 * reads a different value than the eager paint.
 */
import { computed, inject } from "vue";
import { BundleFrameCtxKey } from "./bundle-frame-ctx";

interface Props {
  /** The container's bundle uid, or null for the top-level list. */
  containerUid: string | null;
}
const props = defineProps<Props>();

const ctx = inject(BundleFrameCtxKey);

const position = computed<{ top: number } | null>(() => {
  if (!ctx) return null;
  return ctx.dropBarFor(props.containerUid);
});
</script>

<template>
  <div
    v-if="position"
    class="wp-drop-bar"
    :style="{ top: position.top + 'px' }"
    aria-hidden="true"
  />
</template>

<style scoped>
.wp-drop-bar {
  position: absolute;
  left: 4px;
  right: 4px;
  height: 2px;
  background: var(--wp-accent, #6366f1);
  border-radius: 1px;
  pointer-events: none;
  z-index: 5;
  box-shadow: 0 0 6px var(--wp-accent, #6366f1);
}
</style>
