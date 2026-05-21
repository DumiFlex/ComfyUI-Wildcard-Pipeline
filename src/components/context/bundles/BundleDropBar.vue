<script setup lang="ts">
/**
 * Floating drop indicator bar. Rendered inside every drop-container
 * (top-level wp-list + every wp-bundle-children). Position is computed
 * from the resolved DropZone — when the zone targets this container,
 * the bar appears at the correct slot; otherwise it stays hidden.
 *
 * The bar is absolutely positioned, sized to the container's content
 * width (via left/right inset = 0), and animates between positions
 * for a smooth indicator. Drop-inside zones (kind:"empty" + the
 * container itself) toggle a separate `--inside` modifier the parent
 * frame paints — this SFC only handles the gap-bar variant.
 *
 * The container provides a `dropBarFor(containerUid)` lookup through
 * BundleFrameCtx. ContextWidget owns the dragOver ref + the rect math;
 * this component is purely declarative.
 *
 * **Why nextTick + ref:** dropBarFor reads getBoundingClientRect on
 * row/bundle elements. Vue's reactive flush runs effects (including
 * this component's computed) BEFORE patching DOM — so the rects
 * reflect PRE-patch layout. By the time the DOM actually updates
 * (rows get `wp-gap-before` margin → shift down 14px), our computed
 * has already used the OLD positions. The bar paints in the wrong
 * place — typically 14-22px too high, increasing as more rows below
 * also shift. We fix this by deferring the position computation to
 * the next tick: watch the zone reactively, then on the next flush
 * (after DOM patch) re-read the rects and update the bar's position.
 */
import { inject, ref, watch } from "vue";
import { BundleFrameCtxKey } from "./bundle-frame-ctx";

interface Props {
  /** The container's bundle uid, or null for the top-level list. */
  containerUid: string | null;
}
const props = defineProps<Props>();

const ctx = inject(BundleFrameCtxKey);

/** Bar position — null when no zone targets this container. Updated
 *  via watchEffect that defers the actual rect read to the next
 *  microtask after the DOM patches the relevant row's gap-before
 *  margin. */
const position = ref<{ top: number } | null>(null);

watch(
  () => (ctx ? ctx.dropBarFor(props.containerUid) : null),
  (val) => {
    if (!val) {
      position.value = null;
      return;
    }
    // Eager paint so the bar shows up on the same frame as the
    // dragover. Then refine on the NEXT animation frame — at that
    // point the browser has reflowed after the wp-gap-before margin
    // (Vue's flush:"post" runs after Vue's render, but the BROWSER
    // hasn't necessarily painted yet — rAF guarantees that). The
    // refined dropBarFor reads getBoundingClientRect on the row
    // POST-margin-applied, giving the correct position.
    position.value = val;
    requestAnimationFrame(() => {
      if (!ctx) return;
      const refined = ctx.dropBarFor(props.containerUid);
      if (refined) position.value = refined;
    });
  },
  { flush: "post", immediate: true },
);
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
