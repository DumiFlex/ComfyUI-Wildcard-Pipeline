<script setup lang="ts">
/**
 * AiTextPanel — the AI panel of the fixed values, combine and template
 * editors (`/wp/api/ai/text/draft`). The server knows the library's
 * variables and checks the answer the way the engine reads it (a fixed
 * value can't read `$vars`, the Assembler's template can't pick), so what
 * comes back can be put into the editor as is. "Use it" emits the new
 * payload; the editor puts it in and nothing is saved until Save.
 */
import { computed, onBeforeUnmount, watch } from "vue";
import Button from "../ui/Button.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import { useAiImages } from "../../composables/useAiImages";
import { api } from "../../api/client";
import type { AiTextDraftRequest, AiTextDraftResult } from "../../api/types";
import { useAiConversation } from "../../composables/useAiConversation";

type Kind = AiTextDraftRequest["kind"];
type Item = AiTextDraftRequest["item"];

const props = defineProps<{
  kind: Kind;
  /** The editor's item as it stands. */
  item: Item;
}>();
const emit = defineEmits<{
  (e: "use", payload: Record<string, unknown>): void;
  (e: "close"): void;
  (e: "update:pending", pending: boolean): void;
}>();

const COPY: Record<Kind, { placeholder: string; verb: string; scope: string; apply: string }> = {
  fixed_values: {
    placeholder: "e.g. an anime style preset with quality tags, and negatives that keep it from looking 3D",
    verb: "Write values",
    scope: "Knows every variable in your library. A value it names that exists is rewritten.",
    apply: "Use these values",
  },
  combine: {
    placeholder: "e.g. join hair, eyes and outfit into one look, outfit last",
    verb: "Write the template",
    scope: "Knows every variable in your library and what each holds.",
    apply: "Use this template",
  },
  template: {
    placeholder: "e.g. a portrait prompt from my character variables, with standard negatives",
    verb: "Write the prompt",
    scope: "Knows every variable in your library. Picks belong in wildcards, so it only reads variables.",
    apply: "Use this prompt",
  },
};
const copy = computed(() => COPY[props.kind]);

const pics = useAiImages();
const convo = useAiConversation<AiTextDraftResult, { item: Item }>({
  capture: () => ({ item: JSON.parse(JSON.stringify(props.item)) as Item }),
  send: ({ instruction, history, ctx, web, searched, skipped }, signal) => api.ai.draftText({
    kind: props.kind, instruction, history, item: ctx.item, images: pics.urls(), web, searched, skipped,
  }, signal),
  emptyMessage: (res) => res.preview.length ? "" : "The model didn't write anything usable.",
});
const { instruction, loading, error, result } = convo;
/** The chat's `use_panel` (see useAiConversation `chat`). */
defineExpose({ run: (text: string) => convo.chat(text) });

const pending = computed(() => loading.value || !!result.value);
watch(pending, (v) => emit("update:pending", v), { immediate: true });
onBeforeUnmount(() => {
  convo.stop();
  emit("update:pending", false);
});

function use(): void {
  if (!result.value) return;
  emit("use", result.value.payload);
  convo.clear();
}

function close(): void {
  convo.stop();
  emit("close");
}
</script>

<template>
  <AiPanelFrame
    v-model="instruction"
    :images="pics"
    :placeholder="copy.placeholder"
    :verb="copy.verb"
    :scope="copy.scope"
    :loading="loading"
    :answered="!!result"
    :error="error"
    :asked="convo.asked.value"
    :answer-index="convo.index.value"
    :answer-count="convo.count.value"
    @run="convo.ask"
    @refine="convo.refine"
    @retry="convo.retry"
    @restart="convo.restart"
    @go="convo.go"
    @stop="convo.stop"
    @close="close"
    :research="convo.research.value"
    :searching="convo.searching.value"
    @allow-research="convo.allowResearch"
    @skip-research="convo.skipResearch"
  >
    <template v-if="result">
      <ul class="wp-ai-text" data-test="ai-text-results">
        <li v-for="(line, i) in result.preview" :key="i" class="wp-ai-text__line">{{ line }}</li>
      </ul>
      <p v-for="w in result.warnings" :key="w" class="wp-ai-text__warn" data-test="ai-text-warning">
        <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ w }}
      </p>
      <div class="wp-ai-text__actions">
        <Button variant="ghost" size="sm" data-test="ai-discard" @click="convo.clear">Discard</Button>
        <Button variant="primary" size="sm" icon="pi-check" data-test="ai-apply" @click="use">{{ copy.apply }}</Button>
      </div>
      <p class="wp-ai-text__note">Nothing is saved until you press Save.</p>
    </template>
  </AiPanelFrame>
</template>

<style scoped>
.wp-ai-text {
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  background: var(--wp-bg-1);
  box-shadow: inset 3px 0 0 var(--wp-accent-500);
}
.wp-ai-text__line {
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
  color: var(--wp-text);
  overflow-wrap: anywhere;
}
.wp-ai-text__warn { margin: 0; font-size: 12px; color: var(--wp-warn); display: flex; gap: 6px; align-items: center; }
.wp-ai-text__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-text__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
