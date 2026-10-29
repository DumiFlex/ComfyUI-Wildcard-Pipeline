<script setup lang="ts">
/**
 * AiConstraintPanel — constraint rules from a description
 * (`/wp/api/ai/constraint/draft`). The server shows the model both
 * wildcards' options and tags; tag pairs come back as matrix cells, option
 * pairs as exceptions (a tag paired with one option becomes one exception
 * per option). Each is a tick box; "Apply" emits the ticked ones and the
 * editor writes them into its matrix and exceptions, replacing a rule the
 * same pair already had. Nothing is saved until the user presses Save.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../../../kit/Button.vue";
import Checkbox from "../../../kit/Checkbox.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import { useAiImages } from "../../composables/useAiImages";
import ConstraintPreview from "../ConstraintPreview.vue";
import WpSegmented, { type SegmentedOption } from "@/kit/WpSegmented.vue";
import { mergeAiRules, type PreviewWildcard } from "../../utils/constraint-preview";
import { api } from "../../api/client";
import { keptNote, useAiConversation } from "../../composables/useAiConversation";
import type {
  AiConstraintCellDraft, AiConstraintDraftResult, AiConstraintExceptionDraft,
  ConstraintException, ConstraintMatrix, ConstraintMode,
} from "../../api/types";

const props = defineProps<{
  sourceWildcardId: string;
  targetWildcardId: string;
  sourceName: string;
  targetName: string;
  matrix: ConstraintMatrix;
  exceptions: ConstraintException[];
  /** The two wildcards, for the preview of what the rules change. */
  sourcePayload?: PreviewWildcard;
  targetPayload?: PreviewWildcard;
  /** The constraint's own name, description and library tags. */
  name?: string;
  description?: string;
  labels?: string[];
}>();
const emit = defineEmits<{
  (e: "apply", cells: AiConstraintCellDraft[], exceptions: AiConstraintExceptionDraft[]): void;
  (e: "close"): void;
  (e: "update:pending", pending: boolean): void;
}>();

const MODE_LABEL: Record<ConstraintMode, string> = {
  allow: "Allow", exclude: "Exclude", boost: "Boost", reduce: "Reduce", only: "Only",
};

/** Unticked rows, keyed "c:i" for cells and "e:i" for exceptions. */
const unticked = ref<Set<string>>(new Set());

type Ctx = { matrix: ConstraintMatrix; exceptions: ConstraintException[] };
const pics = useAiImages();
const convo = useAiConversation<AiConstraintDraftResult, Ctx>({
  capture: () => ({ matrix: props.matrix, exceptions: props.exceptions }),
  send: ({ instruction, history, ctx }, signal) => api.ai.draftConstraint({
    instruction,
    history,
    images: pics.urls(),
    constraint: {
      name: props.name ?? "",
      description: props.description ?? "",
      tags: props.labels ?? [],
      source_wildcard_id: props.sourceWildcardId,
      target_wildcard_id: props.targetWildcardId,
      matrix: ctx.matrix,
      exceptions: ctx.exceptions,
    },
  }, signal),
  note: (res) => {
    const labels = [
      ...res.cells.map((c) => `#${c.source_tag} → #${c.target_tag} ${c.cell.mode}`),
      ...res.exceptions.map((e) => `${shown(e.exception.source)} → ${shown(e.exception.target)} ${e.exception.mode}`),
    ];
    const off = new Set<number>();
    res.cells.forEach((_, i) => { if (unticked.value.has(`c:${i}`)) off.add(i); });
    res.exceptions.forEach((_, i) => { if (unticked.value.has(`e:${i}`)) off.add(res.cells.length + i); });
    return keptNote(labels, off);
  },
  emptyMessage: (res) => res.cells.length + res.exceptions.length ? "" : res.skipped.length
    ? "The model's rules couldn't be used. Try asking differently, or a larger model."
    : "The model didn't write any rules.",
});
const { instruction, loading, error, result } = convo;
/** The chat's `use_panel` (see useAiConversation `chat`). */
defineExpose({ run: (text: string) => convo.chat(text) });
watch(result, () => { unticked.value = new Set(); });

const count = computed(() => (result.value?.cells.length ?? 0) + (result.value?.exceptions.length ?? 0));
const pending = computed(() => loading.value || count.value > 0);
watch(pending, (v) => emit("update:pending", v), { immediate: true });
onBeforeUnmount(() => {
  convo.stop();
  emit("update:pending", false);
});
// A different pair of wildcards makes the old answer meaningless.
watch(() => [props.sourceWildcardId, props.targetWildcardId], () => { convo.clear(); });

const tickedCells = computed(() => (result.value?.cells ?? []).filter((_, i) => !unticked.value.has(`c:${i}`)));
const tickedExceptions = computed(() =>
  (result.value?.exceptions ?? []).filter((_, i) => !unticked.value.has(`e:${i}`)),
);
const tickedCount = computed(() => tickedCells.value.length + tickedExceptions.value.length);

type View = "rules" | "preview";
const VIEWS: SegmentedOption<View>[] = [
  { value: "rules", label: "Rules", icon: "pi-list" },
  { value: "preview", label: "Preview", icon: "pi-table" },
];
const view = ref<View>("rules");
const canPreview = computed(() => !!props.sourcePayload && !!props.targetPayload);
const after = computed(() =>
  mergeAiRules(props.matrix, props.exceptions, tickedCells.value, tickedExceptions.value),
);

function toggle(key: string): void {
  const next = new Set(unticked.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  unticked.value = next;
}

function apply(): void {
  if (!tickedCount.value) return;
  emit("apply", tickedCells.value, tickedExceptions.value);
  convo.clear();
}

function close(): void {
  convo.stop();
  emit("close");
}

function factorText(mode: ConstraintMode, factor: number): string {
  return mode === "boost" || mode === "reduce" ? ` ×${factor}` : "";
}
function shown(v: string): string {
  return v === "" ? "⌀ null" : v;
}
</script>

<template>
  <AiPanelFrame
    v-model="instruction"
    :images="pics"
    placeholder="e.g. mages never carry swords, warriors rarely get staves, and the crystal staff only goes with mages"
    verb="Write rules"
    :scope="`${sourceName || 'Source'} → ${targetName || 'Target'}`"
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
  >
    <template v-if="result && count">
      <WpSegmented
        v-if="canPreview"
        v-model="view"
        :options="VIEWS"
        aria-label="Show the rules or a preview"
        test-prefix="ai-cn-view"
      />
      <ConstraintPreview
        v-if="view === 'preview' && sourcePayload && targetPayload"
        :source="sourcePayload"
        :target="targetPayload"
        :matrix="after.matrix"
        :exceptions="after.exceptions"
        :before="{ matrix, exceptions }"
      />
      <ul v-show="view === 'rules' || !canPreview" class="wp-ai-cn" data-test="ai-constraint-results">
        <li v-if="result.cells.length" class="wp-ai-cn__group">Rule matrix (tags)</li>
        <li
          v-for="(c, i) in result.cells"
          :key="`c${i}`"
          class="wp-ai-cn__row"
          :data-mode="c.cell.mode"
          :data-off="unticked.has(`c:${i}`) ? 'true' : 'false'"
          data-test="ai-cn-cell"
        >
          <label class="wp-ai-cn__body">
            <Checkbox class="wp-checkbox--inline wp-ai-cn__check" :model-value="!unticked.has(`c:${i}`)" @update:model-value="toggle(`c:${i}`)" />
            <span class="wp-ai-cn__tag">#{{ c.source_tag }}</span>
            <i class="pi pi-arrow-right wp-ai-cn__arrow" aria-hidden="true" />
            <span class="wp-ai-cn__tag">#{{ c.target_tag }}</span>
            <span class="wp-ai-cn__mode">{{ MODE_LABEL[c.cell.mode] }}{{ factorText(c.cell.mode, c.cell.factor) }}</span>
            <span v-if="c.replaces" class="wp-ai-cn__replaces" title="This pair already has a rule">replaces</span>
            <span v-if="c.reason" class="wp-ai-cn__reason">{{ c.reason }}</span>
          </label>
        </li>
        <li v-if="result.exceptions.length" class="wp-ai-cn__group">Exceptions (options)</li>
        <li
          v-for="(e, i) in result.exceptions"
          :key="`e${i}`"
          class="wp-ai-cn__row"
          :data-mode="e.exception.mode"
          :data-off="unticked.has(`e:${i}`) ? 'true' : 'false'"
          data-test="ai-cn-exception"
        >
          <label class="wp-ai-cn__body">
            <Checkbox class="wp-checkbox--inline wp-ai-cn__check" :model-value="!unticked.has(`e:${i}`)" @update:model-value="toggle(`e:${i}`)" />
            <span class="wp-ai-cn__opt">{{ shown(e.exception.source) }}</span>
            <i class="pi pi-arrow-right wp-ai-cn__arrow" aria-hidden="true" />
            <span class="wp-ai-cn__opt">{{ shown(e.exception.target) }}</span>
            <span class="wp-ai-cn__mode">{{ MODE_LABEL[e.exception.mode] }}{{ factorText(e.exception.mode, e.exception.factor) }}</span>
            <span v-if="e.replaces" class="wp-ai-cn__replaces" title="This pair already has an exception">replaces</span>
            <span v-if="e.reason" class="wp-ai-cn__reason">{{ e.reason }}</span>
            <span v-if="e.from" class="wp-ai-cn__reason">from {{ e.from }}</span>
          </label>
        </li>
      </ul>
      <p v-if="result.skipped.length" class="wp-ai-cn__note">
        Skipped {{ result.skipped.length }}: {{ result.skipped.map((s) => `${s.text} (${s.reason})`).join("; ") }}
      </p>
      <div class="wp-ai-cn__actions">
        <Button variant="ghost" size="sm" data-test="ai-discard" @click="convo.clear">Discard</Button>
        <Button
          variant="primary"
          size="sm"
          icon="pi-check"
          :disabled="!tickedCount"
          data-test="ai-apply"
          @click="apply"
        >Apply {{ tickedCount }} rule{{ tickedCount === 1 ? "" : "s" }}</Button>
      </div>
      <p class="wp-ai-cn__note">Nothing is saved until you press Save.</p>
    </template>
  </AiPanelFrame>
</template>

<style scoped>
.wp-ai-cn {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 360px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-1);
}
.wp-ai-cn__group {
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-dim);
  background: var(--wp-bg-2);
}
.wp-ai-cn__row { padding: 6px 10px; border-top: 1px solid var(--wp-border); box-shadow: inset 3px 0 0 var(--wp-accent-500); }
.wp-ai-cn__row[data-mode="exclude"] { box-shadow: inset 3px 0 0 var(--wp-danger); }
.wp-ai-cn__row[data-mode="boost"] { box-shadow: inset 3px 0 0 var(--wp-success); }
.wp-ai-cn__row[data-mode="reduce"] { box-shadow: inset 3px 0 0 var(--wp-warn); }
.wp-ai-cn__row[data-off="true"] { box-shadow: none; opacity: 0.5; }
.wp-ai-cn__body { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; cursor: pointer; }
.wp-ai-cn__tag {
  font-size: 11px;
  padding: 0 7px;
  border-radius: min(10px, var(--wp-radius-cap, 999px));
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  color: var(--wp-accent-text);
}
.wp-ai-cn__opt { font-family: var(--wp-font-mono, monospace); font-size: 12px; color: var(--wp-text); overflow-wrap: anywhere; }
.wp-ai-cn__arrow { font-size: 10px; color: var(--wp-text-dim); }
.wp-ai-cn__mode { font-size: 12px; font-weight: 600; color: var(--wp-text); margin-left: 4px; }
.wp-ai-cn__replaces {
  font-size: 10px;
  padding: 0 6px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  color: var(--wp-warn);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 45%, transparent);
}
.wp-ai-cn__reason { font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-cn__reason::before { content: "· "; }
.wp-ai-cn__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-cn__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
