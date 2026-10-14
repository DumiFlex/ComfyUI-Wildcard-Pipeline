<script lang="ts">
/** The words the line cycles through, Claude Code style. */
export const WORKING_WORDS = [
  "Shuffling", "Rolling the dice", "Drawing wildcards", "Weaving", "Mixing", "Conjuring",
  "Sketching", "Brewing", "Tinkering", "Pondering", "Composing", "Untangling", "Stacking cards",
  "Whisking", "Scheming", "Noodling", "Percolating", "Doodling", "Daydreaming", "Riffling",
  "Spinning", "Sorting", "Juggling", "Musing", "Assembling", "Simmering",
];
const WORD_EVERY_MS = 3500;

function pickWord(not: string): string {
  const pool = WORKING_WORDS.filter((w) => w !== not);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** "42s", "3m 05s", "1h 02m". */
export function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
</script>

<script setup lang="ts">
/**
 * The "the model is working" line: our logo, animated, with what the model
 * is doing and for how long.
 *
 * The animation: a light runs round the logo's two rings (clipped to their
 * shape, so it dips into the gaps like a signal along a wire), each node
 * lights as it passes, and the three sparkles are drawn one after another
 * like wildcards picked. Its tempo follows the phase: slow while the model
 * reads the prompt, quicker while it thinks, quickest while it writes.
 *
 * The line reads like Claude Code's: a playful word that changes every few
 * seconds ("Shuffling…") and the time so far, then what the model is
 * actually doing under it (reading the prompt, thinking, writing).
 *
 * Without `text` it shows the newest AI request in flight
 * (`api/ai-progress.ts`), polling the server for its phase. The chat passes
 * its own `text` and `phase` from its stream.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { activeAiRequests, fetchAiProgress, type AiPhase, type AiProgress } from "../../api/ai-progress";

const props = withDefaults(defineProps<{
  /** What is being done ("Planning", "Asking qwen3"). */
  label?: string;
  /** A finished line, instead of reading the request's progress. */
  text?: string;
  phase?: AiPhase;
  size?: number;
  /** One line, for the top bar. */
  inline?: boolean;
}>(), { label: "", text: undefined, phase: undefined, size: 28, inline: false });

const uid = `wp-aiw-${Math.random().toString(36).slice(2, 9)}`;

const progress = ref<AiProgress | null>(null);
const elapsed = ref(0);
const started = Date.now();
let poll: ReturnType<typeof setInterval> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;

const watching = computed(() => props.text === undefined);
const requestId = computed(() => {
  const list = activeAiRequests.value;
  return list.length ? list[list.length - 1].id : null;
});

async function read(): Promise<void> {
  const id = requestId.value;
  if (!watching.value || !id) return;
  const got = await fetchAiProgress(id);
  if (got && id === requestId.value) progress.value = got;
}

watch(requestId, () => { progress.value = null; void read(); });

const word = ref(pickWord(""));
let wordTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  tick = setInterval(() => { elapsed.value = Math.floor((Date.now() - started) / 1000); }, 1000);
  wordTimer = setInterval(() => { word.value = pickWord(word.value); }, WORD_EVERY_MS);
  if (watching.value) {
    void read();
    poll = setInterval(() => { void read(); }, 800);
  }
});
onBeforeUnmount(() => {
  if (poll) clearInterval(poll);
  if (tick) clearInterval(tick);
  if (wordTimer) clearInterval(wordTimer);
});

const shownPhase = computed<AiPhase>(() => props.phase ?? progress.value?.phase ?? "starting");

const detail = computed(() => {
  const p = progress.value;
  const parts: string[] = [];
  if (p && p.calls > 1) parts.push(`request ${p.calls}`);
  switch (shownPhase.value) {
    case "reading": parts.push("reading the prompt"); break;
    case "thinking": parts.push("thinking"); break;
    case "writing":
      parts.push(p && p.tokens > 0 ? `writing, about ${p.tokens.toLocaleString()} tokens` : "writing");
      break;
    default: parts.push("waiting for an answer");
  }
  return parts.join(", ");
});

const time = computed(() => formatElapsed(elapsed.value));
const sub = computed(() => {
  if (props.text !== undefined) return props.text;
  return props.label ? `${props.label}: ${detail.value}` : detail.value;
});
const slow = computed(() => watching.value && elapsed.value >= 15
  && (shownPhase.value === "starting" || shownPhase.value === "reading"));
const tempo = computed(() => (shownPhase.value === "writing" ? "fast"
  : shownPhase.value === "thinking" ? "mid" : "slow"));

const RING_A = "m512,2c-53.6,0-98.47,38.16-108.84,88.73-75.07,19.29-143.32,58.26-198.74,113.68-55.42,55.42-94.39,123.68-113.68,198.74-50.58,10.38-88.73,55.24-88.73,108.84s38.16,98.47,88.73,108.84c13.62,53.14,37.03,102.64,69.77,147.47,37.14,50.86,85.83,93.86,140.81,124.33,5.54,3.08,11.56,4.54,17.48,4.54,12.7,0,25.02-6.72,31.61-18.61,9.68-17.44,3.38-39.42-14.07-49.09-85.32-47.32-147.22-125.71-173.38-218.21,36.3-18.29,61.27-55.92,61.27-99.28s-24.94-80.97-61.23-99.27c34.22-119.96,129.79-215.52,249.74-249.74,18.3,36.29,55.92,61.23,99.27,61.23,61.27,0,111.11-49.84,111.11-111.11S573.27,2,512,2ZM113.11,473.11c21.44,0,38.89,17.44,38.89,38.89,0,20.1-15.32,36.69-34.91,38.69h-.01c-.18.02-.36.03-.53.04-1.13.1-2.28.16-3.43.16-21.44,0-38.89-17.44-38.89-38.89s17.44-38.89,38.89-38.89Zm398.89-321.11c-21.44,0-38.89-17.44-38.89-38.89s17.44-38.89,38.89-38.89,38.89,17.44,38.89,38.89-17.44,38.89-38.89,38.89Z";
const RING_B = "m933.27,403.16c-13.62-53.14-37.03-102.64-69.77-147.47-37.14-50.86-85.83-93.86-140.81-124.33-17.44-9.68-39.42-3.38-49.09,14.07-9.68,17.44-3.38,39.42,14.07,49.09,85.32,47.32,147.22,125.71,173.38,218.21-36.3,18.29-61.27,55.92-61.27,99.28s24.94,80.97,61.23,99.27c-34.22,119.96-129.79,215.52-249.74,249.74-18.3-36.29-55.92-61.23-99.27-61.23-61.27,0-111.11,49.84-111.11,111.11s49.84,111.11,111.11,111.11c53.6,0,98.47-38.16,108.84-88.73,75.07-19.29,143.32-58.26,198.74-113.68,55.42-55.42,94.39-123.68,113.68-198.74,50.58-10.38,88.73-55.24,88.73-108.84s-38.16-98.47-88.73-108.84Zm-421.27,546.62c-21.44,0-38.89-17.44-38.89-38.89s17.44-38.89,38.89-38.89,38.89,17.44,38.89,38.89-17.44,38.89-38.89,38.89Zm398.89-398.89c-21.44,0-38.89-17.44-38.89-38.89,0-20.03,15.22-36.58,34.72-38.67.38-.04.77-.08,1.16-.11h.02c.99-.08,1.99-.11,2.99-.11,21.44,0,38.89,17.44,38.89,38.89s-17.44,38.89-38.89,38.89Z";
const STAR_BIG = "m735.02,517.56c-153.82,30.87-186.59,63.64-217.46,217.46-1.22,6.08-9.9,6.08-11.12,0-30.87-153.82-63.64-186.59-217.46-217.46-6.08-1.22-6.08-9.9,0-11.12,153.82-30.87,186.59-63.64,217.46-217.46,1.22-6.08,9.9-6.08,11.12,0,30.87,153.82,63.64,186.59,217.46,217.46,6.08,1.22,6.08,9.9,0,11.12Z";
const STAR_A = "m434.06,665.85c-51.08,10.25-61.96,21.13-72.22,72.22-.41,2.02-3.29,2.02-3.69,0-10.25-51.08-21.13-61.96-72.22-72.22-2.02-.41-2.02-3.29,0-3.69,51.08-10.25,61.96-21.13,72.22-72.22.41-2.02,3.29-2.02,3.69,0,10.25,51.08,21.13,61.96,72.22,72.22,2.02.41,2.02,3.29,0,3.69Z";
const STAR_B = "m738.07,361.84c-51.08,10.25-61.96,21.13-72.22,72.22-.41,2.02-3.29,2.02-3.69,0-10.25-51.08-21.13-61.96-72.22-72.22-2.02-.41-2.02-3.29,0-3.69,51.08-10.25,61.96-21.13,72.22-72.22.41-2.02,3.29-2.02,3.69,0,10.25,51.08,21.13,61.96,72.22,72.22,2.02.41,2.02,3.29,0,3.69Z";
/** The four nodes in the order the light reaches them (it starts at 3
 *  o'clock and runs clockwise, like an SVG circle's stroke). */
const NODES = [[911, 512], [512, 911], [113, 512], [512, 113]] as const;
</script>

<template>
  <div class="wp-aiw" :data-tempo="tempo" :data-inline="inline ? 'true' : undefined" role="status" :aria-label="sub" data-test="ai-working">
    <svg
      class="wp-aiw__logo"
      viewBox="0 0 1024 1024"
      :width="size"
      :height="size"
      aria-hidden="true"
    >
      <defs>
        <linearGradient :id="`${uid}-a`" x1="312.56" y1="897.19" x2="312.56" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#a970ff" />
          <stop offset="1" stop-color="#6366f1" />
        </linearGradient>
        <linearGradient :id="`${uid}-b`" x1="711.44" y1="126.81" x2="711.44" y2="1022" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#6366f1" />
          <stop offset="1" stop-color="#33d6c6" />
        </linearGradient>
        <clipPath :id="`${uid}-rings`">
          <path :d="RING_A" />
          <path :d="RING_B" />
        </clipPath>
        <mask :id="`${uid}-sweep`" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <circle class="wp-aiw__tail" cx="512" cy="512" r="399" pathLength="1000" />
        </mask>
      </defs>
      <!-- The rings, dim, then lit where the light is. -->
      <g class="wp-aiw__track">
        <path :fill="`url(#${uid}-a)`" :d="RING_A" />
        <path :fill="`url(#${uid}-b)`" :d="RING_B" />
      </g>
      <g :mask="`url(#${uid}-sweep)`">
        <path :fill="`url(#${uid}-a)`" :d="RING_A" />
        <path :fill="`url(#${uid}-b)`" :d="RING_B" />
      </g>
      <g :clip-path="`url(#${uid}-rings)`">
        <circle class="wp-aiw__head" cx="512" cy="512" r="399" pathLength="1000" />
      </g>
      <circle
        v-for="([x, y], i) in NODES"
        :key="i"
        class="wp-aiw__node"
        :style="{ '--wp-aiw-k': i }"
        :cx="x" :cy="y" r="39"
      />
      <path class="wp-aiw__star wp-aiw__star--big" fill="#a970ff" :d="STAR_BIG" />
      <path class="wp-aiw__star wp-aiw__star--a" fill="#6366f1" :d="STAR_A" />
      <path class="wp-aiw__star wp-aiw__star--b" fill="#33d6c6" :d="STAR_B" />
    </svg>
    <span class="wp-aiw__text">
      <span class="wp-aiw__line">
        <Transition name="wp-aiw-word" mode="out-in">
          <span :key="word" class="wp-aiw__word" data-test="ai-working-word">{{ word }}…</span>
        </Transition>
        <span class="wp-aiw__time" data-test="ai-working-time">{{ time }}</span>
      </span>
      <span class="wp-aiw__detail" data-test="ai-working-detail">{{ sub }}</span>
      <span v-if="slow && !inline" class="wp-aiw__hint">Local models can take a minute to read a long prompt.</span>
    </span>
  </div>
</template>

<style scoped>
.wp-aiw {
  --wp-aiw-t: 2.8s;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: var(--wp-text-muted);
  font-size: 12px;
}
.wp-aiw[data-tempo="mid"] { --wp-aiw-t: 2s; }
.wp-aiw[data-tempo="fast"] { --wp-aiw-t: 1.3s; }
.wp-aiw__logo { flex-shrink: 0; overflow: visible; }
.wp-aiw__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.wp-aiw__line { display: flex; align-items: baseline; gap: 8px; }
.wp-aiw__word {
  font-size: 13px; font-weight: 500;
  background: linear-gradient(90deg, #a970ff, #6366f1 45%, #33d6c6);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.wp-aiw__time { font-variant-numeric: tabular-nums; color: var(--wp-text-dim); }
.wp-aiw__detail { overflow-wrap: anywhere; }
.wp-aiw__hint { font-size: 11px; opacity: 0.8; }
.wp-aiw[data-inline="true"] .wp-aiw__text { flex-direction: row; align-items: baseline; gap: 8px; white-space: nowrap; }
.wp-aiw[data-inline="true"] .wp-aiw__detail { overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
.wp-aiw-word-enter-active, .wp-aiw-word-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.wp-aiw-word-enter-from { opacity: 0; transform: translateY(4px); }
.wp-aiw-word-leave-to { opacity: 0; transform: translateY(-4px); }

.wp-aiw__track { opacity: 0.38; }
/* Ring circumference as pathLength 1000: a 330-long tail, the head on its
   front 45. Both run one lap per period. */
.wp-aiw__tail {
  fill: none;
  stroke: #fff;
  stroke-width: 150;
  stroke-linecap: round;
  stroke-dasharray: 330 670;
  animation: wp-aiw-lap var(--wp-aiw-t) linear infinite;
}
.wp-aiw__head {
  fill: none;
  stroke: #fff;
  stroke-width: 150;
  stroke-linecap: round;
  stroke-dasharray: 45 955;
  stroke-dashoffset: -285;
  opacity: 0.5;
  animation: wp-aiw-lap-head var(--wp-aiw-t) linear infinite;
}
@keyframes wp-aiw-lap { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -1000; } }
@keyframes wp-aiw-lap-head { from { stroke-dashoffset: -285; } to { stroke-dashoffset: -1285; } }

/* A node lights as the head passes it: a quarter lap apart. */
.wp-aiw__node {
  fill: #fff;
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
  animation: wp-aiw-node var(--wp-aiw-t) linear infinite;
  animation-delay: calc(var(--wp-aiw-t) * (var(--wp-aiw-k) * 0.25 + 0.3) - var(--wp-aiw-t));
}
@keyframes wp-aiw-node {
  0% { opacity: 0; transform: scale(0.4); }
  6% { opacity: 0.95; transform: scale(1.25); }
  30% { opacity: 0; transform: scale(1); }
  100% { opacity: 0; }
}

/* The sparkles: the big one breathes and turns a quarter (a four-point
   star looks the same after it, so it reads as a glint); the small ones
   are drawn one after the other. */
.wp-aiw__star { transform-box: fill-box; transform-origin: center; }
.wp-aiw__star--big { animation: wp-aiw-glint calc(var(--wp-aiw-t) * 2) cubic-bezier(0.6, 0, 0.3, 1) infinite; }
.wp-aiw__star--a { animation: wp-aiw-draw calc(var(--wp-aiw-t) * 2) ease-out infinite; }
.wp-aiw__star--b { animation: wp-aiw-draw calc(var(--wp-aiw-t) * 2) ease-out infinite; animation-delay: calc(var(--wp-aiw-t) * 0.5); }
@keyframes wp-aiw-glint {
  0%, 20% { transform: rotate(0deg) scale(1); }
  45% { transform: rotate(45deg) scale(0.8); }
  70%, 100% { transform: rotate(90deg) scale(1); }
}
@keyframes wp-aiw-draw {
  0% { transform: scale(0) rotate(-90deg); opacity: 0; }
  14% { transform: scale(1.3) rotate(0deg); opacity: 1; }
  24% { transform: scale(1) rotate(0deg); opacity: 1; }
  70% { transform: scale(1) rotate(0deg); opacity: 1; }
  85%, 100% { transform: scale(0) rotate(45deg); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .wp-aiw__tail, .wp-aiw__head, .wp-aiw__node, .wp-aiw__star { animation: none; }
  .wp-aiw__tail { stroke-dasharray: none; }
  .wp-aiw__head, .wp-aiw__node { opacity: 0; }
  .wp-aiw__logo { animation: wp-aiw-fade 2.4s ease-in-out infinite; }
  @keyframes wp-aiw-fade { 50% { opacity: 0.55; } }
}
</style>
