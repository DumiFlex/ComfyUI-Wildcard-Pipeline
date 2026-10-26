<script setup lang="ts">
/**
 * AiDescribePanel — a description and library tags written by the user's
 * model (`/wp/api/ai/describe`), for the Identity card of any editor. The
 * model reads what the item holds and the library's existing tags; the user
 * ticks what to keep and "Apply" emits it. Nothing is saved until Save.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../ui/Button.vue";
import Checkbox from "../ui/Checkbox.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import { api } from "../../api/client";
import { useAiConversation } from "../../composables/useAiConversation";
import type { AiDescribeKind, AiDescribeResult } from "../../api/types";

const props = defineProps<{
  kind: AiDescribeKind;
  name: string;
  description: string;
  tags: string[];
  /** Read when the user asks, so it reflects unsaved edits. */
  payload: () => unknown;
}>();
const emit = defineEmits<{
  (e: "apply", patch: { description?: string; addTags: string[] }): void;
  (e: "close"): void;
}>();

const useDescription = ref(true);
const picked = ref<Set<string>>(new Set());

const convo = useAiConversation<AiDescribeResult, unknown>({
  capture: () => props.payload(),
  send: ({ instruction, history, ctx }, signal) => api.ai.describe({
    kind: props.kind, name: props.name, description: props.description, tags: props.tags,
    payload: ctx, history, ...(instruction ? { hint: instruction } : {}),
  }, signal),
  note: (res) => {
    const parts: string[] = [];
    if (res.description && !useDescription.value) parts.push("they didn't take the description");
    const fresh = res.tags.filter((t) => !t.has).map((t) => t.tag);
    const off = fresh.filter((t) => !picked.value.has(t));
    if (off.length) parts.push(`they unticked the tags ${off.join(", ")}`);
    return parts.join("; ");
  },
});
const { instruction: hint, loading, error, result } = convo;
/** The chat's `use_panel` (see useAiConversation `chat`). */
defineExpose({ run: (text: string) => convo.chat(text) });
watch(result, (r) => {
  if (!r) return;
  useDescription.value = !!r.description && r.description !== props.description;
  picked.value = new Set(r.tags.filter((t) => !t.has).map((t) => t.tag));
});
onBeforeUnmount(() => convo.stop());

const freshTags = computed(() => (result.value?.tags ?? []).filter((t) => !t.has));
const keptTags = computed(() => (result.value?.tags ?? []).filter((t) => t.has));
const changeCount = computed(
  () => (useDescription.value && result.value?.description ? 1 : 0) + picked.value.size,
);

function toggle(tag: string): void {
  const next = new Set(picked.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  picked.value = next;
}

function apply(): void {
  if (!result.value || !changeCount.value) return;
  emit("apply", {
    ...(useDescription.value && result.value.description ? { description: result.value.description } : {}),
    addTags: freshTags.value.map((t) => t.tag).filter((t) => picked.value.has(t)),
  });
  convo.clear();
}

function close(): void {
  convo.stop();
  emit("close");
}
</script>

<template>
  <AiPanelFrame
    v-model="hint"
    placeholder="Optional: steer it, e.g. mention it's for anime portraits"
    verb="Suggest"
    scope="Description and tags from what this holds."
    optional
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
  >
    <template v-if="result">
      <label v-if="result.description" class="wp-ai-desc__desc" data-test="ai-desc-description">
        <Checkbox class="wp-checkbox--inline wp-ai-desc__check" v-model="useDescription" />
        <span class="wp-ai-desc__body">
          <span v-if="description" class="wp-ai-desc__old">{{ description }}</span>
          <span class="wp-ai-desc__new">{{ result.description }}</span>
        </span>
      </label>
      <div v-if="result.tags.length" class="wp-ai-desc__tags" data-test="ai-desc-tags">
        <span class="wp-ai-desc__label">Tags</span>
        <button
          v-for="t in freshTags"
          :key="t.tag"
          type="button"
          class="wp-ai-desc__tag"
          :data-on="picked.has(t.tag) ? 'true' : 'false'"
          :data-new="t.new ? 'true' : 'false'"
          :title="t.new ? 'New tag: nothing in your library uses it yet' : 'Used elsewhere in your library'"
          :aria-pressed="picked.has(t.tag)"
          data-test="ai-desc-tag"
          @click="toggle(t.tag)"
        ><i :class="['pi', picked.has(t.tag) ? 'pi-check' : 'pi-plus']" aria-hidden="true" /> {{ t.tag }}</button>
        <span
          v-for="t in keptTags"
          :key="t.tag"
          class="wp-ai-desc__tag"
          data-has="true"
          title="Already on this item"
        >{{ t.tag }}</span>
      </div>
      <div class="wp-ai-desc__actions">
        <Button variant="ghost" size="sm" data-test="ai-discard" @click="convo.clear">Discard</Button>
        <Button
          variant="primary"
          size="sm"
          icon="pi-check"
          :disabled="!changeCount"
          data-test="ai-apply"
          @click="apply"
        >Apply</Button>
      </div>
      <p class="wp-ai-desc__note">Tags are added to the ones you have. Nothing is saved until you press Save.</p>
    </template>
  </AiPanelFrame>
</template>

<style scoped>
.wp-ai-desc__desc {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  background: var(--wp-bg-1);
  cursor: pointer;
}
.wp-ai-desc__check { margin-top: 3px; }
.wp-ai-desc__body { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.wp-ai-desc__old { color: var(--wp-text-dim); text-decoration: line-through; }
.wp-ai-desc__new { color: var(--wp-text); }
.wp-ai-desc__tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wp-ai-desc__label { font-size: 12px; color: var(--wp-text-muted); margin-right: 4px; }
.wp-ai-desc__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-size: 12px;
  padding: 2px 9px;
  border-radius: 12px;
  border: 1px solid var(--wp-border);
  background: transparent;
  color: var(--wp-text-muted);
  cursor: pointer;
}
.wp-ai-desc__tag .pi { font-size: 10px; }
.wp-ai-desc__tag[data-on="true"] {
  border-color: color-mix(in oklab, var(--wp-accent-500) 60%, transparent);
  color: var(--wp-accent-text);
  background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent);
}
.wp-ai-desc__tag[data-new="true"] { border-style: dashed; }
.wp-ai-desc__tag[data-has="true"] { cursor: default; opacity: 0.6; }
.wp-ai-desc__actions { display: flex; justify-content: flex-end; gap: 8px; }
.wp-ai-desc__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
</style>
