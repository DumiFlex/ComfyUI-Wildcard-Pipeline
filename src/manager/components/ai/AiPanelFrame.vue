<script setup lang="ts">
/**
 * AiPanelFrame — the box every "describe it, review it" AI panel shares:
 * the AI title and model pill, the request box, Ask / Stop / Close, the
 * waiting line and the error line. The panel's own review list goes in the
 * default slot.
 *
 * Once an answer shows, the request box becomes a follow-up box (see
 * `useAiConversation`): Refine sends it with the conversation so far, Try
 * again re-asks, Start over drops the conversation. The requests that led to
 * the shown answer are listed above it, with arrows to flip between answers.
 */
import { computed } from "vue";
import Button from "../ui/Button.vue";
import { useAiConfig } from "../../composables/useAiConfig";

interface Props {
  placeholder: string;
  /** Label of the ask button before the first answer. */
  verb: string;
  loading: boolean;
  /** An answer is showing, so the box takes a follow-up. */
  answered: boolean;
  error: string;
  /** Extra reason the ask button is off (no options yet, …). */
  blocked?: boolean;
  /** One line under the title saying what the model sees. */
  scope?: string;
  /** The request box may stay empty (it only steers the answer). */
  optional?: boolean;
  /** Requests that led to the shown answer, first to last. */
  asked?: string[];
  answerIndex?: number;
  answerCount?: number;
  /** No box or title: the parent panel draws them (wildcard tabs). */
  bare?: boolean;
  hint?: string;
}
const props = withDefaults(defineProps<Props>(), {
  asked: () => [], answerIndex: 0, answerCount: 0, hint: "You review everything first.",
});
const instruction = defineModel<string>({ required: true });
const emit = defineEmits<{
  (e: "run"): void;
  (e: "refine"): void;
  (e: "retry"): void;
  (e: "restart"): void;
  (e: "go", delta: number): void;
  (e: "stop"): void;
  (e: "close"): void;
}>();

const { config } = useAiConfig();
const modelLabel = computed(() => config.value?.model ?? "");
const isLocal = computed(() => {
  const c = config.value;
  return c ? c.presets[c.provider].local : true;
});
const canRun = computed(
  () => (props.optional || !!instruction.value.trim()) && !props.loading && !props.blocked,
);
const canRefine = computed(() => !!instruction.value.trim() && !props.loading);

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    if (props.answered) {
      if (canRefine.value) emit("refine");
    } else if (canRun.value) emit("run");
  }
}
</script>

<template>
  <div class="wp-ai-frame" :data-bare="bare ? 'true' : 'false'" data-test="ai-panel">
    <div v-if="!bare || scope" class="wp-ai-frame__head">
      <span v-if="!bare" class="wp-ai-frame__title"><i class="pi pi-microchip-ai" aria-hidden="true" /> AI</span>
      <span v-if="scope" class="wp-ai-frame__scope" data-test="ai-scope">{{ scope }}</span>
      <span
        v-if="!bare"
        class="wp-ai-frame__model"
        :data-local="isLocal ? 'true' : 'false'"
        :title="isLocal ? 'Runs on your machine' : 'Sent to a cloud provider'"
      >{{ modelLabel }}</span>
    </div>
    <slot name="top" />
    <div v-if="answered && asked.length" class="wp-ai-frame__thread" data-test="ai-thread">
      <ol class="wp-ai-frame__asks">
        <li v-for="(a, i) in asked" :key="i" data-test="ai-asked">
          <i :class="['pi', i === 0 ? 'pi-comment' : 'pi-reply']" aria-hidden="true" />
          <span>{{ a || "Asked without a note" }}</span>
        </li>
      </ol>
      <span v-if="answerCount > 1" class="wp-ai-frame__nav" data-test="ai-answer-nav">
        <button
          type="button"
          class="wp-ai-frame__nav-btn"
          aria-label="Earlier answer"
          data-test="ai-prev"
          :disabled="loading || answerIndex <= 0"
          @click="emit('go', -1)"
        ><i class="pi pi-chevron-left" aria-hidden="true" /></button>
        <span class="wp-ai-frame__nav-label">Answer {{ answerIndex + 1 }} of {{ answerCount }}</span>
        <button
          type="button"
          class="wp-ai-frame__nav-btn"
          aria-label="Later answer"
          data-test="ai-next"
          :disabled="loading || answerIndex >= answerCount - 1"
          @click="emit('go', 1)"
        ><i class="pi pi-chevron-right" aria-hidden="true" /></button>
      </span>
    </div>
    <textarea
      v-model="instruction"
      class="wp-textarea wp-ai-frame__input"
      :rows="answered || optional ? 1 : 2"
      :placeholder="answered ? 'Refine it: e.g. fewer, shorter, more like the second one, keep what I ticked…' : placeholder"
      :aria-label="answered ? 'Follow-up for the AI' : 'What should the AI do?'"
      data-test="ai-instruction"
      :disabled="loading"
      @keydown="onKeydown"
    ></textarea>
    <div class="wp-ai-frame__controls">
      <slot name="controls" />
      <span class="wp-ai-frame__hint">{{ answered ? "Refine keeps the conversation." : hint }} Ctrl+Enter {{ answered ? "refines" : "asks" }}.</span>
      <span class="wp-ai-frame__spacer" />
      <Button variant="ghost" size="sm" data-test="ai-close" @click="emit('close')">Close</Button>
      <Button v-if="loading" size="sm" icon="pi-stop" data-test="ai-stop" @click="emit('stop')">Stop</Button>
      <template v-else-if="answered">
        <Button variant="ghost" size="sm" data-test="ai-restart" title="Drop this conversation and edit the first request" @click="emit('restart')">Start over</Button>
        <Button variant="ghost" size="sm" icon="pi-refresh" data-test="ai-retry" :disabled="blocked" title="Ask the same thing again" @click="emit('retry')">Try again</Button>
        <Button
          variant="primary"
          size="sm"
          icon="pi-reply"
          :disabled="!canRefine"
          data-test="ai-refine"
          @click="emit('refine')"
        >Refine</Button>
      </template>
      <Button
        v-else
        variant="primary"
        size="sm"
        icon="pi-microchip-ai"
        :disabled="!canRun"
        data-test="ai-run"
        @click="emit('run')"
      >{{ verb }}</Button>
    </div>
    <p v-if="loading" class="wp-ai-frame__status" role="status" data-test="ai-loading">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> Asking {{ modelLabel || "the model" }}… local models can take a minute.
    </p>
    <p v-if="error" class="wp-ai-frame__error" role="alert" data-test="ai-error">{{ error }}</p>
    <slot />
  </div>
</template>

<style scoped>
.wp-ai-frame {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  margin-bottom: 12px;
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 40%, var(--wp-border));
  border-radius: 8px;
  background: color-mix(in oklab, var(--wp-accent-500) 5%, var(--wp-bg-2));
}
.wp-ai-frame[data-bare="true"] { padding: 0; margin: 0; border: 0; background: none; }
.wp-ai-frame__head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wp-ai-frame__title { font-weight: 600; color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; }
.wp-ai-frame__scope { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-frame__model {
  margin-left: auto;
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 5px;
  color: var(--wp-warn);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 45%, transparent);
}
.wp-ai-frame__model[data-local="true"] { color: var(--wp-success); border-color: color-mix(in oklab, var(--wp-success) 45%, transparent); }
.wp-ai-frame__thread { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.wp-ai-frame__asks { list-style: none; margin: 0; padding: 0; flex: 1 1 240px; display: flex; flex-direction: column; gap: 3px; }
.wp-ai-frame__asks > li { display: flex; gap: 8px; align-items: baseline; font-size: 12px; color: var(--wp-text-muted); overflow-wrap: anywhere; }
.wp-ai-frame__asks > li:last-child { color: var(--wp-text); }
.wp-ai-frame__asks .pi { font-size: 11px; color: var(--wp-accent-text); }
.wp-ai-frame__nav { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--wp-text-muted); white-space: nowrap; }
.wp-ai-frame__nav-label { font-variant-numeric: tabular-nums; }
.wp-ai-frame__nav-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: 1px solid var(--wp-border); border-radius: 5px;
  background: var(--wp-bg-1); color: var(--wp-text-muted); cursor: pointer;
}
.wp-ai-frame__nav-btn:hover:not(:disabled) { color: var(--wp-text); border-color: var(--wp-accent-400); }
.wp-ai-frame__nav-btn:disabled { opacity: 0.4; cursor: default; }
.wp-ai-frame__nav-btn .pi { font-size: 10px; }
.wp-ai-frame__input { width: 100%; resize: vertical; overscroll-behavior: contain; font-size: 13px; }
.wp-ai-frame__controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wp-ai-frame__hint { font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-frame__spacer { flex: 1; }
.wp-ai-frame__status { margin: 0; font-size: 12px; color: var(--wp-text-muted); display: flex; gap: 6px; align-items: center; }
.wp-ai-frame__error { margin: 0; font-size: 12px; color: var(--wp-danger); }
</style>
