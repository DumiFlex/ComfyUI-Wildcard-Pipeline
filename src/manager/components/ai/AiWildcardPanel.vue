<script setup lang="ts">
/**
 * AiWildcardPanel — the wildcard editor's AI panel: Add (AiDraftPanel) plus
 * the four edits (AiEditPanel). Both stay mounted (v-show) so switching tabs
 * doesn't lose a draft the user is still reviewing.
 */
import { computed, nextTick, ref, watch } from "vue";
import SegControl, { type SegOption } from "../settings/SegControl.vue";
import AiDraftPanel from "./AiDraftPanel.vue";
import AiEditPanel from "./AiEditPanel.vue";
import type { AiWildcardEditAction, AiWildcardEditChange, WildcardOption } from "../../api/types";
import type { ParsedBulkOption } from "../../utils/bulkParse";
import { useAiConfig } from "../../composables/useAiConfig";

type Mode = "add" | AiWildcardEditAction;

interface Props {
  name: string;
  varBinding: string;
  options: WildcardOption[];
  /** Ids of the options the user selected; the edits work on those when set. */
  selectedIds: Set<string>;
  existingTags: string[];
  tagGroups?: Record<string, string[]>;
  /** The wildcard's description and library tags: what it is for. */
  description?: string;
  labels?: string[];
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "commit-options", payload: ParsedBulkOption[]): void;
  (e: "apply-edits", action: AiWildcardEditAction, changes: AiWildcardEditChange[]): void;
  (e: "cancel"): void;
  (e: "update:pending", pending: boolean): void;
}>();

const MODES: SegOption<Mode>[] = [
  { value: "add", label: "Add", icon: "pi-plus" },
  { value: "remove", label: "Remove", icon: "pi-trash" },
  { value: "rewrite", label: "Rewrite", icon: "pi-pencil" },
  { value: "retag", label: "Retag", icon: "pi-tag" },
  { value: "reweight", label: "Weights", icon: "pi-sliders-h" },
];

const mode = ref<Mode>("add");
const editAction = ref<AiWildcardEditAction>("remove");
watch(mode, (m) => { if (m !== "add") editAction.value = m; });

const { config } = useAiConfig();
const modelLabel = computed(() => config.value?.model ?? "");
const isLocal = computed(() => {
  const c = config.value;
  return c ? c.local ?? c.presets[c.provider].local : true;
});

const editRows = computed(() => {
  if (props.selectedIds.size === 0) return props.options;
  return props.options.filter((o) => typeof o.id === "string" && props.selectedIds.has(o.id));
});

const draftPending = ref(false);
const editPending = ref(false);
watch(() => draftPending.value || editPending.value, (v) => emit("update:pending", v), { immediate: true });

function onApply(changes: AiWildcardEditChange[]): void {
  emit("apply-edits", editAction.value, changes);
}

const drafter = ref<InstanceType<typeof AiDraftPanel> | null>(null);

/** Draft options on the Add tab (the chat's `draft_options`). */
async function draft(instruction: string, count: number): Promise<string> {
  mode.value = "add";
  await nextTick();
  return drafter.value ? drafter.value.run(instruction, count) : "couldn't: the Add tab didn't open";
}

const editor = ref<InstanceType<typeof AiEditPanel> | null>(null);

/** One of the edits (the chat's `use_panel`): switch to its tab and ask. It
 *  works on the selected options, or all of them when none are. */
async function edit(action: AiWildcardEditAction, text: string): Promise<string> {
  mode.value = action;
  await nextTick();
  return editor.value ? editor.value.run(text) : "couldn't: the edit tab didn't open";
}

defineExpose({ draft, edit });
</script>

<template>
  <div class="wp-ai-panel" data-test="ai-wildcard-panel">
    <div class="wp-ai-panel__head">
      <span class="wp-ai-panel__title"><i class="pi pi-microchip-ai" aria-hidden="true" /> AI</span>
      <SegControl v-model="mode" :options="MODES" aria-label="What should the AI do?" test-prefix="ai-mode" />
      <span
        class="wp-ai-panel__model"
        :data-local="isLocal ? 'true' : 'false'"
        :title="isLocal ? 'Runs on your machine' : 'Sent to a cloud provider'"
      >{{ modelLabel }}</span>
    </div>
    <AiDraftPanel
      v-show="mode === 'add'"
      ref="drafter"
      :name="name"
      :var-binding="varBinding"
      :existing-values="options.map((o) => o.value)"
      :existing-tags="existingTags"
      :tag-groups="tagGroups"
      :description="description"
      :labels="labels"
      @commit-options="(p: ParsedBulkOption[]) => emit('commit-options', p)"
      @cancel="emit('cancel')"
      @update:pending="(v: boolean) => (draftPending = v)"
    />
    <AiEditPanel
      v-show="mode !== 'add'"
      ref="editor"
      :action="editAction"
      :name="name"
      :var-binding="varBinding"
      :options="editRows"
      :from-selection="selectedIds.size > 0"
      :existing-tags="existingTags"
      :tag-groups="tagGroups"
      :description="description"
      :labels="labels"
      @apply="onApply"
      @cancel="emit('cancel')"
      @update:pending="(v: boolean) => (editPending = v)"
    />
  </div>
</template>

<style scoped>
.wp-ai-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 40%, var(--wp-border));
  border-radius: 8px;
  background: color-mix(in oklab, var(--wp-accent-500) 5%, var(--wp-bg-2));
}
.wp-ai-panel__head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wp-ai-panel__title { font-weight: 600; color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; }
.wp-ai-panel__model {
  margin-left: auto;
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 5px;
  color: var(--wp-warn);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 45%, transparent);
}
.wp-ai-panel__model[data-local="true"] { color: var(--wp-success); border-color: color-mix(in oklab, var(--wp-success) 45%, transparent); }
</style>
