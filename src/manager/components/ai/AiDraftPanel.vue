<script setup lang="ts">
/**
 * AiDraftPanel — "Draft with AI" for the wildcard editor.
 *
 * The user says what to add; the server asks their model (Settings › AI
 * assistant) and returns options that already passed the engine's checks
 * (`/wp/api/ai/wildcard/draft`). The draft shows here with a checkbox per row.
 * "Add" emits the ticked rows in the same shape the Bulk add panel emits, so
 * the editor inserts them through the one path it already has, and nothing
 * is saved until the user presses Save.
 *
 * The editor's current draft is sent, unsaved rows included, so the model
 * sees what is really in the list.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../ui/Button.vue";
import Input from "../ui/Input.vue";
import { api, ApiError } from "../../api/client";
import type { AiDraftOption, AiWildcardDraftResult } from "../../api/types";
import type { ParsedBulkOption } from "../../utils/bulkParse";
import { useAiConfig } from "../../composables/useAiConfig";

interface Props {
  name: string;
  varBinding: string;
  /** Current option values, blank rows included (the server ignores them). */
  existingValues: string[];
  existingTags: string[];
  tagGroups?: Record<string, string[]>;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "commit-options", payload: ParsedBulkOption[]): void;
  (e: "cancel"): void;
  /** True while there is a draft or a request the user would lose. */
  (e: "update:pending", pending: boolean): void;
}>();

const { config } = useAiConfig();

const instruction = ref("");
const count = ref<number>(10);
const loading = ref(false);
const error = ref("");
const result = ref<AiWildcardDraftResult | null>(null);
/** Indices of result rows the user unticked. */
const unticked = ref<Set<number>>(new Set());
let controller: AbortController | null = null;

const pending = computed(() => loading.value || (result.value?.options.length ?? 0) > 0);
watch(pending, (v) => emit("update:pending", v), { immediate: true });
onBeforeUnmount(() => {
  controller?.abort();
  emit("update:pending", false);
});

const modelLabel = computed(() => config.value?.model ?? "");
const isLocal = computed(() => {
  const c = config.value;
  return c ? c.presets[c.provider].local : true;
});

const newTagSet = computed(() => new Set(result.value?.new_tags ?? []));
const ticked = computed<AiDraftOption[]>(() =>
  (result.value?.options ?? []).filter((_, i) => !unticked.value.has(i)),
);

function toggle(i: number): void {
  const next = new Set(unticked.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  unticked.value = next;
}

async function generate(): Promise<void> {
  if (!instruction.value.trim() || loading.value) return;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = "";
  result.value = null;
  unticked.value = new Set();
  const n = Math.min(100, Math.max(1, Math.round(Number(count.value) || 10)));
  count.value = n;
  try {
    result.value = await api.ai.draftWildcard({
      instruction: instruction.value.trim(),
      count: n,
      wildcard: {
        name: props.name,
        var_binding: props.varBinding,
        payload: {
          options: props.existingValues.filter((v) => v.trim()).map((value) => ({ value })),
          sub_categories: props.existingTags,
          ...(props.tagGroups && Object.keys(props.tagGroups).length ? { tag_groups: props.tagGroups } : {}),
        },
      },
    }, controller.signal);
    if (result.value.options.length === 0) {
      error.value = result.value.skipped.length
        ? "Everything the model suggested was already in the list or unusable. Try asking differently."
        : "The model didn't suggest anything. Try again or reword the request.";
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    error.value = err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong";
  } finally {
    loading.value = false;
    controller = null;
  }
}

function stop(): void {
  controller?.abort();
  loading.value = false;
}

function commit(): void {
  if (ticked.value.length === 0) return;
  emit("commit-options", ticked.value.map((o) => ({
    value: o.value,
    weight: o.weight,
    tags: o.tags,
    ...(o.negative ? { negative: o.negative } : {}),
  })));
  result.value = null;
  instruction.value = "";
}

function discard(): void {
  result.value = null;
  error.value = "";
}

function cancel(): void {
  controller?.abort();
  emit("cancel");
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    void generate();
  }
}

const skippedSummary = computed(() => {
  const s = result.value?.skipped ?? [];
  if (!s.length) return "";
  const byReason = new Map<string, number>();
  for (const x of s) byReason.set(x.reason, (byReason.get(x.reason) ?? 0) + 1);
  return [...byReason].map(([r, n]) => `${n} ${r}`).join(", ");
});
</script>

<template>
  <div class="wp-ai-draft" data-test="ai-draft-panel">
    <div class="wp-ai-draft__head">
      <span class="wp-ai-draft__title"><i class="pi pi-microchip-ai" aria-hidden="true" /> Draft with AI</span>
      <span class="wp-ai-draft__model" :data-local="isLocal ? 'true' : 'false'" :title="isLocal ? 'Runs on your machine' : 'Sent to a cloud provider'">{{ modelLabel }}</span>
    </div>

    <textarea
      v-model="instruction"
      class="wp-textarea wp-ai-draft__input"
      rows="3"
      placeholder="e.g. more everyday outfits, spread across the four seasons, same comma style as the existing ones"
      aria-label="What should the AI add?"
      data-test="ai-draft-instruction"
      :disabled="loading"
      @keydown="onKeydown"
    ></textarea>

    <div class="wp-ai-draft__controls">
      <label class="wp-ai-draft__count" for="wp-ai-draft-count">
        How many
        <Input
          id="wp-ai-draft-count"
          v-model.number="count"
          type="number"
          :min="1"
          :max="100"
          :step="1"
          size="sm"
          aria-label="How many options to draft"
          data-test="ai-draft-count"
        />
      </label>
      <span class="wp-ai-draft__hint">Uses your existing options and tags as examples. Ctrl+Enter drafts.</span>
      <span class="wp-ai-draft__spacer" />
      <Button variant="ghost" size="sm" data-test="ai-draft-cancel" @click="cancel">Close</Button>
      <Button v-if="loading" size="sm" icon="pi-stop" data-test="ai-draft-stop" @click="stop">Stop</Button>
      <Button
        v-else
        variant="primary"
        size="sm"
        icon="pi-microchip-ai"
        :disabled="!instruction.trim()"
        data-test="ai-draft-generate"
        @click="generate"
      >{{ result ? "Draft again" : "Draft" }}</Button>
    </div>

    <p v-if="loading" class="wp-ai-draft__status" role="status" data-test="ai-draft-loading">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> Asking {{ modelLabel || "the model" }}… local models can take a minute.
    </p>
    <p v-if="error" class="wp-ai-draft__error" role="alert" data-test="ai-draft-error">{{ error }}</p>

    <template v-if="result && result.options.length">
      <ul class="wp-ai-draft__list" data-test="ai-draft-results">
        <li v-for="(o, i) in result.options" :key="i" class="wp-ai-draft__row" :data-off="unticked.has(i) ? 'true' : 'false'">
          <label class="wp-ai-draft__row-label" :for="`wp-ai-draft-opt-${i}`">
            <input
              :id="`wp-ai-draft-opt-${i}`"
              type="checkbox"
              class="wp-ai-draft__check"
              :checked="!unticked.has(i)"
              @change="toggle(i)"
            />
            <span class="wp-ai-draft__value">{{ o.value }}</span>
          </label>
          <span v-if="o.weight !== 1" class="wp-ai-draft__weight" title="Weight">×{{ o.weight }}</span>
          <span
            v-for="t in o.tags"
            :key="t"
            class="wp-ai-draft__tag"
            :data-new="newTagSet.has(t) ? 'true' : 'false'"
            :title="newTagSet.has(t) ? 'New tag' : 'Existing tag'"
          >#{{ t }}</span>
          <span v-if="o.negative" class="wp-ai-draft__neg" title="Negative">− {{ o.negative }}</span>
        </li>
      </ul>
      <p class="wp-ai-draft__summary">
        {{ result.options.length }} suggested<template v-if="skippedSummary"> · skipped {{ skippedSummary }}</template>
        <template v-if="result.new_tags.length"> · new tags (dashed) are created when you add</template>
      </p>
      <div class="wp-ai-draft__actions">
        <Button variant="ghost" size="sm" data-test="ai-draft-discard" @click="discard">Discard</Button>
        <Button
          variant="primary"
          size="sm"
          icon="pi-plus"
          :disabled="ticked.length === 0"
          data-test="ai-draft-add"
          @click="commit"
        >Add {{ ticked.length }} option{{ ticked.length === 1 ? "" : "s" }}</Button>
      </div>
      <p class="wp-ai-draft__note">Nothing is saved until you press Save.</p>
    </template>
  </div>
</template>

<style scoped>
.wp-ai-draft {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 40%, var(--wp-border));
  border-radius: 8px;
  background: color-mix(in oklab, var(--wp-accent-500) 5%, var(--wp-bg-2));
}
.wp-ai-draft__head { display: flex; align-items: center; gap: 8px; }
.wp-ai-draft__title { font-weight: 600; color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; }
.wp-ai-draft__model {
  margin-left: auto;
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 5px;
  color: var(--wp-warn);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 45%, transparent);
}
.wp-ai-draft__model[data-local="true"] { color: var(--wp-success); border-color: color-mix(in oklab, var(--wp-success) 45%, transparent); }
.wp-ai-draft__input { width: 100%; resize: vertical; overscroll-behavior: contain; font-size: 13px; }
.wp-ai-draft__controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wp-ai-draft__count { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--wp-text-muted); white-space: nowrap; }
.wp-ai-draft__count :deep(.wp-input-group) { width: 96px; flex: 0 0 auto; }
.wp-ai-draft__hint { font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-draft__spacer { flex: 1; }
.wp-ai-draft__status { margin: 0; font-size: 12px; color: var(--wp-text-muted); display: flex; gap: 6px; align-items: center; }
.wp-ai-draft__error { margin: 0; font-size: 12px; color: var(--wp-danger); }
.wp-ai-draft__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  background: var(--wp-bg-1);
}
.wp-ai-draft__row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-top: 1px solid var(--wp-border);
  box-shadow: inset 3px 0 0 var(--wp-success);
}
.wp-ai-draft__row:first-child { border-top: 0; }
.wp-ai-draft__row[data-off="true"] { box-shadow: none; opacity: 0.5; }
.wp-ai-draft__row-label { display: inline-flex; align-items: center; gap: 8px; flex: 1 1 240px; min-width: 0; cursor: pointer; }
.wp-ai-draft__check { accent-color: var(--wp-accent-500); }
.wp-ai-draft__value { font-family: var(--wp-font-mono, monospace); font-size: 12px; color: var(--wp-text); overflow-wrap: anywhere; }
.wp-ai-draft__weight { font-size: 11px; color: var(--wp-text-muted); font-variant-numeric: tabular-nums; }
.wp-ai-draft__tag {
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--wp-success) 45%, transparent);
  color: var(--wp-success);
}
.wp-ai-draft__tag[data-new="true"] { border-style: dashed; border-color: var(--wp-accent-400); color: var(--wp-accent-text); }
.wp-ai-draft__neg { font-size: 11px; color: var(--wp-danger-text, var(--wp-danger)); }
.wp-ai-draft__summary, .wp-ai-draft__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-draft__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
