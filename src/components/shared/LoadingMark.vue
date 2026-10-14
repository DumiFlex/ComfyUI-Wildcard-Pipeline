<script lang="ts">
/** Gradient ids must be unique on the page. `useId` restarts per Vue app and
 *  the extension mounts many small apps, so count across all of them. */
let nextId = 0;
</script>

<script setup lang="ts">
/**
 * The loading mark used everywhere outside the AI status line ("Split"): the
 * logo's two rings slide apart and back while the big star dips and turns
 * and the small stars twinkle. It replaces the plain spinner.
 *
 * Alone it is an icon (`size`, default 14 so it sits with text and in
 * buttons). With slot text it becomes a row ("[mark] Loading bundle…"); with
 * `block` it is centred in its box, for a panel or page that is loading.
 */
import { useSlots } from "vue";
import { RING_A, RING_B, STAR_A, STAR_B, STAR_BIG } from "./logo-paths";

withDefaults(defineProps<{
  size?: number;
  /** Accessible name when there is no slot text. */
  label?: string;
  /** Centre it (and its text, below) in the space it is given. */
  block?: boolean;
  /** Hidden from screen readers, for a host that says it is busy itself
   *  (a button with `aria-busy`). */
  decorative?: boolean;
}>(), { size: 14, label: "Loading", block: false, decorative: false });

const slots = useSlots();
const id = `wp-lm-${nextId++}`;
</script>

<template>
  <span
    class="wp-lm"
    :class="{ 'wp-lm--block': block }"
    :role="decorative ? undefined : 'status'"
    :aria-label="decorative || slots.default ? undefined : label"
    :aria-hidden="decorative || undefined"
    data-test="loading-mark"
  >
    <svg class="wp-lm__svg" viewBox="0 0 1024 1024" :width="size" :height="size" aria-hidden="true">
      <defs>
        <linearGradient :id="`${id}a`" x1="312.56" y1="897.19" x2="312.56" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#a970ff" />
          <stop offset="1" stop-color="#6366f1" />
        </linearGradient>
        <linearGradient :id="`${id}b`" x1="711.44" y1="126.81" x2="711.44" y2="1022" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#6366f1" />
          <stop offset="1" stop-color="#33d6c6" />
        </linearGradient>
      </defs>
      <path class="wp-lm__ring wp-lm__ring--a" :fill="`url(#${id}a)`" :d="RING_A" />
      <path class="wp-lm__ring wp-lm__ring--b" :fill="`url(#${id}b)`" :d="RING_B" />
      <path class="wp-lm__star wp-lm__star--big" fill="#a970ff" :d="STAR_BIG" />
      <path class="wp-lm__star wp-lm__star--tw" fill="#6366f1" :d="STAR_A" />
      <path class="wp-lm__star wp-lm__star--tw" fill="#33d6c6" :d="STAR_B" />
    </svg>
    <span v-if="slots.default" class="wp-lm__text"><slot /></span>
  </span>
</template>

<style scoped>
.wp-lm {
  --wp-lm-t: 2.4s;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  vertical-align: middle;
}
.wp-lm--block {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  width: 100%;
  padding: 48px 16px;
  color: var(--wp-text-muted);
  text-align: center;
}
.wp-lm__svg { flex-shrink: 0; overflow: visible; }
.wp-lm__ring { transform-box: view-box; transform-origin: 512px 512px; }
.wp-lm__star { transform-box: fill-box; transform-origin: center; }
.wp-lm__ring--a { animation: wp-lm-split-a var(--wp-lm-t) cubic-bezier(0.65, 0, 0.35, 1) infinite; }
.wp-lm__ring--b { animation: wp-lm-split-b var(--wp-lm-t) cubic-bezier(0.65, 0, 0.35, 1) infinite; }
.wp-lm__star--big { animation: wp-lm-dip var(--wp-lm-t) cubic-bezier(0.65, 0, 0.35, 1) infinite; }
.wp-lm__star--tw { animation: wp-lm-twinkle var(--wp-lm-t) ease-in-out infinite; }

@keyframes wp-lm-split-a {
  0%, 15%, 85%, 100% { transform: translate(0, 0); }
  40%, 60% { transform: translate(-70px, -70px); }
}
@keyframes wp-lm-split-b {
  0%, 15%, 85%, 100% { transform: translate(0, 0); }
  40%, 60% { transform: translate(70px, 70px); }
}
@keyframes wp-lm-dip {
  0%, 15% { transform: scale(1) rotate(0deg); }
  32% { transform: scale(0.7) rotate(45deg); }
  50%, 100% { transform: scale(1) rotate(90deg); }
}
@keyframes wp-lm-twinkle {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.6); }
}

@media (prefers-reduced-motion: reduce) {
  .wp-lm__svg * { animation: none !important; }
  .wp-lm__svg { animation: wp-lm-fade 2.4s ease-in-out infinite; }
  @keyframes wp-lm-fade { 50% { opacity: 0.55; } }
}
</style>
