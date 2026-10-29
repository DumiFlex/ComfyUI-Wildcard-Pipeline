<script setup lang="ts">
/**
 * AiDerivationPanel — derivation rules from a description
 * (`/wp/api/ai/derivation/draft`). The server lists the library's variables
 * and options for the model and checks every rule against the engine, so
 * what comes back can be appended as is. Each rule is shown in plain words
 * with a tick box; "Add" emits the ticked ones and the editor appends them.
 * A rule that changes one the module has ("add a branch for rogues")
 * carries `replaces`: it is marked "Changes rule N" with its new lines
 * marked, and the editor puts it in that rule's place. Nothing is saved
 * until the user presses Save.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../../../kit/Button.vue";
import Checkbox from "../../../kit/Checkbox.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import { useAiImages } from "../../composables/useAiImages";
import { api } from "../../api/client";
import type { AiDerivationDraftResult, DerivationRule } from "../../api/types";
import { changedLines, ruleLines } from "../../utils/ai-rule-text";
import { keptNote, useAiConversation } from "../../composables/useAiConversation";

const props = defineProps<{
  name: string;
  rules: DerivationRule[];
  /** The module's description and library tags: what it is for. */
  description?: string;
  labels?: string[];
}>();
const emit = defineEmits<{
  (e: "add", rules: DerivationRule[]): void;
  (e: "close"): void;
  (e: "update:pending", pending: boolean): void;
}>();

const unticked = ref<Set<number>>(new Set());

const pics = useAiImages();
const convo = useAiConversation<AiDerivationDraftResult, { rules: DerivationRule[] }>({
  capture: () => ({ rules: props.rules }),
  send: ({ instruction, history, ctx }, signal) => api.ai.draftDerivation({
    instruction,
    history,
    images: pics.urls(),
    derivation: {
      name: props.name, description: props.description ?? "", tags: props.labels ?? [],
      rules: ctx.rules,
    },
  }, signal),
  note: (res) => keptNote(res.rules.map((r) => r.summary), unticked.value),
  emptyMessage: (res) => res.rules.length ? "" : res.skipped.length
    ? "The model's rules couldn't be used. Try asking differently, or a larger model."
    : "The model didn't write any rules.",
});
const { instruction, loading, error, result } = convo;
/** The chat's `use_panel` (see useAiConversation `chat`). */
defineExpose({ run: (text: string) => convo.chat(text) });
watch(result, () => { unticked.value = new Set(); });

const pending = computed(() => loading.value || (result.value?.rules.length ?? 0) > 0);
watch(pending, (v) => emit("update:pending", v), { immediate: true });
onBeforeUnmount(() => {
  convo.stop();
  emit("update:pending", false);
});

const ticked = computed(() =>
  (result.value?.rules ?? []).filter((_, i) => !unticked.value.has(i)).map((r) => r.rule),
);

function toggle(i: number): void {
  const next = new Set(unticked.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  unticked.value = next;
}

/** For a rule that changes an existing one: its number and which lines
 *  are new. */
function changeOf(r: AiDerivationDraftResult["rules"][number]): { at: number; marks: boolean[] } | null {
  if (!r.replaces) return null;
  const at = props.rules.findIndex((x) => x.id === r.replaces);
  if (at < 0) return null;
  return { at: at + 1, marks: changedLines(props.rules[at], r.rule) };
}
const changes = computed(() => (result.value?.rules ?? []).map(changeOf));
const addLabel = computed(() => {
  const picked = (result.value?.rules ?? []).filter((_, i) => !unticked.value.has(i));
  const changed = picked.filter((_, i) => !!changes.value[i]).length;
  const added = picked.length - changed;
  const parts = [
    added ? `add ${added} rule${added === 1 ? "" : "s"}` : "",
    changed ? `change ${changed}` : "",
  ].filter(Boolean).join(", ");
  return parts.charAt(0).toUpperCase() + parts.slice(1) || "Add 0 rules";
});

function add(): void {
  if (!ticked.value.length) return;
  emit("add", ticked.value);
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
    placeholder="e.g. when $class is mage, set $title to Archmage and add robes; when it's a warrior, add a scar"
    verb="Write rules"
    scope="Knows every variable in your library."
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
    <template v-if="result && result.rules.length">
      <ul class="wp-ai-rules" data-test="ai-rules-results">
        <li
          v-for="(r, i) in result.rules"
          :key="r.rule.id"
          class="wp-ai-rules__rule"
          :data-off="unticked.has(i) ? 'true' : 'false'"
          data-test="ai-rule"
        >
          <label class="wp-ai-rules__head">
            <Checkbox class="wp-checkbox--inline wp-ai-rules__check" :model-value="!unticked.has(i)" @update:model-value="toggle(i)" />
            <span class="wp-ai-rules__summary">{{ r.summary }}</span>
            <span v-if="changes[i]" class="wp-ai-rules__changes" data-test="ai-rule-changes">Changes rule {{ changes[i]?.at }}</span>
          </label>
          <ol class="wp-ai-rules__lines">
            <li
              v-for="(line, li) in ruleLines(r.rule)"
              :key="li"
              :data-new="changes[i]?.marks[li] ? 'true' : 'false'"
              :title="changes[i]?.marks[li] ? 'New or changed in this rule' : undefined"
            >
              <span class="wp-ai-rules__lead">{{ line.lead }}</span>
              <span v-if="line.when" class="wp-ai-rules__when">{{ line.when }}</span>
              <span class="wp-ai-rules__then">
                <span v-for="(t, ti) in line.then" :key="ti" class="wp-ai-rules__act">{{ t }}</span>
              </span>
            </li>
          </ol>
          <p v-for="w in r.warnings" :key="w" class="wp-ai-rules__warn" data-test="ai-rule-warning">
            <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ w }}
          </p>
        </li>
      </ul>
      <p class="wp-ai-rules__note">
        {{ result.rules.length }} rule{{ result.rules.length === 1 ? "" : "s" }} written<template v-if="result.skipped.length"> · skipped {{ result.skipped.length }} that couldn't be used ({{ result.skipped.map((s) => s.reason).join("; ") }})</template>
      </p>
      <div class="wp-ai-rules__actions">
        <Button variant="ghost" size="sm" data-test="ai-discard" @click="convo.clear">Discard</Button>
        <Button
          variant="primary"
          size="sm"
          icon="pi-plus"
          :disabled="!ticked.length"
          data-test="ai-apply"
          @click="add"
        >{{ addLabel }}</Button>
      </div>
      <p class="wp-ai-rules__note">
        New rules go to the end of the list<template v-if="changes.some(Boolean)">; a changed rule stays in its place, with its lines kept</template>. Nothing is saved until you press Save.
      </p>
    </template>
  </AiPanelFrame>
</template>

<style scoped>
.wp-ai-rules {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
  overscroll-behavior: contain;
}
.wp-ai-rules__rule {
  border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-1);
  padding: 8px 10px;
  box-shadow: inset 3px 0 0 var(--wp-accent-500);
}
.wp-ai-rules__rule[data-off="true"] { box-shadow: none; opacity: 0.5; }
.wp-ai-rules__head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.wp-ai-rules__summary { font-weight: 600; font-size: 13px; color: var(--wp-text); }
.wp-ai-rules__lines { list-style: none; margin: 6px 0 0 24px; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.wp-ai-rules__lines > li { display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; font-size: 12px; }
.wp-ai-rules__changes {
  margin-left: auto;
  font-size: 10px;
  padding: 0 6px;
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  background: var(--wp-surface-2, rgba(127, 127, 127, 0.15));
  color: var(--wp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.wp-ai-rules__lines > li { position: relative; }
.wp-ai-rules__lines > li[data-new="true"]::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 2px;
  bottom: 2px;
  width: 3px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  background: var(--wp-success);
}
.wp-ai-rules__lines > li[data-new="true"] .wp-ai-rules__lead { color: var(--wp-success); }
.wp-ai-rules__lead { font-weight: 700; font-size: 11px; color: var(--wp-accent-text); min-width: 52px; }
.wp-ai-rules__when { font-family: var(--wp-font-mono, monospace); color: var(--wp-text); overflow-wrap: anywhere; }
.wp-ai-rules__when::after { content: " →"; color: var(--wp-text-dim); }
.wp-ai-rules__then { display: inline-flex; flex-direction: column; gap: 2px; }
.wp-ai-rules__act { font-family: var(--wp-font-mono, monospace); color: var(--wp-text-muted); overflow-wrap: anywhere; }
.wp-ai-rules__warn { margin: 6px 0 0 24px; font-size: 12px; color: var(--wp-warn); display: flex; gap: 6px; align-items: center; }
.wp-ai-rules__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-rules__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
