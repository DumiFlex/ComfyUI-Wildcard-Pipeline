<script setup lang="ts">
/**
 * BulkAddPanel — inline paste-to-add panel for the bulk editor.
 *
 * Two modes:
 *   options — wildcard options, one per line: `value [#tag …] [*N]`
 *             (#tag = sub-category, auto-created if new; *N = weight).
 *   values  — fixed values, one per line: `name = value`
 *             (existing names update in place, new names append).
 *
 * Presentational only: parses + previews, emits the reconciled payload on
 * commit. The host editor owns the actual mutation (addOption / addValue) so
 * snapshot/dirty tracking stays in one place.
 */
import { computed, ref } from "vue";
import Button from "./ui/Button.vue";
import {
  parseBulkOptions,
  summarizeBulkOptions,
  parseBulkFixedValues,
  type ParsedBulkOption,
  type ParsedFixedValue,
} from "../utils/bulkParse";

interface Props {
  mode: "options" | "values";
  /** options: existing option values · values: existing value NAMES. */
  existingValues: string[];
  /** options mode only — existing sub-category tags (for new-tag detection). */
  existingTags?: string[];
}
const props = withDefaults(defineProps<Props>(), { existingTags: () => [] });

const emit = defineEmits<{
  (e: "commit-options", payload: ParsedBulkOption[]): void;
  (e: "commit-values", payload: ParsedFixedValue[]): void;
  (e: "cancel"): void;
}>();

const text = ref("");

const lowerValues = computed(() => new Set(props.existingValues.map((v) => v.toLowerCase())));
const lowerTags = computed(() => new Set(props.existingTags.map((t) => t.toLowerCase())));

// --- options mode ---------------------------------------------------------
const optionsSummary = computed(() =>
  summarizeBulkOptions(parseBulkOptions(text.value), lowerValues.value, lowerTags.value),
);

// --- values mode ----------------------------------------------------------
// Fold by name (last line wins), then split into update (name exists) / new.
const foldedValues = computed<ParsedFixedValue[]>(() => {
  const byName = new Map<string, ParsedFixedValue>();
  for (const v of parseBulkFixedValues(text.value)) byName.set(v.name, v);
  return [...byName.values()];
});
const valuesUpdate = computed(() => foldedValues.value.filter((v) => lowerValues.value.has(v.name.toLowerCase())).length);
const valuesNew = computed(() => foldedValues.value.length - valuesUpdate.value);

const addCount = computed(() =>
  props.mode === "options" ? optionsSummary.value.add.length : foldedValues.value.length,
);
const canCommit = computed(() => addCount.value > 0);

function commit() {
  if (!canCommit.value) return;
  if (props.mode === "options") emit("commit-options", optionsSummary.value.add);
  else emit("commit-values", foldedValues.value);
  text.value = "";
}
function cancel() {
  text.value = "";
  emit("cancel");
}
</script>

<template>
  <div class="wpc-bulk-panel">
    <div class="wpc-bulk-panel__hint">
      <template v-if="mode === 'options'">
        One option per line. Append <code>#tag</code> for a sub-category (auto-created if new) and
        <code>*N</code> for a weight — e.g. <code>radiant #warm #vivid *2</code>. A <code>#</code>
        mid-text stays in the value.
      </template>
      <template v-else>
        One value per line as <code>name = value</code>. Existing names update in place; new names
        are appended.
      </template>
    </div>

    <textarea
      v-model="text"
      class="wp-textarea wpc-bulk-panel__input"
      rows="6"
      :placeholder="mode === 'options' ? 'serene\nradiant #warm *2\nbrooding #cool' : 'cfg = 4.5\nsteps = 30'"
      aria-label="Bulk paste"
    ></textarea>

    <!-- live preview -->
    <div class="wpc-bulk-panel__preview" aria-live="polite">
      <template v-if="mode === 'options'">
        <span class="wp-chip wp-chip--accent">{{ optionsSummary.add.length }} new</span>
        <span v-if="optionsSummary.tagged" class="wp-chip">{{ optionsSummary.tagged }} tagged</span>
        <span v-if="optionsSummary.weighted" class="wp-chip">{{ optionsSummary.weighted }} weighted</span>
        <span v-if="optionsSummary.duplicates" class="wp-chip wp-chip--muted">{{ optionsSummary.duplicates }} duplicate skipped</span>
        <template v-if="optionsSummary.newTags.length">
          <span class="wpc-bulk-panel__sep">·</span>
          <span class="wpc-bulk-panel__newtags-label">auto-create:</span>
          <span v-for="t in optionsSummary.newTags" :key="t" class="wp-chip wp-chip--warn">#{{ t }}</span>
        </template>
      </template>
      <template v-else>
        <span class="wp-chip wp-chip--accent">{{ valuesNew }} new</span>
        <span v-if="valuesUpdate" class="wp-chip">{{ valuesUpdate }} updated</span>
      </template>
    </div>

    <div class="wpc-bulk-panel__actions">
      <Button variant="ghost" size="sm" @click="cancel">Cancel</Button>
      <Button variant="primary" size="sm" icon="pi-plus" :disabled="!canCommit" @click="commit">
        {{ mode === "options" ? `Add ${addCount} option${addCount === 1 ? "" : "s"}` : `Apply ${addCount} value${addCount === 1 ? "" : "s"}` }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
.wpc-bulk-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--wp-border);
  border-radius: 8px;
  background: var(--wp-bg-2);
}
.wpc-bulk-panel__hint {
  font-size: 12px;
  line-height: 1.5;
  color: var(--wp-text-muted);
}
.wpc-bulk-panel__hint code {
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wpc-bulk-panel__input {
  width: 100%;
  resize: vertical;
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
}
.wpc-bulk-panel__preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 24px;
}
.wpc-bulk-panel__sep { color: var(--wp-border); }
.wpc-bulk-panel__newtags-label { font-size: 12px; color: var(--wp-text-muted); }
.wp-chip--muted { color: var(--wp-text-muted); background: var(--wp-bg-3); border-color: var(--wp-border); }
.wpc-bulk-panel__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
