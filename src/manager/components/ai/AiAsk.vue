<script setup lang="ts">
/**
 * AiAsk — the questions the chat model asked (`ask`), inline under its
 * answer: each question with its answers as chips (one pick, or several
 * when `multi`), "Other…" for the user's own words and "Decide for me".
 * One single-choice question sends on click; otherwise "Send answers"
 * sends, and questions left open are the model's to decide. Number keys
 * pick in the focused question, Enter sends. Once answered it folds to one
 * line ("Style: Anime · Negatives: you decide").
 *
 * Only question and choice numbers go back (`AiAskAnswer`); the server
 * reads the labels from the call it stored.
 */
import { computed, nextTick, ref } from "vue";
import Button from "../ui/Button.vue";
import type { AiAskAnswer, AiAskAnswered, AiAskQuestion } from "../../api/types";

const props = defineProps<{
  questions: AiAskQuestion[];
  /** Set once answered (or answered by typing a message instead). */
  answered?: AiAskAnswered;
  /** Another answer is being worked on. */
  disabled?: boolean;
}>();

const emit = defineEmits<{ (e: "answer", answers: AiAskAnswer[]): void }>();

interface Pick {
  picked: number[];
  /** The "Other…" text; null while closed. */
  other: string | null;
  decide: boolean;
}

const picks = ref<Pick[]>(props.questions.map(() => ({ picked: [], other: null, decide: false })));
const others = ref<HTMLInputElement[]>([]);

/** One question with one pick: a click is the answer. */
const instant = computed(() => props.questions.length === 1 && !props.questions[0].multi);

const summary = computed(() => {
  const a = props.answered;
  if (!a) return "";
  if (a.own) return "Answered in your message";
  return (a.answers ?? []).map((x) => `${x.header}: ${x.answer}`).join(" · ");
});

const open = computed(() => props.questions.filter((_, i) => !isAnswered(i)).length);

function isAnswered(i: number): boolean {
  const p = picks.value[i];
  return p.decide || p.picked.length > 0 || !!p.other?.trim();
}

function answerOf(i: number): AiAskAnswer {
  const p = picks.value[i];
  if (!p.decide && p.other?.trim()) return { q: i, other: p.other.trim() };
  if (!p.decide && p.picked.length) return { q: i, picked: [...p.picked] };
  return { q: i, decide: true };
}

function send(): void {
  if (props.disabled || props.answered) return;
  emit("answer", props.questions.map((_, i) => answerOf(i)));
}

function choose(i: number, c: number): void {
  if (props.disabled || props.answered) return;
  const p = picks.value[i];
  if (instant.value) {
    emit("answer", [{ q: i, picked: [c] }]);
    return;
  }
  p.decide = false;
  p.other = null;
  if (props.questions[i].multi) {
    p.picked = p.picked.includes(c) ? p.picked.filter((x) => x !== c) : [...p.picked, c].sort((a, b) => a - b);
  } else {
    p.picked = p.picked[0] === c ? [] : [c];
  }
}

function decide(i: number): void {
  if (props.disabled || props.answered) return;
  if (instant.value) {
    emit("answer", [{ q: i, decide: true }]);
    return;
  }
  const p = picks.value[i];
  p.decide = !p.decide;
  p.picked = [];
  p.other = null;
}

async function openOther(i: number): Promise<void> {
  if (props.disabled || props.answered) return;
  const p = picks.value[i];
  p.other = p.other ?? "";
  p.decide = false;
  p.picked = [];
  await nextTick();
  others.value[i]?.focus();
}

function onOtherKey(i: number, ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.stopPropagation();
    picks.value[i].other = null;
    return;
  }
  if (ev.key !== "Enter" || ev.isComposing) return;
  ev.preventDefault();
  ev.stopPropagation();
  const text = picks.value[i].other?.trim();
  if (instant.value) {
    if (text) emit("answer", [{ q: i, other: text }]);
    return;
  }
  send();
}

/** Number keys pick in the question whose chip has focus; Enter sends. */
function onKey(i: number, ev: KeyboardEvent): void {
  if (ev.target instanceof HTMLInputElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const n = Number(ev.key);
  if (Number.isInteger(n) && n >= 1 && n <= props.questions[i].choices.length) {
    ev.preventDefault();
    choose(i, n - 1);
  } else if (ev.key === "Enter" && !instant.value) {
    ev.preventDefault();
    send();
  }
}

function setOther(i: number, ev: Event): void {
  picks.value[i].other = (ev.target as HTMLInputElement).value;
}

function setRef(i: number, el: unknown): void {
  if (el instanceof HTMLInputElement) others.value[i] = el;
}
</script>

<template>
  <p v-if="answered" class="wp-ai-ask__done" data-test="ai-ask-done">
    <i class="pi pi-check" aria-hidden="true" /> <span>{{ summary }}</span>
  </p>
  <section v-else class="wp-ai-ask" :aria-busy="disabled || undefined" data-test="ai-ask">
    <div
      v-for="(q, i) in questions"
      :key="i"
      class="wp-ai-ask__q"
      :role="q.multi ? 'group' : 'radiogroup'"
      :aria-labelledby="`wp-ai-ask-${i}`"
      data-test="ai-ask-question"
    >
      <span class="wp-ai-ask__header">{{ q.header }}</span>
      <p :id="`wp-ai-ask-${i}`" class="wp-ai-ask__text">{{ q.question }}</p>
      <div class="wp-ai-ask__chips">
        <button
          v-for="(c, j) in q.choices"
          :key="j"
          type="button"
          class="wp-ai-ask__chip"
          :role="q.multi ? 'checkbox' : 'radio'"
          :aria-checked="picks[i].picked.includes(j)"
          :title="c.hint ? `${c.label}: ${c.hint}` : c.label"
          :disabled="disabled"
          data-test="ai-ask-choice"
          @click="choose(i, j)"
          @keydown="onKey(i, $event)"
        >
          <span class="wp-ai-ask__label"><kbd v-if="j < 9" class="wp-ai-ask__key">{{ j + 1 }}</kbd>{{ c.label }}</span>
          <span v-if="c.hint" class="wp-ai-ask__hint">{{ c.hint }}</span>
        </button>
        <button
          type="button"
          class="wp-ai-ask__chip"
          data-kind="other"
          :aria-pressed="picks[i].other !== null"
          :disabled="disabled"
          data-test="ai-ask-other"
          @click="openOther(i)"
          @keydown="onKey(i, $event)"
        >Other…</button>
        <button
          type="button"
          class="wp-ai-ask__chip"
          data-kind="decide"
          :aria-pressed="picks[i].decide"
          :disabled="disabled"
          data-test="ai-ask-decide"
          @click="decide(i)"
          @keydown="onKey(i, $event)"
        >Decide for me</button>
      </div>
      <input
        v-if="picks[i].other !== null"
        :ref="(el) => setRef(i, el)"
        class="wp-ai-ask__other"
        type="text"
        maxlength="300"
        :value="picks[i].other"
        :placeholder="instant ? 'Your answer, then Enter' : 'Your answer'"
        :aria-label="`Your own answer: ${q.header}`"
        :disabled="disabled"
        data-test="ai-ask-other-input"
        @input="setOther(i, $event)"
        @keydown="onOtherKey(i, $event)"
      />
    </div>
    <div v-if="!instant" class="wp-ai-ask__foot">
      <span class="wp-ai-ask__left">{{ open ? `${open} left for the assistant to decide` : "" }}</span>
      <Button variant="primary" size="sm" icon="pi-send" :disabled="disabled" data-test="ai-ask-send" @click="send">Send answers</Button>
    </div>
  </section>
</template>

<style scoped>
.wp-ai-ask {
  container-type: inline-size;
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, var(--wp-border));
  border-radius: min(8px, var(--wp-radius-cap, 999px)); padding: 10px; display: flex; flex-direction: column; gap: 10px;
  background: color-mix(in oklab, var(--wp-accent-500) 4%, var(--wp-bg-2));
}
.wp-ai-ask[aria-busy="true"] { opacity: 0.7; }
.wp-ai-ask__q { display: flex; flex-direction: column; gap: 4px; outline: none; }
.wp-ai-ask__header {
  align-self: flex-start; font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--wp-accent-text); text-transform: uppercase;
}
.wp-ai-ask__text { margin: 0; font-size: 13px; color: var(--wp-text); overflow-wrap: anywhere; }
.wp-ai-ask__chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.wp-ai-ask__chip {
  display: inline-flex; flex-direction: column; align-items: flex-start; gap: 1px;
  max-width: 100%; padding: 4px 10px; border-radius: min(14px, var(--wp-radius-cap, 999px)); cursor: pointer; text-align: left;
  font: inherit; font-size: 12.5px; line-height: 18px;
  border: 1px solid var(--wp-border); background: var(--wp-bg-1); color: var(--wp-text);
}
.wp-ai-ask__chip:hover:not(:disabled) { border-color: var(--wp-accent-400); }
.wp-ai-ask__chip:focus-visible { outline: 2px solid var(--wp-accent-500); outline-offset: 1px; }
.wp-ai-ask__chip:disabled { cursor: not-allowed; opacity: 0.6; }
.wp-ai-ask__chip[aria-checked="true"], .wp-ai-ask__chip[aria-pressed="true"] {
  border-color: var(--wp-accent-500);
  background: color-mix(in oklab, var(--wp-accent-500) 22%, var(--wp-bg-1));
  color: var(--wp-accent-text);
}
.wp-ai-ask__chip[data-kind="other"], .wp-ai-ask__chip[data-kind="decide"] {
  border-style: dashed; color: var(--wp-text-muted); background: none;
}
.wp-ai-ask__label { display: inline-flex; gap: 6px; align-items: baseline; overflow-wrap: anywhere; }
.wp-ai-ask__key {
  font-family: var(--wp-font-mono, monospace); font-size: 10px; color: var(--wp-text-dim);
  border: 0; background: none; padding: 0;
}
.wp-ai-ask__hint { font-size: 11px; line-height: 15px; color: var(--wp-text-muted); overflow-wrap: anywhere; }
/* A narrow drawer keeps hints in the tooltip only. */
@container (max-width: 380px) {
  .wp-ai-ask__hint { display: none; }
}
.wp-ai-ask__other {
  margin-top: 2px; padding: 5px 8px; border-radius: min(6px, var(--wp-radius-cap, 999px)); font: inherit; font-size: 12.5px;
  border: 1px solid var(--wp-border); background: var(--wp-bg-1); color: var(--wp-text);
}
.wp-ai-ask__other:focus { outline: none; border-color: var(--wp-accent-500); }
.wp-ai-ask__foot { display: flex; align-items: center; gap: 8px; }
.wp-ai-ask__left { flex: 1; font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-ask__done {
  margin: 0; font-size: 12px; color: var(--wp-text-muted); display: flex; gap: 6px;
  align-items: baseline; overflow-wrap: anywhere;
}
.wp-ai-ask__done .pi { font-size: 10px; color: var(--wp-success); }
</style>
