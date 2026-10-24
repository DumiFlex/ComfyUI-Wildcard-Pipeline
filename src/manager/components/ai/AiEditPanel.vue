<script setup lang="ts">
/**
 * AiEditPanel — remove, rewrite, retag or re-weight existing wildcard options
 * with the user's model (`/wp/api/ai/wildcard/edit`).
 *
 * The editor passes the rows to edit (its selection, else every option) with
 * their real ids. The answer comes back as a before/after list, one checkbox
 * per change; "Apply" emits the ticked ones and the editor changes its draft.
 * Nothing is saved until the user presses Save.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../ui/Button.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import AiSyntax from "./AiSyntax.vue";
import { useAiImages } from "../../composables/useAiImages";
import { api } from "../../api/client";
import type {
  AiWildcardEditAction, AiWildcardEditChange, AiWildcardEditResult, WildcardOption,
} from "../../api/types";
import { keptNote, useAiConversation } from "../../composables/useAiConversation";

interface Props {
  /** The saved wildcard's id; unset for a new one. */
  moduleId?: string;
  action: AiWildcardEditAction;
  name: string;
  varBinding: string;
  /** The rows to edit. */
  options: WildcardOption[];
  /** True when `options` is the user's selection rather than the whole list. */
  fromSelection: boolean;
  existingTags: string[];
  /** The wildcard\'s description and library tags: what it is for. */
  description?: string;
  labels?: string[];
  tagGroups?: Record<string, string[]>;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "apply", changes: AiWildcardEditChange[]): void;
  (e: "cancel"): void;
  (e: "update:pending", pending: boolean): void;
}>();

const MAX_OPTIONS = 300;

const PLACEHOLDER: Record<AiWildcardEditAction, string> = {
  remove: "e.g. drop anything modern, or anything that isn't clothing",
  rewrite: "e.g. turn these into danbooru-style tags, or fix typos and make them shorter",
  retag: "e.g. tag each option with the seasons it suits",
  reweight: "e.g. make the plain everyday outfits more common and the fancy ones rare",
};
const VERB: Record<AiWildcardEditAction, string> = {
  remove: "Find options to remove", rewrite: "Rewrite", retag: "Suggest tags", reweight: "Suggest weights",
};

const unticked = ref<Set<number>>(new Set());

const editable = computed(() => props.options.filter((o) => !o.is_null && (o.value ?? "").trim()));
const tooMany = computed(() => editable.value.length > MAX_OPTIONS);
const scopeLabel = computed(() => {
  const n = editable.value.length;
  const what = `${n} option${n === 1 ? "" : "s"}`;
  return props.fromSelection ? `the ${what} you selected` : `all ${what}`;
});

type Ctx = { action: AiWildcardEditAction; rows: WildcardOption[]; tags: string[] };
const pics = useAiImages();
const convo = useAiConversation<AiWildcardEditResult, Ctx>({
  capture: () => ({ action: props.action, rows: editable.value, tags: props.existingTags }),
  send: ({ instruction, history, ctx, web, searched, skipped }, signal) => api.ai.editWildcard({
    action: ctx.action,
    instruction,
    history,
    images: pics.urls(),
    web,
    searched,
    skipped,
    wildcard: {
      ...(props.moduleId ? { id: props.moduleId } : {}),
      name: props.name,
      var_binding: props.varBinding,
      description: props.description ?? "",
      tags: props.labels ?? [],
      payload: {
        options: ctx.rows.map((o) => ({
          id: o.id, value: o.value, weight: o.weight ?? 1, sub_categories: o.sub_categories ?? [],
        })),
        sub_categories: ctx.tags,
        ...(props.tagGroups && Object.keys(props.tagGroups).length ? { tag_groups: props.tagGroups } : {}),
      },
    },
  }, signal),
  note: (res) => keptNote(res.changes.map(changeLabel), unticked.value),
  emptyMessage: (res) => res.changes.length ? "" : res.skipped.length
    ? "The model's suggestions couldn't be used. Try asking differently."
    : res.note ? `The model changed nothing: ${res.note}`
      : "The model didn't find anything to change.",
});
const { instruction, loading, error, result } = convo;
/** The chat's `use_panel` (see useAiConversation `chat`). */
defineExpose({ run: (text: string) => convo.chat(text) });
watch(result, () => { unticked.value = new Set(); });

const pending = computed(() => loading.value || (result.value?.changes.length ?? 0) > 0);
watch(pending, (v) => emit("update:pending", v), { immediate: true });
onBeforeUnmount(() => {
  convo.stop();
  emit("update:pending", false);
});
// A different action makes the old answer meaningless.
watch(() => props.action, () => { convo.clear(); });

const newTagSet = computed(() => new Set(result.value?.new_tags ?? []));
const ticked = computed<AiWildcardEditChange[]>(() =>
  (result.value?.changes ?? []).filter((_, i) => !unticked.value.has(i)),
);

function toggle(i: number): void {
  const next = new Set(unticked.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  unticked.value = next;
}

/** One change in words, for the follow-up note. */
function changeLabel(c: AiWildcardEditChange): string {
  const v = c.before.value ?? props.options.find((o) => o.id === c.option_id)?.value ?? "?";
  if (!c.after) return `remove "${v}"`;
  if (c.after.value !== undefined) return `"${v}" → "${c.after.value}"`;
  if (c.after.tags) return `"${v}" tags ${c.after.tags.join(", ") || "none"}`;
  return `"${v}" weight ${c.after.weight ?? 1}`;
}

function apply(): void {
  if (ticked.value.length === 0) return;
  emit("apply", ticked.value);
  convo.clear();
}

function cancel(): void {
  convo.stop();
  emit("cancel");
}

const applyLabel = computed(() => {
  const n = ticked.value.length;
  if (props.action === "remove") return `Remove ${n} option${n === 1 ? "" : "s"}`;
  return `Apply ${n} change${n === 1 ? "" : "s"}`;
});

const skippedSummary = computed(() => {
  const s = result.value?.skipped ?? [];
  if (!s.length) return "";
  const byReason = new Map<string, number>();
  for (const x of s) byReason.set(x.reason, (byReason.get(x.reason) ?? 0) + 1);
  return [...byReason].map(([r, n]) => `${n} ${r}`).join(", ");
});

function fmtWeight(w: number | undefined): string {
  return `×${w ?? 1}`;
}
</script>

<template>
  <AiPanelFrame
    v-model="instruction"
    :images="pics"
    class="wp-ai-edit"
    data-test="ai-edit-panel"
    bare
    :placeholder="PLACEHOLDER[action]"
    :verb="VERB[action]"
    hint="You review every change first."
    :blocked="tooMany || !editable.length"
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
    @close="cancel"
    :research="convo.research.value"
    :searching="convo.searching.value"
    :found="convo.web"
    @allow-research="convo.allowResearch"
    @skip-research="convo.skipResearch"
    @use-found="convo.useFound"
    @skip-found="convo.skipFound"
  >
    <template #top>
      <p class="wp-ai-edit__scope" data-test="ai-edit-scope">
        Works on {{ scopeLabel }}.
        <template v-if="!fromSelection">Select options first to work on just those.</template>
      </p>
      <p v-if="tooMany" class="wp-ai-edit__error" role="alert" data-test="ai-edit-too-many">
        That's more than {{ MAX_OPTIONS }} options. Select up to {{ MAX_OPTIONS }} and try again.
      </p>
    </template>
    <template v-if="result && result.changes.length">
      <ul class="wp-ai-edit__list" data-test="ai-edit-results">
        <li
          v-for="(c, i) in result.changes"
          :key="c.option_id"
          class="wp-ai-edit__row"
          :data-kind="action"
          :data-off="unticked.has(i) ? 'true' : 'false'"
        >
          <label class="wp-ai-edit__body" :for="`wp-ai-edit-${i}`">
            <input
              :id="`wp-ai-edit-${i}`"
              type="checkbox"
              class="wp-ai-edit__check"
              :checked="!unticked.has(i)"
              @change="toggle(i)"
            />
            <template v-if="action === 'remove'">
              <span class="wp-ai-edit__old" data-removed="true"><AiSyntax :text="c.before.value ?? ''" /></span>
              <span v-if="c.reason" class="wp-ai-edit__reason">{{ c.reason }}</span>
            </template>
            <template v-else-if="action === 'rewrite'">
              <span class="wp-ai-edit__old"><AiSyntax :text="c.before.value ?? ''" /></span>
              <i class="pi pi-arrow-right wp-ai-edit__arrow" aria-hidden="true" />
              <span class="wp-ai-edit__new"><AiSyntax :text="c.after?.value ?? ''" /></span>
            </template>
            <template v-else>
              <span class="wp-ai-edit__label"><AiSyntax :text="options.find((o) => o.id === c.option_id)?.value ?? ''" /></span>
              <span class="wp-ai-edit__delta">
                <template v-if="action === 'retag'">
                  <span v-if="!c.before.tags?.length" class="wp-ai-edit__none">no tags</span>
                  <span v-for="t in c.before.tags" :key="`b-${t}`" class="wp-ai-edit__tag" data-old="true">#{{ t }}</span>
                  <i class="pi pi-arrow-right wp-ai-edit__arrow" aria-hidden="true" />
                  <span v-if="!c.after?.tags?.length" class="wp-ai-edit__none">no tags</span>
                  <span
                    v-for="t in c.after?.tags"
                    :key="`a-${t}`"
                    class="wp-ai-edit__tag"
                    :data-new="newTagSet.has(t) ? 'true' : 'false'"
                    :title="newTagSet.has(t) ? 'New tag' : 'Existing tag'"
                  >#{{ t }}</span>
                </template>
                <template v-else>
                  <span class="wp-ai-edit__w" data-old="true">{{ fmtWeight(c.before.weight) }}</span>
                  <i class="pi pi-arrow-right wp-ai-edit__arrow" aria-hidden="true" />
                  <span class="wp-ai-edit__w">{{ fmtWeight(c.after?.weight) }}</span>
                </template>
              </span>
            </template>
          </label>
        </li>
      </ul>
      <p class="wp-ai-edit__summary">
        {{ result.changes.length }} change{{ result.changes.length === 1 ? "" : "s" }} suggested<template v-if="skippedSummary"> · skipped {{ skippedSummary }}</template>
        <template v-if="result.new_tags.length"> · new tags (dashed) are created when you apply</template>
      </p>
      <div class="wp-ai-edit__actions">
        <Button variant="ghost" size="sm" data-test="ai-edit-discard" @click="convo.clear">Discard</Button>
        <Button
          :variant="action === 'remove' ? 'danger' : 'primary'"
          size="sm"
          :icon="action === 'remove' ? 'pi-trash' : 'pi-check'"
          :disabled="ticked.length === 0"
          data-test="ai-edit-apply"
          @click="apply"
        >{{ applyLabel }}</Button>
      </div>
      <p class="wp-ai-edit__note">Nothing is saved until you press Save.</p>
    </template>
  </AiPanelFrame>
</template>

<style scoped>
.wp-ai-edit__scope { margin: 0; font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-edit__error { margin: 0; font-size: 12px; color: var(--wp-danger); }
.wp-ai-edit__list {
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
.wp-ai-edit__row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  border-top: 1px solid var(--wp-border);
  box-shadow: inset 3px 0 0 var(--wp-accent-500);
}
.wp-ai-edit__row[data-kind="remove"] { box-shadow: inset 3px 0 0 var(--wp-danger); }
.wp-ai-edit__row:first-child { border-top: 0; }
.wp-ai-edit__row[data-off="true"] { box-shadow: none; opacity: 0.5; }
.wp-ai-edit__check { accent-color: var(--wp-accent-500); }
.wp-ai-edit__body { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; cursor: pointer; }
.wp-ai-edit__old, .wp-ai-edit__new, .wp-ai-edit__label {
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.wp-ai-edit__old { color: var(--wp-text-muted); text-decoration: line-through; }
.wp-ai-edit__old[data-removed="true"] { color: var(--wp-danger-text, var(--wp-danger)); }
.wp-ai-edit__new, .wp-ai-edit__label { color: var(--wp-text); }
.wp-ai-edit__reason { font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-edit__reason::before { content: "· "; }
.wp-ai-edit__arrow { font-size: 10px; color: var(--wp-text-dim); }
.wp-ai-edit__delta { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-left: auto; }
.wp-ai-edit__none { font-size: 11px; color: var(--wp-text-dim); font-style: italic; }
.wp-ai-edit__tag {
  font-size: 11px;
  padding: 0 7px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--wp-success) 45%, transparent);
  color: var(--wp-success);
}
.wp-ai-edit__tag[data-new="true"] { border-style: dashed; border-color: var(--wp-accent-400); color: var(--wp-accent-text); }
.wp-ai-edit__tag[data-old="true"], .wp-ai-edit__w[data-old="true"] {
  color: var(--wp-text-dim);
  border-color: var(--wp-border);
  text-decoration: line-through;
}
.wp-ai-edit__w { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--wp-text); }
.wp-ai-edit__summary, .wp-ai-edit__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-edit__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
