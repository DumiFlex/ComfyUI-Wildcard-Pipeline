<script setup lang="ts">
/**
 * AiDraftPanel — the Add tab of the wildcard editor's AI panel.
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
import WpNumber from "@/components/shared/WpNumber.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../ui/Button.vue";
import Checkbox from "../ui/Checkbox.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import AiSyntax from "./AiSyntax.vue";
import { useAiImages } from "../../composables/useAiImages";
import { api } from "../../api/client";
import type { AiDraftGroup, AiDraftOption, AiWildcardDraftResult } from "../../api/types";
import type { ParsedBulkOption } from "../../utils/bulkParse";
import { keptNote, useAiConversation } from "../../composables/useAiConversation";
import { optionCount } from "../../utils/asked-count";

interface Props {
  /** The saved wildcard's id; unset for a new one. */
  moduleId?: string;
  name: string;
  varBinding: string;
  /** Current option values, blank rows included (the server ignores them). */
  existingValues: string[];
  /** The same rows with their tags and negatives, so the model sees how
   *  the list is tagged; unset sends values only. */
  existingOptions?: Array<{ value: string; sub_categories?: string[]; negative?: string }>;
  existingTags: string[];
  /** The wildcard\'s description and library tags: what it is for. */
  description?: string;
  labels?: string[];
  tagGroups?: Record<string, string[]>;
  tagGroupKinds?: Record<string, "accepts">;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "commit-options", payload: ParsedBulkOption[]): void;
  /** Tag groups to create or extend, sent just before the options. */
  (e: "commit-groups", groups: AiDraftGroup[]): void;
  (e: "cancel"): void;
  /** True while there is a draft or a request the user would lose. */
  (e: "update:pending", pending: boolean): void;
}>();

const count = ref<number>(10);
/** How many was typed in its box, or given by the chat: the server leaves it. */
const countSet = ref(false);
/** Indices of result rows the user unticked. */
const unticked = ref<Set<number>>(new Set());

type Row = { value: string; sub_categories?: string[]; negative?: string };
type Ctx = {
  values: string[];
  rows?: Row[];
  tags: string[];
  tagGroups?: Record<string, string[]>;
  kinds?: Record<string, "accepts">;
};
const pics = useAiImages();
const convo = useAiConversation<AiWildcardDraftResult, Ctx>({
  capture: () => ({
    values: props.existingValues.filter((v) => v.trim()),
    rows: props.existingOptions?.filter((o) => o.value.trim()).map((o) => ({
      value: o.value,
      ...(o.sub_categories?.length ? { sub_categories: [...o.sub_categories] } : {}),
      ...(o.negative ? { negative: o.negative } : {}),
    })),
    tags: props.existingTags,
    tagGroups: props.tagGroups,
    kinds: props.tagGroupKinds,
  }),
  send: ({ instruction, history, ctx, web, searched, skipped }, signal) => {
    // "draft 6 desert weather options" sets How many to 6 (bench W18 got
    // 10); a refine keeps the count its draft had.
    const named = history?.length ? 0 : optionCount(instruction);
    if (named) count.value = named;
    const n = Math.min(100, Math.max(1, Math.round(Number(count.value) || 10)));
    count.value = n;
    return api.ai.draftWildcard({
      instruction,
      history,
      images: pics.urls(),
      web,
      searched,
      skipped,
      count: n,
      // A request in another language names its count in words the English
      // reader above doesn't know: the server reads it then.
      ...(!named && !countSet.value && !history?.length ? { count_auto: true } : {}),
      wildcard: {
        ...(props.moduleId ? { id: props.moduleId } : {}),
        name: props.name,
        var_binding: props.varBinding,
        description: props.description ?? "",
        tags: props.labels ?? [],
        payload: {
          options: ctx.rows ?? ctx.values.map((value) => ({ value })),
          sub_categories: ctx.tags,
          ...(ctx.tagGroups && Object.keys(ctx.tagGroups).length ? { tag_groups: ctx.tagGroups } : {}),
          ...(ctx.kinds && Object.keys(ctx.kinds).length ? { tag_group_kinds: ctx.kinds } : {}),
        },
      },
    }, signal);
  },
  note: (res) => keptNote(res.options.map((o) => o.value), unticked.value),
  emptyMessage: (res) => res.options.length ? "" : res.skipped.length
    ? "Everything the model suggested was already in the list or unusable. Try asking differently."
    : "The model didn't suggest anything. Try again or reword the request.",
});
const { instruction, loading, error, result } = convo;
watch(result, (res) => {
  unticked.value = new Set();
  if (res?.count && !countSet.value) count.value = res.count;
});

const pending = computed(() => loading.value || (result.value?.options.length ?? 0) > 0);
watch(pending, (v) => emit("update:pending", v), { immediate: true });
onBeforeUnmount(() => {
  convo.stop();
  emit("update:pending", false);
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

/** Groups whose tags a ticked option still uses (a group only sorts tags
 *  that exist), or that turn an existing group into accepts. */
const groups = computed<AiDraftGroup[]>(() => {
  const used = new Set(ticked.value.flatMap((o) => o.tags));
  return (result.value?.groups ?? [])
    .map((g) => ({ ...g, tags: g.tags.filter((t) => used.has(t) || props.existingTags.includes(t)) }))
    .filter((g) => g.tags.length > 0 || (props.tagGroups && g.name in props.tagGroups));
});

function commit(): void {
  if (ticked.value.length === 0) return;
  if (groups.value.length) emit("commit-groups", groups.value);
  emit("commit-options", ticked.value.map((o) => ({
    value: o.value,
    weight: o.weight,
    tags: o.tags,
    ...(o.negative ? { negative: o.negative } : {}),
  })));
  convo.clear();
}

function cancel(): void {
  convo.stop();
  emit("cancel");
}

/** The chat's `draft_options`: ask as if the user typed it, leave the
 *  draft here for them to tick, and tell the chat what came back. */
async function run(text: string, n: number): Promise<string> {
  count.value = Math.min(100, Math.max(1, Math.round(n) || 10));
  countSet.value = true;
  instruction.value = text;
  await convo.ask();
  const res = result.value;
  if (!res || !res.options.length) return `couldn't: ${error.value || "the model didn't answer"}`;
  const shown = res.options.slice(0, 15).map((o) => o.value).join("; ");
  const more = res.options.length > 15 ? `; and ${res.options.length - 15} more` : "";
  const skipped = (skippedSummary.value ? ` Skipped: ${skippedSummary.value}.` : "")
    + (leftOffSummary.value ? ` Left off: ${leftOffSummary.value}.` : "");
  return `drafted ${res.options.length} options in the wildcard's AI panel: ${shown}${more}.${skipped} `
    + "Nothing is added yet: the user ticks the ones to keep and presses Add, then Save.";
}

defineExpose({ run });

/** Tags and negatives left off the kept options ("#desert", "6 negatives"),
 *  told apart from options that were skipped. */
const LEFT_OFF = /^(#\S+|\d+ negatives?)$/;
const leftOffSummary = computed(() => (result.value?.skipped ?? [])
  .filter((x) => LEFT_OFF.test(x.text))
  .map((x) => `${x.text} (${x.reason})`).join(", "));

const skippedSummary = computed(() => {
  const s = (result.value?.skipped ?? []).filter((x) => !LEFT_OFF.test(x.text));
  if (!s.length) return "";
  const byReason = new Map<string, number>();
  for (const x of s) byReason.set(x.reason, (byReason.get(x.reason) ?? 0) + 1);
  return [...byReason].map(([r, n]) => `${n} ${r}`).join(", ");
});
</script>

<template>
  <AiPanelFrame
    v-model="instruction"
    :images="pics"
    class="wp-ai-draft"
    data-test="ai-draft-panel"
    bare
    placeholder="e.g. more everyday outfits, spread across the four seasons, same comma style as the existing ones"
    verb="Draft"
    hint="Uses your existing options and tags as examples."
    :loading="loading"
    :answered="!!result"
    :error="error"
    :steps="convo.steps.value"
    :research="convo.research.value"
    :searching="convo.searching.value"
    :found="convo.web"
    @run="convo.ask"
    @refine="convo.refine"
    @retry="convo.retry"
    @restart="convo.restart"
    @show="convo.show"
    @flip="convo.flip"
    @stop="convo.stop"
    @close="cancel"
    @allow-research="convo.allowResearch"
    @skip-research="convo.skipResearch"
    @use-found="convo.useFound"
    @skip-found="convo.skipFound"
  >
    <template #controls>
      <label class="wp-ai-draft__count" for="wp-ai-draft-count">
        How many
        <WpNumber id="wp-ai-draft-count"
          v-model.number="count"
          commit="input"
          :min="1"
          :max="100"
          :step="1"
          size="sm"
          aria-label="How many options to draft"
          data-test="ai-draft-count"
          @update:model-value="countSet = true"
        />
      </label>
    </template>
    <template v-if="result && result.options.length">
      <ul class="wp-ai-draft__list" data-test="ai-draft-results">
        <li v-for="(o, i) in result.options" :key="i" class="wp-ai-draft__row" :data-off="unticked.has(i) ? 'true' : 'false'">
          <label class="wp-ai-draft__row-label">
            <Checkbox class="wp-checkbox--inline wp-ai-draft__check" :model-value="!unticked.has(i)" @update:model-value="toggle(i)" />
            <span class="wp-ai-draft__value"><AiSyntax :text="o.value" /></span>
          </label>
          <span v-if="o.weight !== 1" class="wp-ai-draft__weight" title="Weight">×{{ o.weight }}</span>
          <span
            v-for="t in o.tags"
            :key="t"
            class="wp-ai-draft__tag"
            :data-new="newTagSet.has(t) ? 'true' : 'false'"
            :title="newTagSet.has(t) ? 'New tag' : 'Existing tag'"
          >#{{ t }}</span>
          <span v-if="o.negative" class="wp-ai-draft__neg" title="Negative">− <AiSyntax :text="o.negative" /></span>
        </li>
      </ul>
      <p v-for="w in result.warnings ?? []" :key="w" class="wp-ai-draft__warn" data-test="ai-draft-warning">
        <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ w }}
      </p>
      <p class="wp-ai-draft__summary">
        {{ result.options.length }} suggested<template v-if="skippedSummary"> · skipped {{ skippedSummary }}</template><template v-if="leftOffSummary"> · left off {{ leftOffSummary }}</template>
        <template v-if="result.new_tags.length"> · new tags (dashed) are created when you add</template>
      </p>
      <ul v-if="groups.length" class="wp-ai-draft__groups" data-test="ai-draft-groups">
        <li v-for="g in groups" :key="g.name">
          <strong>{{ g.name }}</strong> <span class="wp-ai-draft__group-kind">{{ g.kind === "accepts" ? "accepts" : "classify" }} group</span>{{ g.tags.length ? `: ${g.tags.join(", ")}` : " (made an accepts group)" }}
        </li>
      </ul>
      <div class="wp-ai-draft__actions">
        <Button variant="ghost" size="sm" data-test="ai-draft-discard" @click="convo.clear">Discard</Button>
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
  </AiPanelFrame>
</template>

<style scoped>
.wp-ai-draft__count { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--wp-text-muted); white-space: nowrap; }
.wp-ai-draft__count :deep(.wp-input-group) { width: 96px; flex: 0 0 auto; }
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
.wp-ai-draft__warn { margin: 0; font-size: 12px; color: var(--wp-warn); display: flex; gap: 6px; align-items: center; }
.wp-ai-draft__actions { display: flex; justify-content: flex-end; gap: 8px; }
.wp-ai-draft__groups { margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-draft__group-kind {
  padding: 0 6px;
  border-radius: 8px;
  background: var(--wp-surface-2, rgba(127, 127, 127, 0.15));
  font-size: 11px;
}
</style>
