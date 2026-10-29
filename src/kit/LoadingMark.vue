<script lang="ts">
/** Gradient ids must be unique on the page. `useId` restarts per Vue app and
 *  the extension mounts many small apps, so count across all of them. */
let nextId = 0;
</script>

<script setup lang="ts">
/**
 * The loading mark. Two drawings, one per kind of place:
 *
 * - `logo` (pages and panels): the full logo. Its two rings slide apart and
 *   back while the big star dips and turns and the small stars twinkle. A
 *   `block` mark, or one 24 px or bigger, gets it by default.
 * - `sparkle` (tight inline spots: a text row, a button, a list item): the
 *   logo's three stars without the rings, the big one dipping while the small
 *   ones swap places, like the AI working line. Small marks get it by
 *   default, so an inline "Loading bundle…" is not a big colourful logo.
 *
 * Alone it is an icon (`size`, 14 inline and 40 as a block). With slot text it
 * becomes a row ("[mark] Loading bundle…"); with `block` it is centred in its
 * box, for a panel or page that is loading. `mono` draws it in the text
 * colour, for a host with its own colours (a busy button).
 */
import { computed, useSlots } from "vue";
import { RING_A, RING_B, STAR_A, STAR_B, STAR_BIG } from "./logo-paths";

const props = withDefaults(defineProps<{
  /** Width and height in px. Default 14, or 40 with `block`. */
  size?: number | undefined;
  /** Accessible name when there is no slot text. */
  label?: string | undefined;
  /** Centre it (and its text, below) in the space it is given. */
  block?: boolean | undefined;
  /** Which drawing; default `logo` for a block or a 24 px+ mark, else `sparkle`. */
  variant?: "logo" | "sparkle" | undefined;
  /** Draw in the current text colour instead of the logo colours. */
  mono?: boolean | undefined;
  /** Hidden from screen readers, for a host that says it is busy itself
   *  (a button with `aria-busy`). */
  decorative?: boolean | undefined;
}>(), { size: undefined, label: "Loading", block: false, variant: undefined, mono: false, decorative: false });

const slots = useSlots();
const id = `wp-lm-${nextId++}`;
const px = computed(() => props.size ?? (props.block ? 40 : 14));
const drawing = computed(() => props.variant ?? (props.block || px.value >= 24 ? "logo" : "sparkle"));
/** The logo's own colours (brand, not theme tokens: the mark looks the same
 *  in light and dark). */
const VIOLET = "#a970ff";
const INDIGO = "#6366f1";
const TEAL = "#33d6c6";
const fill = (colour: string): string => (props.mono ? "currentColor" : colour);
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
    <svg
      class="wp-lm__svg"
      :data-variant="drawing"
      viewBox="0 0 1024 1024"
      :width="px"
      :height="px"
      aria-hidden="true"
    >
      <template v-if="drawing === 'logo'">
        <defs v-if="!mono">
          <linearGradient :id="`${id}a`" x1="312.56" y1="897.19" x2="312.56" y2="2" gradientUnits="userSpaceOnUse">
            <stop offset="0" :stop-color="VIOLET" />
            <stop offset="1" :stop-color="INDIGO" />
          </linearGradient>
          <linearGradient :id="`${id}b`" x1="711.44" y1="126.81" x2="711.44" y2="1022" gradientUnits="userSpaceOnUse">
            <stop offset="0" :stop-color="INDIGO" />
            <stop offset="1" :stop-color="TEAL" />
          </linearGradient>
        </defs>
        <path class="wp-lm__ring wp-lm__ring--a" :fill="fill(`url(#${id}a)`)" :d="RING_A" />
        <path class="wp-lm__ring wp-lm__ring--b" :fill="fill(`url(#${id}b)`)" :d="RING_B" />
        <path class="wp-lm__star wp-lm__star--big" :fill="fill(VIOLET)" :d="STAR_BIG" />
        <path class="wp-lm__star wp-lm__star--tw" :fill="fill(INDIGO)" :d="STAR_A" />
        <path class="wp-lm__star wp-lm__star--tw" :fill="fill(TEAL)" :d="STAR_B" />
      </template>
      <g v-else transform="translate(512 512) scale(1.45) translate(-512 -512)">
        <path class="wp-lm__star wp-lm__star--big" :fill="fill(VIOLET)" :d="STAR_BIG" />
        <g class="wp-lm__swap">
          <path class="wp-lm__star" :fill="fill(INDIGO)" :d="STAR_A" />
          <path class="wp-lm__star" :fill="fill(TEAL)" :d="STAR_B" />
        </g>
      </g>
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
.wp-lm__swap {
  transform-box: view-box; transform-origin: 512px 512px;
  animation: wp-lm-swap calc(var(--wp-lm-t) * 2) cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

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
@keyframes wp-lm-swap {
  0%, 15% { transform: rotate(0deg); }
  50%, 65% { transform: rotate(180deg); }
  100% { transform: rotate(360deg); }
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
