<script lang="ts">
import { ref } from "vue";

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

/** Every few words the line says what is really happening instead. */
const REAL_EVERY = 3;

/* ── One ticker for every line ─────────────────────────────────────────
   The top bar and the page often show a line for the same job. They share
   one word, one step, one mark and one start, so they never read
   "Sketching…" beside "Doodling…" with two different drawings. The first
   line to mount starts the ticker; the last to leave stops it, so the next
   job gets a fresh word and mark. */
const shared = {
  word: ref(pickWord("")),
  step: ref(0),
  mark: ref<AiWorkingVariant>("typing"),
  startedAt: 0,
  lines: 0,
  timer: null as ReturnType<typeof setInterval> | null,
};

function join(): void {
  if (shared.lines++ === 0) {
    shared.word.value = pickWord("");
    shared.step.value = 0;
    shared.mark.value = pickVariant();
    shared.startedAt = Date.now();
    shared.timer = setInterval(() => {
      shared.step.value += 1;
      if (shared.step.value % REAL_EVERY !== 0) shared.word.value = pickWord(shared.word.value);
    }, WORD_EVERY_MS);
  }
}

function leave(): void {
  if (--shared.lines > 0) return;
  if (shared.timer) clearInterval(shared.timer);
  shared.timer = null;
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
 * The kit's WorkingLine draws it; this component only decides what it says.
 * Most words are playful ("Shuffling…"); every third one, and right away
 * whenever it changes, is what is really happening ("Reading the prompt…",
 * "Thinking…", "Writing · 420 tokens…", or the chat's own status). The full
 * status is also the line's accessible name.
 *
 * The mark is one of four drawings of the logo's sparkles, picked once per
 * job and shared by every line showing at the time, like the word and the
 * time (`shared`; a line's own `variant` prop still wins): typing stars (three hop in turn), shuffle (the small
 * stars swap places round the big one), orbit (the logo's four nodes circle
 * the stars) or burst (the small stars fly out of the big one and back).
 * Its tempo follows the phase: slow while the model reads the prompt,
 * quicker while it thinks, quickest while it writes. The whole status is the
 * line's accessible name and tooltip.
 *
 * Without `text` it shows the newest AI request in flight
 * (`api/ai-progress.ts`), polling the server for its phase. The chat passes
 * its own `text` and `phase` from its stream.
 */
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import WorkingLine from "@/kit/WorkingLine.vue";
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

join();
const mark = computed(() => props.variant ?? shared.mark.value);

const progress = ref<AiProgress | null>(null);
const elapsed = ref(0);
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
    case "thinking":
      parts.push(p && p.tokens > 0 ? `thinking, about ${p.tokens.toLocaleString()} tokens` : "thinking");
      break;
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
  if (props.text !== undefined) return props.text.replace(/(…|\.+)\s*$/, "").trim() || "Working";
  const p = progress.value;
  switch (shownPhase.value) {
    case "reading": return "Reading the prompt";
    case "thinking": return p && p.tokens > 0 ? `Thinking · ${p.tokens.toLocaleString()} tokens` : "Thinking";
    case "writing": return p && p.tokens > 0 ? `Writing · ${p.tokens.toLocaleString()} tokens` : "Writing";
    default: return props.label || "Waiting for the model";
  }
});

const word = shared.word;
const step = shared.step;
const showReal = computed(() => step.value % REAL_EVERY === 0);
const shown = computed(() => (showReal.value ? real.value : word.value));
/** What the word transition keys on: a new status animates in, a token
 *  count ticking up while writing doesn't (nor does a number in the chat's
 *  own status). */
const wordKey = computed(() => {
  if (!showReal.value) return `w:${word.value}`;
  return props.text !== undefined ? `r:${real.value.replace(/\d[\d,.]*/g, "#")}` : `r:${shownPhase.value}`;
});

// A new phase (or chat status) is said straight away, on every line.
watch(() => [shownPhase.value, props.text], () => { step.value = 0; });

onMounted(() => {
  const count = (): void => { elapsed.value = Math.floor((Date.now() - shared.startedAt) / 1000); };
  count();
  tick = setInterval(count, 1000);
  if (watching.value) {
    void read();
    poll = setInterval(() => { void read(); }, 800);
  }
});
onBeforeUnmount(() => {
  if (poll) clearInterval(poll);
  if (tick) clearInterval(tick);
  leave();
});

const time = computed(() => formatElapsed(elapsed.value));
const slow = computed(() => watching.value && elapsed.value >= 15
  && (shownPhase.value === "starting" || shownPhase.value === "reading"));
const title = computed(() => (slow.value
  ? `${detail.value}. Local models can take a minute to read a long prompt.` : detail.value));
const tempo = computed<"slow" | "mid" | "fast">(() => (shownPhase.value === "writing" ? "fast"
  : shownPhase.value === "thinking" ? "mid" : "slow"));
</script>

<template>
  <WorkingLine
    :word="shown"
    :word-key="wordKey"
    :time="time"
    :variant="mark"
    :tempo="tempo"
    :size="size"
    :inline="inline"
    :label="title"
    data-test="ai-working"
  />
</template>
