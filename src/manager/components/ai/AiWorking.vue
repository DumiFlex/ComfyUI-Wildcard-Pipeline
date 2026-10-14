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

export type AiWorkingVariant = "shuffle" | "orbit" | "burst" | "typing";
/** Which drawing a line gets, picked once per line: the typing stars most
 *  often, the other three now and then. */
export const VARIANT_ODDS: [AiWorkingVariant, number][] = [
  ["typing", 0.4], ["shuffle", 0.2], ["orbit", 0.2], ["burst", 0.2],
];
export function pickVariant(r = Math.random()): AiWorkingVariant {
  let acc = 0;
  for (const [v, odds] of VARIANT_ODDS) {
    acc += odds;
    if (r < acc) return v;
  }
  return "typing";
}

/** Every few words the line says what is really happening instead. */
const REAL_EVERY = 3;

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
 * The "the model is working" line, one line like Claude Code's: a small
 * animated mark, a word that changes every few seconds and the time so far.
 * Most words are playful ("Shuffling…"); every third one, and right away
 * whenever it changes, is what is really happening ("Reading the prompt…",
 * "Thinking…", "Writing · 420 tokens…", or the chat's own status). The full
 * status is also the line's accessible name.
 *
 * The mark is one of four drawings of the logo's sparkles, picked per line
 * (`pickVariant`): typing stars (three hop in turn), shuffle (the small
 * stars swap places round the big one), orbit (the logo's four nodes circle
 * the stars) or burst (the small stars fly out of the big one and back).
 * Its tempo follows the phase: slow while the model reads the prompt,
 * quicker while it thinks, quickest while it writes.
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
  /** What is happening, instead of reading the request's progress. */
  text?: string;
  phase?: AiPhase;
  size?: number;
  /** Fewer words, for the top bar. */
  inline?: boolean;
  /** A fixed drawing instead of a random one. */
  variant?: AiWorkingVariant;
}>(), { label: "", text: undefined, phase: undefined, size: 22, inline: false, variant: undefined });

const mark = props.variant ?? pickVariant();

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

const shownPhase = computed<AiPhase>(() => props.phase ?? progress.value?.phase ?? "starting");

/** The whole status, for screen readers and the tooltip. */
const detail = computed(() => {
  if (props.text !== undefined) return props.text;
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
  const s = parts.join(", ");
  return props.label ? `${props.label}: ${s}` : s;
});

/** What is really happening, in a few words. */
const real = computed(() => {
  if (props.text !== undefined) return props.text.replace(/(…|\.\.\.)\s*$/, "").trim() || "Working";
  const p = progress.value;
  switch (shownPhase.value) {
    case "reading": return "Reading the prompt";
    case "thinking": return "Thinking";
    case "writing": return p && p.tokens > 0 ? `Writing · ${p.tokens.toLocaleString()} tokens` : "Writing";
    default: return props.label || "Waiting for the model";
  }
});

const word = ref(pickWord(""));
const step = ref(0);
const showReal = computed(() => step.value % REAL_EVERY === 0);
const shown = computed(() => (showReal.value ? real.value : word.value));
/** What the word transition keys on: a new status animates in, a token
 *  count ticking up while writing doesn't. */
const wordKey = computed(() => {
  if (!showReal.value) return `w:${word.value}`;
  return props.text !== undefined ? `r:${real.value}` : `r:${shownPhase.value}`;
});
let wordTimer: ReturnType<typeof setInterval> | null = null;

// A new phase (or chat status) is said straight away.
watch(() => [shownPhase.value, props.text], () => { step.value = 0; });

onMounted(() => {
  tick = setInterval(() => { elapsed.value = Math.floor((Date.now() - started) / 1000); }, 1000);
  wordTimer = setInterval(() => {
    step.value += 1;
    if (!showReal.value) word.value = pickWord(word.value);
  }, WORD_EVERY_MS);
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

const time = computed(() => formatElapsed(elapsed.value));
const slow = computed(() => watching.value && elapsed.value >= 15
  && (shownPhase.value === "starting" || shownPhase.value === "reading"));
const title = computed(() => (slow.value
  ? `${detail.value}. Local models can take a minute to read a long prompt.` : detail.value));
const tempo = computed(() => (shownPhase.value === "writing" ? "fast"
  : shownPhase.value === "thinking" ? "mid" : "slow"));

const STAR_BIG = "m735.02,517.56c-153.82,30.87-186.59,63.64-217.46,217.46-1.22,6.08-9.9,6.08-11.12,0-30.87-153.82-63.64-186.59-217.46-217.46-6.08-1.22-6.08-9.9,0-11.12,153.82-30.87,186.59-63.64,217.46-217.46,1.22-6.08,9.9-6.08,11.12,0,30.87,153.82,63.64,186.59,217.46,217.46,6.08,1.22,6.08,9.9,0,11.12Z";
const STAR_A = "m434.06,665.85c-51.08,10.25-61.96,21.13-72.22,72.22-.41,2.02-3.29,2.02-3.69,0-10.25-51.08-21.13-61.96-72.22-72.22-2.02-.41-2.02-3.29,0-3.69,51.08-10.25,61.96-21.13,72.22-72.22.41-2.02,3.29-2.02,3.69,0,10.25,51.08,21.13,61.96,72.22,72.22,2.02.41,2.02,3.29,0,3.69Z";
const STAR_B = "m738.07,361.84c-51.08,10.25-61.96,21.13-72.22,72.22-.41,2.02-3.29,2.02-3.69,0-10.25-51.08-21.13-61.96-72.22-72.22-2.02-.41-2.02-3.29,0-3.69,51.08-10.25,61.96-21.13,72.22-72.22.41-2.02,3.29-2.02,3.69,0,10.25,51.08,21.13,61.96,72.22,72.22,2.02.41,2.02,3.29,0,3.69Z";
/** The logo's four nodes, for the orbit. */
const NODES = [[911, 512, "#33d6c6"], [512, 911, "#3fb7cf"], [113, 512, "#8b6cf8"], [512, 113, "#6366f1"]] as const;
/** Typing stars: the big sparkle drawn small three times in a row. */
const TYPING = [[250, "#6366f1"], [512, "#a970ff"], [774, "#33d6c6"]] as const;
</script>

<template>
  <div
    class="wp-aiw"
    :data-tempo="tempo"
    :data-variant="mark"
    :data-inline="inline ? 'true' : undefined"
    role="status"
    :aria-label="title"
    :title="title"
    data-test="ai-working"
  >
    <svg class="wp-aiw__logo" viewBox="0 0 1024 1024" :width="size" :height="size" aria-hidden="true">
      <template v-if="mark === 'typing'">
        <g v-for="([x, c], i) in TYPING" :key="i" class="wp-aiw__hop" :style="{ '--wp-aiw-k': i }">
          <path class="wp-aiw__star" :fill="c" :transform="`translate(${x - 256} 304) scale(.5)`" :d="STAR_BIG" />
        </g>
      </template>
      <g v-else-if="mark === 'shuffle'" transform="translate(512 512) scale(1.45) translate(-512 -512)">
        <path class="wp-aiw__star wp-aiw__star--big wp-aiw__dip" fill="#a970ff" :d="STAR_BIG" />
        <g class="wp-aiw__vb wp-aiw__swap">
          <path class="wp-aiw__star" fill="#6366f1" :d="STAR_A" />
          <path class="wp-aiw__star" fill="#33d6c6" :d="STAR_B" />
        </g>
      </g>
      <template v-else-if="mark === 'orbit'">
        <g class="wp-aiw__vb wp-aiw__spin">
          <circle
            v-for="([x, y, c], i) in NODES" :key="i" class="wp-aiw__dot"
            :style="{ '--wp-aiw-k': i }" :cx="x" :cy="y" r="70" :fill="c"
          />
        </g>
        <path class="wp-aiw__star wp-aiw__star--big wp-aiw__breathe" fill="#a970ff" :d="STAR_BIG" />
        <path class="wp-aiw__star" fill="#6366f1" :d="STAR_A" />
        <path class="wp-aiw__star" fill="#33d6c6" :d="STAR_B" />
      </template>
      <g v-else transform="translate(512 512) scale(1.3) translate(-512 -512)">
        <path class="wp-aiw__star wp-aiw__star--big wp-aiw__pop" fill="#a970ff" :d="STAR_BIG" />
        <path class="wp-aiw__star wp-aiw__burst" style="--wp-aiw-dx: 152px; --wp-aiw-dy: -152px" fill="#6366f1" :d="STAR_A" />
        <path class="wp-aiw__star wp-aiw__burst" style="--wp-aiw-dx: -152px; --wp-aiw-dy: 152px" fill="#33d6c6" :d="STAR_B" />
      </g>
    </svg>
    <Transition name="wp-aiw-word" mode="out-in">
      <span :key="wordKey" class="wp-aiw__word" data-test="ai-working-word">{{ shown }}…</span>
    </Transition>
    <span class="wp-aiw__time" data-test="ai-working-time">{{ time }}</span>
    <span class="wp-aiw__sr" data-test="ai-working-detail">{{ detail }}</span>
  </div>
</template>

<style scoped>
.wp-aiw {
  --wp-aiw-t: 2.8s;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--wp-text-muted);
  font-size: 13px;
  white-space: nowrap;
}
.wp-aiw[data-tempo="mid"] { --wp-aiw-t: 2.2s; }
.wp-aiw[data-tempo="fast"] { --wp-aiw-t: 1.5s; }
.wp-aiw__logo { flex-shrink: 0; overflow: visible; }
.wp-aiw__word {
  display: inline-block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  background: linear-gradient(90deg, #a970ff, #6366f1 45%, #33d6c6);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.wp-aiw__time { flex-shrink: 0; font-variant-numeric: tabular-nums; color: var(--wp-text-dim); }
.wp-aiw[data-inline="true"] { font-size: 12px; }
.wp-aiw[data-inline="true"] .wp-aiw__word { max-width: 240px; }
.wp-aiw__sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.wp-aiw-word-enter-active { transition: opacity 0.32s ease-out, transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1), filter 0.32s ease-out; }
.wp-aiw-word-leave-active { transition: opacity 0.18s ease-in, transform 0.18s ease-in, filter 0.18s ease-in; }
.wp-aiw-word-enter-from { opacity: 0; transform: translateY(7px); filter: blur(3px); }
.wp-aiw-word-leave-to { opacity: 0; transform: translateY(-7px); filter: blur(3px); }
@media (prefers-reduced-motion: reduce) {
  .wp-aiw-word-enter-active, .wp-aiw-word-leave-active { transition: opacity 0.2s; }
  .wp-aiw-word-enter-from, .wp-aiw-word-leave-to { transform: none; filter: none; }
}

.wp-aiw__star, .wp-aiw__dot, .wp-aiw__hop { transform-box: fill-box; transform-origin: center; }
.wp-aiw__vb { transform-box: view-box; transform-origin: 512px 512px; }

/* Typing stars: each hops in turn. */
.wp-aiw__hop {
  animation: wp-aiw-hop var(--wp-aiw-t) ease-in-out infinite;
  animation-delay: calc(var(--wp-aiw-t) * var(--wp-aiw-k) * 0.15);
}
@keyframes wp-aiw-hop {
  0%, 40%, 100% { transform: translateY(0) scale(1); }
  20% { transform: translateY(-110px) scale(1.12); }
}

/* Shuffle: the small stars swap places, the big one dips and turns. */
.wp-aiw__swap { animation: wp-aiw-swap calc(var(--wp-aiw-t) * 2) cubic-bezier(0.65, 0, 0.35, 1) infinite; }
.wp-aiw__dip { animation: wp-aiw-dip var(--wp-aiw-t) cubic-bezier(0.65, 0, 0.35, 1) infinite; }
@keyframes wp-aiw-swap {
  0%, 15% { transform: rotate(0deg); }
  50%, 65% { transform: rotate(180deg); }
  100% { transform: rotate(360deg); }
}
@keyframes wp-aiw-dip {
  0%, 15% { transform: scale(1) rotate(0deg); }
  32% { transform: scale(0.7) rotate(45deg); }
  50%, 100% { transform: scale(1) rotate(90deg); }
}

/* Orbit: the four nodes circle the stars and twinkle in turn. */
.wp-aiw__spin { animation: wp-aiw-spin calc(var(--wp-aiw-t) * 2) cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite; }
.wp-aiw__dot {
  animation: wp-aiw-twinkle var(--wp-aiw-t) ease-in-out infinite;
  animation-delay: calc(var(--wp-aiw-t) * var(--wp-aiw-k) * -0.25);
}
.wp-aiw__breathe { animation: wp-aiw-breathe var(--wp-aiw-t) ease-in-out infinite; }
@keyframes wp-aiw-spin { to { transform: rotate(360deg); } }
@keyframes wp-aiw-twinkle {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.6); }
}
@keyframes wp-aiw-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.86); } }

/* Burst: the small stars fly out of the big one and back. */
.wp-aiw__burst { animation: wp-aiw-burst var(--wp-aiw-t) cubic-bezier(0.3, 0, 0.2, 1) infinite; }
.wp-aiw__pop { animation: wp-aiw-pop var(--wp-aiw-t) ease-in-out infinite; }
@keyframes wp-aiw-burst {
  0% { transform: translate(var(--wp-aiw-dx), var(--wp-aiw-dy)) scale(0); opacity: 0; }
  15% { opacity: 1; }
  45%, 75% { transform: translate(0, 0) scale(1.15); opacity: 1; }
  100% { transform: translate(var(--wp-aiw-dx), var(--wp-aiw-dy)) scale(0); opacity: 0; }
}
@keyframes wp-aiw-pop { 0%, 100% { transform: scale(1.1); } 40% { transform: scale(0.8); } }

@media (prefers-reduced-motion: reduce) {
  .wp-aiw__logo * { animation: none !important; }
  .wp-aiw__logo { animation: wp-aiw-fade 2.4s ease-in-out infinite; }
  @keyframes wp-aiw-fade { 50% { opacity: 0.55; } }
}
</style>
