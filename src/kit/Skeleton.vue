<script setup lang="ts">
/**
 * Skeleton: the grey shape of content that is still loading, so the layout
 * doesn't jump when it lands. Use it where the shape is known (a list of
 * rows, a card, a line of text); a whole page or panel that is loading uses
 * `LoadingMark block` instead. Works on the canvas and in the manager.
 *
 *   <Skeleton shape="row" :lines="4" label="Loading modules" />
 *   <Skeleton shape="line" :lines="3" />
 *   <Skeleton shape="block" height="120px" />
 *
 * The shapes are hidden from screen readers; `label` adds one polite
 * "Loading…" line for them instead. The sweep stops under reduced motion.
 */
import { computed } from "vue";

const props = withDefaults(defineProps<{
  /** line: text lines (the last one shorter). block: a box. circle: an avatar or icon. row: an icon, a title and a hint line, like a list row. */
  shape?: "line" | "block" | "circle" | "row" | undefined;
  /** How many lines or rows. */
  lines?: number | undefined;
  /** CSS width of a line, block or circle. */
  width?: string | undefined;
  /** CSS height of a block or circle. */
  height?: string | undefined;
  /** Say "Loading…" to screen readers with this text. */
  label?: string | undefined;
}>(), { shape: "line", lines: 1, width: undefined, height: undefined, label: undefined });

const count = computed(() => Math.max(1, Math.floor(props.lines)));
/** The last of several lines is shorter, like the end of a paragraph. */
const lineWidth = (i: number): string | undefined =>
  props.width ?? (count.value > 1 && i === count.value - 1 ? "60%" : undefined);
</script>

<template>
  <div class="wp-skeleton" :data-shape="shape" :role="label ? 'status' : undefined">
    <span v-if="label" class="wp-skeleton__sr">{{ label }}…</span>
    <template v-if="shape === 'line'">
      <span v-for="i in count" :key="i" class="wp-skeleton__bone wp-skeleton__line" :style="{ width: lineWidth(i - 1) }" aria-hidden="true" />
    </template>
    <span v-else-if="shape === 'block'" class="wp-skeleton__bone wp-skeleton__block" :style="{ width, height }" aria-hidden="true" />
    <span v-else-if="shape === 'circle'" class="wp-skeleton__bone wp-skeleton__circle" :style="{ width: width ?? height, height: height ?? width }" aria-hidden="true" />
    <template v-else>
      <span v-for="i in count" :key="i" class="wp-skeleton__row" aria-hidden="true">
        <span class="wp-skeleton__bone wp-skeleton__circle" />
        <span class="wp-skeleton__row-text">
          <span class="wp-skeleton__bone wp-skeleton__line" :style="{ width: i % 2 ? '55%' : '42%' }" />
          <span class="wp-skeleton__bone wp-skeleton__line wp-skeleton__line--hint" :style="{ width: i % 2 ? '80%' : '68%' }" />
        </span>
      </span>
    </template>
  </div>
</template>

<style scoped>
.wp-skeleton { display: flex; flex-direction: column; gap: var(--wp-space-3); min-width: 0; width: 100%; }
.wp-skeleton[data-shape="circle"], .wp-skeleton[data-shape="block"] { width: auto; }
.wp-skeleton__bone {
  position: relative; display: block; overflow: hidden;
  border-radius: var(--wp-radius-sm); background: var(--wp-bg-3);
}
.wp-skeleton__bone::after {
  content: ""; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--wp-text) 8%, transparent), transparent);
  animation: wp-skeleton-sweep var(--wp-motion-shimmer) ease-in-out infinite;
}
.wp-skeleton__line { width: 100%; height: 0.75em; }
.wp-skeleton__line--hint { height: 0.6em; opacity: 0.7; }
.wp-skeleton__block { width: 100%; height: 64px; border-radius: var(--wp-radius); }
.wp-skeleton__circle { flex: none; width: 28px; height: 28px; border-radius: 50%; /* round: stands in for an avatar */ }
.wp-skeleton__row { display: flex; align-items: center; gap: var(--wp-space-4); padding: var(--wp-space-2) 0; }
.wp-skeleton__row-text { display: flex; flex-direction: column; gap: var(--wp-space-2); flex: 1; min-width: 0; }
.wp-skeleton__sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
@keyframes wp-skeleton-sweep { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) {
  .wp-skeleton__bone::after { animation: none; display: none; }
}
</style>
