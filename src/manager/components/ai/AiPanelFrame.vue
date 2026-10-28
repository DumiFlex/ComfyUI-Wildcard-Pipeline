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
 * the shown answer are listed above it as steps: a step's arrows flip
 * between its tries (Try again) and between different refines of the same
 * answer, and clicking a step shows its answer.
 */
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import AiImagePicker from "./AiImagePicker.vue";
import AiSearchFound from "./AiSearchFound.vue";
import AiWorking from "./AiWorking.vue";
import ChatCompletions from "./ChatCompletions.vue";
import ChatInputMarks from "./ChatInputMarks.vue";
import { useAiConfig } from "../../composables/useAiConfig";
import type { AiImages } from "../../composables/useAiImages";
import type { SearchFound } from "../../composables/searchFound";
import type { AiStep } from "../../composables/useAiConversation";

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
  /** The requests on the shown branch, first to last
   *  (`useAiConversation().steps`). */
  steps?: AiStep[];
  /** No box or title: the parent panel draws them (wildcard tabs). */
  bare?: boolean;
  hint?: string;
  /** Reference images for the request (`useAiImages()`); a small picker
   *  shows under the box, and images pasted into the box are added. */
  images?: AiImages;
  /** Web searches the shown answer asks for; a card lets the user run them
   *  or skip them. */
  research?: string[];
  searching?: boolean;
  /** What the searches found, for the user to pick from before the
   *  answer is refined with it (`useAiConversation().web`). */
  found?: SearchFound;
}
/** The instruction box, for its `@` / `$` / tag completions. */
const box = ref<HTMLTextAreaElement | null>(null);
const props = withDefaults(defineProps<Props>(), {
  steps: () => [], hint: "You review everything first.",
});
const instruction = defineModel<string>({ required: true });
const emit = defineEmits<{
  (e: "run"): void;
  (e: "refine"): void;
  (e: "retry"): void;
  (e: "restart"): void;
  (e: "show", at: number): void;
  (e: "flip", at: number, kind: "try" | "refine", delta: number): void;
  (e: "stop"): void;
  (e: "close"): void;
  (e: "allow-research"): void;
  (e: "skip-research"): void;
  (e: "use-found", fits: boolean): void;
  (e: "skip-found"): void;
}>();

const { config } = useAiConfig();
const modelLabel = computed(() => config.value?.model ?? "");
const isLocal = computed(() => {
  const c = config.value;
  return c ? c.local ?? c.presets[c.provider].local : true;
});
const canRun = computed(
  () => (props.optional || !!instruction.value.trim()) && !props.loading && !props.blocked,
);
const canRefine = computed(() => !!instruction.value.trim() && !props.loading);

function onPaste(ev: ClipboardEvent): void {
  if (!props.images || props.images.blind.value) return;
  const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    ev.preventDefault();
    void props.images.add(files);
  }
}

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
    <ol v-if="answered && steps.length" class="wp-ai-frame__steps" data-test="ai-thread">
      <li
        v-for="(st, k) in steps"
        :key="st.at"
        class="wp-ai-frame__step"
        :data-shown="st.shown ? 'true' : 'false'"
        :data-after="st.after ? 'true' : 'false'"
        data-test="ai-step"
      >
        <button
          type="button"
          class="wp-ai-frame__step-text"
          :disabled="loading || st.shown"
          :title="st.shown ? 'This answer is showing' : 'Show this answer'"
          data-test="ai-asked"
          @click="emit('show', st.at)"
        >
          <i :class="['pi', k === 0 ? 'pi-comment' : 'pi-reply']" aria-hidden="true" />
          <span>{{ st.text || "Asked without a note" }}</span>
        </button>
        <span
          v-if="st.refines > 1"
          class="wp-ai-frame__nav"
          title="Different follow-ups to the same answer"
          data-test="ai-refine-nav"
        >
          <button
            type="button"
            class="wp-ai-frame__nav-btn"
            aria-label="Earlier refine"
            data-test="ai-refine-prev"
            :disabled="loading || st.refine <= 0"
            @click="emit('flip', st.at, 'refine', -1)"
          ><i class="pi pi-chevron-left" aria-hidden="true" /></button>
          <span class="wp-ai-frame__nav-label">refine {{ st.refine + 1 }} of {{ st.refines }}</span>
          <button
            type="button"
            class="wp-ai-frame__nav-btn"
            aria-label="Later refine"
            data-test="ai-refine-next"
            :disabled="loading || st.refine >= st.refines - 1"
            @click="emit('flip', st.at, 'refine', 1)"
          ><i class="pi pi-chevron-right" aria-hidden="true" /></button>
        </span>
        <span
          v-if="st.tries > 1"
          class="wp-ai-frame__nav"
          title="Try again asks the same request fresh; flip between its tries"
          data-test="ai-try-nav"
        >
          <button
            type="button"
            class="wp-ai-frame__nav-btn"
            aria-label="Earlier try"
            data-test="ai-try-prev"
            :disabled="loading || st.try <= 0"
            @click="emit('flip', st.at, 'try', -1)"
          ><i class="pi pi-chevron-left" aria-hidden="true" /></button>
          <span class="wp-ai-frame__nav-label"><i class="pi pi-refresh" aria-hidden="true" /> try {{ st.try + 1 }} of {{ st.tries }}</span>
          <button
            type="button"
            class="wp-ai-frame__nav-btn"
            aria-label="Later try"
            data-test="ai-try-next"
            :disabled="loading || st.try >= st.tries - 1"
            @click="emit('flip', st.at, 'try', 1)"
          ><i class="pi pi-chevron-right" aria-hidden="true" /></button>
        </span>
      </li>
    </ol>
    <textarea
      ref="box"
      v-model="instruction"
      class="wp-textarea wp-ai-frame__input"
      :rows="answered || optional ? 1 : 2"
      :placeholder="answered ? 'Refine it: e.g. fewer, shorter, more like the second one, keep what I ticked…' : placeholder"
      :aria-label="answered ? 'Follow-up for the AI' : 'What should the AI do?'"
      data-test="ai-instruction"
      :disabled="loading"
      @keydown="onKeydown"
      @paste="onPaste"
    ></textarea>
    <ChatInputMarks :target="box" :text="instruction" />
    <ChatCompletions :target="box" />
    <AiImagePicker v-if="images" :images="images" :disabled="loading" compact />
    <div class="wp-ai-frame__controls">
      <slot name="controls" />
      <span class="wp-ai-frame__hint">{{ answered ? "Refine keeps the conversation." : hint }} Ctrl+Enter {{ answered ? "refines" : "asks" }}.</span>
      <span class="wp-ai-frame__spacer" />
      <Button variant="ghost" size="sm" data-test="ai-close" @click="emit('close')">Close</Button>
      <Button v-if="loading" size="sm" icon="pi-stop" data-test="ai-stop" @click="emit('stop')">Stop</Button>
      <template v-else-if="answered">
        <Button variant="ghost" size="sm" data-test="ai-restart" title="Drop this conversation and edit the first request" @click="emit('restart')">Start over</Button>
        <Button variant="ghost" size="sm" icon="pi-refresh" data-test="ai-retry" :disabled="blocked" title="Ask the shown step's request again, fresh; the answer is added to that step's tries" @click="emit('retry')">Try again</Button>
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
    <AiWorking v-if="loading" class="wp-ai-frame__status" :label="`Asking ${modelLabel || 'the model'}`" data-test="ai-loading" />
    <p v-if="error" class="wp-ai-frame__error" role="alert" data-test="ai-error">{{ error }}</p>
    <div v-if="answered && research?.length && !loading" class="wp-ai-frame__research" data-test="ai-research">
      <i class="pi pi-globe" aria-hidden="true" />
      <span class="wp-ai-frame__research-text">
        The AI would like to search the web to improve this:
        <q v-for="q in research" :key="q" class="wp-ai-frame__query">{{ q }}</q>
      </span>
      <Button variant="ghost" size="sm" :disabled="searching" data-test="ai-research-skip" @click="emit('skip-research')">No thanks</Button>
      <Button size="sm" icon="pi-search" :loading="searching" data-test="ai-research-allow" @click="emit('allow-research')">Search</Button>
    </div>
    <AiSearchFound
      v-if="found && answered"
      :state="found"
      :busy="loading"
      compact
      @use="(fits) => emit('use-found', fits)"
      @none="emit('skip-found')"
    />
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
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  background: color-mix(in oklab, var(--wp-accent-500) 5%, var(--wp-bg-2));
}
.wp-ai-frame[data-bare="true"] { padding: 0; margin: 0; border: 0; background: none; }
.wp-ai-frame__research {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px;
  border: 1px solid var(--wp-border); border-radius: min(6px, var(--wp-radius-cap, 999px)); background: var(--wp-bg-1); font-size: 12px;
}
.wp-ai-frame__research > .pi { color: var(--wp-accent-text); }
.wp-ai-frame__research-text { flex: 1 1 240px; min-width: 0; color: var(--wp-text-muted); overflow-wrap: anywhere; }
.wp-ai-frame__query { color: var(--wp-text); margin-left: 4px; }
.wp-ai-frame__head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wp-ai-frame__title { font-weight: 600; color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; }
.wp-ai-frame__scope { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-frame__model {
  margin-left: auto;
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 1px 7px;
  border-radius: min(5px, var(--wp-radius-cap, 999px));
  color: var(--wp-warn);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 45%, transparent);
}
.wp-ai-frame__model[data-local="true"] { color: var(--wp-success); border-color: color-mix(in oklab, var(--wp-success) 45%, transparent); }
.wp-ai-frame__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-ai-frame__step { display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap; padding: 2px 4px; border-radius: min(5px, var(--wp-radius-cap, 999px)); }
.wp-ai-frame__step[data-shown="true"] { background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent); }
.wp-ai-frame__step[data-after="true"] { opacity: 0.6; }
.wp-ai-frame__step-text {
  flex: 1 1 200px; min-width: 0; display: flex; gap: 8px; align-items: baseline; padding: 2px 0;
  border: 0; background: none; text-align: left; font-size: 12px; color: var(--wp-text-muted);
  overflow-wrap: anywhere; cursor: pointer;
}
.wp-ai-frame__step-text:hover:not(:disabled) { color: var(--wp-text); }
.wp-ai-frame__step-text:disabled { cursor: default; }
.wp-ai-frame__step[data-shown="true"] .wp-ai-frame__step-text { color: var(--wp-text); }
.wp-ai-frame__step-text .pi { font-size: 11px; color: var(--wp-accent-text); }
.wp-ai-frame__nav { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--wp-text-muted); white-space: nowrap; }
.wp-ai-frame__nav-label { font-variant-numeric: tabular-nums; }
.wp-ai-frame__nav-label .pi { font-size: 10px; color: var(--wp-accent-text); }
.wp-ai-frame__nav-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: 1px solid var(--wp-border); border-radius: min(5px, var(--wp-radius-cap, 999px));
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
