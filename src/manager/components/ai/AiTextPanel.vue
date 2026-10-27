<script setup lang="ts">
/**
 * AiTextPanel — the AI panel of the fixed values, combine and template
 * editors (`/wp/api/ai/text/draft`). The server knows the library's
 * variables and checks the answer the way the engine reads it (a fixed
 * value can't read `$vars`, the Assembler's template can't pick), so what
 * comes back can be put into the editor as is.
 *
 * Each kind is drawn the way its editor draws it (bench critique #1, #3):
 * fixed values as rows of variable, value and negative, each with a tick
 * box and a New / Changed mark (old text struck above the new); a combine
 * or template as its text and its negative, each its own tick box, with the
 * old text struck above, the variables it reads (new ones marked) and a few
 * example renders. "Use" emits the payload with only the ticked parts; the
 * editor puts it in and nothing is saved until Save.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../ui/Button.vue";
import Checkbox from "../ui/Checkbox.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import AiSyntax from "./AiSyntax.vue";
import { useAiImages } from "../../composables/useAiImages";
import { api } from "../../api/client";
import type { AiFixedRow, AiTextDraftRequest, AiTextDraftResult } from "../../api/types";
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
  emptyMessage: (res) => res.preview.length || res.rows?.length ? "" : "The model didn't write anything usable.",
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

/** Fixed values: the drafted rows (new or changed), each with a tick box. */
const rows = computed<AiFixedRow[]>(() => result.value?.rows ?? []);
/** Unticked row ids (fixed values), or parts ("prompt", "negative"). */
const unticked = ref<Set<string>>(new Set());
watch(result, () => { unticked.value = new Set(); });
function toggle(key: string): void {
  const next = new Set(unticked.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  unticked.value = next;
}

/** Combines and templates: the text and negative, before and after. */
const textKey = computed(() => (props.kind === "template" ? "template_string" : "template"));
const negKey = computed(() => (props.kind === "template" ? "negative_template" : "negative"));
const newText = computed(() => String(result.value?.payload[textKey.value] ?? ""));
const newNeg = computed(() => String(result.value?.payload[negKey.value] ?? ""));
const before = computed(() => result.value?.before ?? { template: "", negative: "" });
const textChanged = computed(() => newText.value !== before.value.template);
const negChanged = computed(() => newNeg.value !== before.value.negative);
const READ = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
function readsOf(text: string): string[] {
  return [...new Set([...text.matchAll(READ)].map((m) => m[1]))].filter((v) => v !== "negatives");
}
const reads = computed(() => {
  const had = new Set(readsOf(before.value.template));
  return readsOf(newText.value).map((v) => ({ name: v, added: !had.has(v) }));
});
const dropped = computed(() => {
  const now = new Set(readsOf(newText.value));
  return readsOf(before.value.template).filter((v) => !now.has(v));
});

const tickedCount = computed(() => {
  if (props.kind === "fixed_values") {
    return rows.value.length
      ? rows.value.filter((r) => !unticked.value.has(r.id)).length
      : (result.value ? 1 : 0);
  }
  return [textChanged.value && !unticked.value.has("prompt"),
    negChanged.value && !unticked.value.has("negative")].filter(Boolean).length;
});
const applyLabel = computed(() => {
  const n = tickedCount.value;
  if (props.kind === "fixed_values" && rows.value.length) return `Use ${n} value${n === 1 ? "" : "s"}`;
  return copy.value.apply;
});

type Value = { id?: string; name?: string; value?: string; negative?: string };
function use(): void {
  const res = result.value;
  if (!res || !tickedCount.value) return;
  if (props.kind === "fixed_values" && rows.value.length) {
    // Only the ticked rows: an unticked change or new value stays as it was.
    const keep = new Map(rows.value.filter((r) => !unticked.value.has(r.id)).map((r) => [r.id, r]));
    const current = ((props.item.payload as { values?: Value[] } | undefined)?.values ?? []);
    const values: Value[] = current.map((v) => {
      const r = v.id ? keep.get(v.id) : undefined;
      if (!r) return v;
      keep.delete(r.id);
      const next: Value = { ...v, value: r.value };
      if (r.negative) next.negative = r.negative;
      else delete next.negative;
      return next;
    });
    for (const r of keep.values()) {
      values.push({ id: r.id, name: r.name, value: r.value, ...(r.negative ? { negative: r.negative } : {}) });
    }
    emit("use", { ...res.payload, values });
  } else if (props.kind !== "fixed_values") {
    emit("use", {
      ...res.payload,
      [textKey.value]: unticked.value.has("prompt") ? before.value.template : newText.value,
      [negKey.value]: unticked.value.has("negative") ? before.value.negative : newNeg.value,
    });
  } else {
    emit("use", res.payload);
  }
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
    :steps="convo.steps.value"
    @run="convo.ask"
    @refine="convo.refine"
    @retry="convo.retry"
    @restart="convo.restart"
    @show="convo.show"
    @flip="convo.flip"
    @stop="convo.stop"
    @close="close"
    :research="convo.research.value"
    :searching="convo.searching.value"
    :found="convo.web"
    @allow-research="convo.allowResearch"
    @skip-research="convo.skipResearch"
    @use-found="convo.useFound"
    @skip-found="convo.skipFound"
  >
    <template v-if="result">
      <ul v-if="kind === 'fixed_values' && rows.length" class="wp-ai-fv" data-test="ai-text-results">
        <li
          v-for="r in rows"
          :key="r.id"
          class="wp-ai-fv__row"
          :data-status="r.status"
          :data-off="unticked.has(r.id) ? 'true' : 'false'"
          data-test="ai-fixed-row"
        >
          <label class="wp-ai-fv__name">
            <Checkbox class="wp-checkbox--inline" :model-value="!unticked.has(r.id)" @update:model-value="toggle(r.id)" />
            <code class="wp-ai-fv__var">${{ r.name }}</code>
            <span class="wp-ai-fv__badge">{{ r.status === "new" ? "New" : "Changed" }}</span>
          </label>
          <div class="wp-ai-fv__cell">
            <span class="wp-ai-fv__label">Value</span>
            <span v-if="r.before && r.before.value !== r.value" class="wp-ai-fv__old"><AiSyntax :text="r.before.value" /></span>
            <span v-if="r.value" class="wp-ai-fv__text"><AiSyntax :text="r.value" /></span>
            <span v-else class="wp-ai-fv__none">nothing: only adds negatives</span>
          </div>
          <div class="wp-ai-fv__cell wp-ai-fv__cell--neg">
            <span class="wp-ai-fv__label">Negative</span>
            <span v-if="r.before && r.before.negative && r.before.negative !== r.negative" class="wp-ai-fv__old"><AiSyntax :text="r.before.negative" /></span>
            <span v-if="r.negative" class="wp-ai-fv__text"><AiSyntax :text="r.negative" /></span>
            <span v-else class="wp-ai-fv__none">none</span>
          </div>
        </li>
      </ul>
      <ul v-else-if="kind === 'fixed_values'" class="wp-ai-text" data-test="ai-text-results">
        <li v-for="(line, i) in result.preview" :key="i" class="wp-ai-text__line">{{ line }}</li>
      </ul>
      <div v-else class="wp-ai-txt" data-test="ai-text-results">
        <section
          class="wp-ai-txt__part"
          :data-off="unticked.has('prompt') || !textChanged ? 'true' : 'false'"
          data-test="ai-text-prompt"
        >
          <label class="wp-ai-txt__head">
            <Checkbox
              v-if="textChanged"
              class="wp-checkbox--inline"
              :model-value="!unticked.has('prompt')"
              @update:model-value="toggle('prompt')"
            />
            <span class="wp-ai-txt__title">{{ kind === "combine" ? "Template" : "Prompt" }}</span>
            <code v-if="kind === 'combine' && result.payload.output_var" class="wp-ai-fv__var">→ ${{ String(result.payload.output_var) }}</code>
            <span v-if="!textChanged" class="wp-ai-txt__same">unchanged</span>
            <span v-else-if="before.template" class="wp-ai-fv__badge">Changed</span>
          </label>
          <p v-if="textChanged && before.template" class="wp-ai-txt__old"><AiSyntax :text="before.template" /></p>
          <p class="wp-ai-txt__text"><AiSyntax :text="newText" /></p>
          <p v-if="reads.length || dropped.length" class="wp-ai-txt__reads" data-test="ai-text-reads">
            <span class="wp-ai-fv__label">Reads</span>
            <span
              v-for="v in reads"
              :key="v.name"
              class="wp-ai-txt__chip"
              :data-new="v.added && before.template ? 'true' : 'false'"
              :title="v.added && before.template ? 'Newly read' : 'Read'"
            >${{ v.name }}</span>
            <span v-for="v in dropped" :key="`d-${v}`" class="wp-ai-txt__chip" data-gone="true" title="No longer read">${{ v }}</span>
          </p>
        </section>
        <section
          v-if="newNeg || before.negative"
          class="wp-ai-txt__part wp-ai-txt__part--neg"
          :data-off="unticked.has('negative') || !negChanged ? 'true' : 'false'"
          data-test="ai-text-negative"
        >
          <label class="wp-ai-txt__head">
            <Checkbox
              v-if="negChanged"
              class="wp-checkbox--inline"
              :model-value="!unticked.has('negative')"
              @update:model-value="toggle('negative')"
            />
            <span class="wp-ai-txt__title">Negative</span>
            <span v-if="!negChanged" class="wp-ai-txt__same">unchanged</span>
            <span v-else-if="before.negative" class="wp-ai-fv__badge">Changed</span>
          </label>
          <p v-if="negChanged && before.negative" class="wp-ai-txt__old"><AiSyntax :text="before.negative" /></p>
          <p class="wp-ai-txt__text"><AiSyntax :text="newNeg || '(none)'" /></p>
        </section>
        <section v-if="result.samples?.length" class="wp-ai-txt__samples" data-test="ai-text-samples">
          <span class="wp-ai-fv__label">Prints like (options from your library)</span>
          <ul>
            <li v-for="(line, i) in result.samples" :key="i">{{ line }}</li>
          </ul>
        </section>
      </div>
      <p v-for="w in result.warnings" :key="w" class="wp-ai-text__warn" data-test="ai-text-warning">
        <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ w }}
      </p>
      <div class="wp-ai-text__actions">
        <Button variant="ghost" size="sm" data-test="ai-discard" @click="convo.clear">Discard</Button>
        <Button
          variant="primary"
          size="sm"
          icon="pi-check"
          :disabled="!tickedCount"
          data-test="ai-apply"
          @click="use"
        >{{ applyLabel }}</Button>
      </div>
      <p class="wp-ai-text__note">
        <template v-if="kind === 'fixed_values' && rows.length">Only the ticked values change; the others stay as they are. </template>Nothing is saved until you press Save.
      </p>
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

/* Fixed values: one row per value, the editor's columns. */
.wp-ai-fv {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  background: var(--wp-bg-1);
}
.wp-ai-fv__row {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 4px 12px;
  align-items: start;
  padding: 7px 10px;
  border-top: 1px solid var(--wp-border);
  box-shadow: inset 3px 0 0 var(--wp-success);
}
.wp-ai-fv__row:first-child { border-top: 0; }
.wp-ai-fv__row[data-status="changed"] { box-shadow: inset 3px 0 0 var(--wp-accent-500); }
.wp-ai-fv__row[data-off="true"] { box-shadow: none; opacity: 0.5; }
@media (max-width: 640px) {
  .wp-ai-fv__row { grid-template-columns: 1fr; }
}
.wp-ai-fv__name { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; cursor: pointer; min-width: 0; }
.wp-ai-fv__var { font-family: var(--wp-font-mono, monospace); font-size: 12px; color: var(--wp-accent-text); overflow-wrap: anywhere; }
.wp-ai-fv__badge {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--wp-surface-2, rgba(127, 127, 127, 0.15));
  color: var(--wp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.wp-ai-fv__cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-family: var(--wp-font-mono, monospace); font-size: 12px; }
.wp-ai-fv__label { font-family: inherit; font-size: 10px; color: var(--wp-text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.wp-ai-fv__cell .wp-ai-fv__label { font-family: var(--wp-font-sans, sans-serif); }
.wp-ai-fv__text { color: var(--wp-text); overflow-wrap: anywhere; }
.wp-ai-fv__cell--neg .wp-ai-fv__text { color: var(--wp-danger-text, var(--wp-danger)); }
.wp-ai-fv__old { color: var(--wp-text-dim); text-decoration: line-through; overflow-wrap: anywhere; }
.wp-ai-fv__none { color: var(--wp-text-dim); font-style: italic; font-family: var(--wp-font-sans, sans-serif); font-size: 11px; }

/* Combine / template: the text and the negative, each its own part. */
.wp-ai-txt { display: flex; flex-direction: column; gap: 8px; }
.wp-ai-txt__part {
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  background: var(--wp-bg-1);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: inset 3px 0 0 var(--wp-accent-500);
}
.wp-ai-txt__part--neg { box-shadow: inset 3px 0 0 var(--wp-danger); }
.wp-ai-txt__part[data-off="true"] { box-shadow: none; }
.wp-ai-txt__part[data-off="true"] .wp-ai-txt__text { opacity: 0.6; }
.wp-ai-txt__head { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.wp-ai-txt__title { font-weight: 600; font-size: 12px; color: var(--wp-text); }
.wp-ai-txt__same { font-size: 11px; color: var(--wp-text-dim); font-style: italic; }
.wp-ai-txt__old, .wp-ai-txt__text { margin: 0; font-family: var(--wp-font-mono, monospace); font-size: 12px; overflow-wrap: anywhere; }
.wp-ai-txt__old { color: var(--wp-text-dim); text-decoration: line-through; }
.wp-ai-txt__text { color: var(--wp-text); }
.wp-ai-txt__part--neg .wp-ai-txt__text { color: var(--wp-danger-text, var(--wp-danger)); }
.wp-ai-txt__reads { margin: 2px 0 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.wp-ai-txt__chip {
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  border: 1px solid var(--wp-border);
  color: var(--wp-text-muted);
}
.wp-ai-txt__chip[data-new="true"] { border-style: dashed; border-color: var(--wp-accent-400); color: var(--wp-accent-text); }
.wp-ai-txt__chip[data-gone="true"] { text-decoration: line-through; color: var(--wp-text-dim); }
.wp-ai-txt__samples { display: flex; flex-direction: column; gap: 2px; padding: 0 2px; }
.wp-ai-txt__samples ul { margin: 0; padding-left: 16px; font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-text__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-text__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
