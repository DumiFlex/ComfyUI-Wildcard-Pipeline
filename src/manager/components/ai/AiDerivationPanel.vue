<script setup lang="ts">
/**
 * AiDerivationPanel — derivation rules from a description
 * (`/wp/api/ai/derivation/draft`). The server lists the library's variables
 * and options for the model and checks every rule against the engine, so
 * what comes back can be appended as is. Each rule is shown in plain words
 * with a tick box; "Add" emits the ticked ones and the editor appends them.
 * Nothing is saved until the user presses Save.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "../ui/Button.vue";
import AiPanelFrame from "./AiPanelFrame.vue";
import { api, ApiError } from "../../api/client";
import type { AiDerivationDraftResult, DerivationRule } from "../../api/types";
import { ruleLines } from "../../utils/ai-rule-text";

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

const instruction = ref("");
const loading = ref(false);
const error = ref("");
const result = ref<AiDerivationDraftResult | null>(null);
const unticked = ref<Set<number>>(new Set());
let controller: AbortController | null = null;

const pending = computed(() => loading.value || (result.value?.rules.length ?? 0) > 0);
watch(pending, (v) => emit("update:pending", v), { immediate: true });
onBeforeUnmount(() => {
  controller?.abort();
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

async function run(): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = "";
  result.value = null;
  unticked.value = new Set();
  try {
    result.value = await api.ai.draftDerivation({
      instruction: instruction.value.trim(),
      derivation: {
        name: props.name, description: props.description ?? "", tags: props.labels ?? [],
        rules: props.rules,
      },
    }, controller.signal);
    if (result.value.rules.length === 0) {
      error.value = result.value.skipped.length
        ? "The model's rules couldn't be used. Try asking differently, or a larger model."
        : "The model didn't write any rules.";
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

function add(): void {
  if (!ticked.value.length) return;
  emit("add", ticked.value);
  result.value = null;
}

function discard(): void {
  result.value = null;
  error.value = "";
}

function close(): void {
  controller?.abort();
  emit("close");
}
</script>

<template>
  <AiPanelFrame
    v-model="instruction"
    placeholder="e.g. when $class is mage, set $title to Archmage and add robes; when it's a warrior, add a scar"
    verb="Write rules"
    scope="Knows every variable in your library."
    :loading="loading"
    :answered="!!result"
    :error="error"
    @run="run"
    @stop="stop"
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
          <label class="wp-ai-rules__head" :for="`wp-ai-rule-${i}`">
            <input
              :id="`wp-ai-rule-${i}`"
              type="checkbox"
              class="wp-ai-rules__check"
              :checked="!unticked.has(i)"
              @change="toggle(i)"
            />
            <span class="wp-ai-rules__summary">{{ r.summary }}</span>
          </label>
          <ol class="wp-ai-rules__lines">
            <li v-for="(line, li) in ruleLines(r.rule)" :key="li">
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
        <Button variant="ghost" size="sm" data-test="ai-discard" @click="discard">Discard</Button>
        <Button
          variant="primary"
          size="sm"
          icon="pi-plus"
          :disabled="!ticked.length"
          data-test="ai-apply"
          @click="add"
        >Add {{ ticked.length }} rule{{ ticked.length === 1 ? "" : "s" }}</Button>
      </div>
      <p class="wp-ai-rules__note">They go to the end of the list. Nothing is saved until you press Save.</p>
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
  border-radius: 6px;
  background: var(--wp-bg-1);
  padding: 8px 10px;
  box-shadow: inset 3px 0 0 var(--wp-accent-500);
}
.wp-ai-rules__rule[data-off="true"] { box-shadow: none; opacity: 0.5; }
.wp-ai-rules__head { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.wp-ai-rules__check { accent-color: var(--wp-accent-500); }
.wp-ai-rules__summary { font-weight: 600; font-size: 13px; color: var(--wp-text); }
.wp-ai-rules__lines { list-style: none; margin: 6px 0 0 24px; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.wp-ai-rules__lines > li { display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; font-size: 12px; }
.wp-ai-rules__lead { font-weight: 700; font-size: 11px; color: var(--wp-accent-text); min-width: 52px; }
.wp-ai-rules__when { font-family: var(--wp-font-mono, monospace); color: var(--wp-text); overflow-wrap: anywhere; }
.wp-ai-rules__when::after { content: " →"; color: var(--wp-text-dim); }
.wp-ai-rules__then { display: inline-flex; flex-direction: column; gap: 2px; }
.wp-ai-rules__act { font-family: var(--wp-font-mono, monospace); color: var(--wp-text-muted); overflow-wrap: anywhere; }
.wp-ai-rules__warn { margin: 6px 0 0 24px; font-size: 12px; color: var(--wp-warn); display: flex; gap: 6px; align-items: center; }
.wp-ai-rules__note { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-rules__actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
