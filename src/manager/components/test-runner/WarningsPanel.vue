<script setup lang="ts">
/**
 * Warnings tab: engine warnings grouped by type + message, with how many
 * runs raised each and the first seeds it happened on (click one to open
 * its trace). Messages may carry `@{uuid}` refs, rendered as name chips.
 */
import type { ScenarioRunResponse } from "../../api/types";
import RichTextPreview from "../RichTextPreview.vue";

defineProps<{
  result: ScenarioRunResponse;
  uuidToName: Map<string, string>;
}>();
const emit = defineEmits<{ (e: "open", seed: number): void }>();

function label(type: string): string {
  return type.replace(/_/g, " ");
}
</script>

<template>
  <div class="wp-trw" data-test="warnings-panel">
    <div v-if="!result.warnings.length && !result.failed" class="wp-trw__empty">
      <strong>No warnings in {{ result.runs }} runs</strong>
      <span>When the engine reports something, such as a constraint that never applied, a pool that excluded every option or a missing @ref, it appears here with the seeds it happened on.</span>
    </div>
    <div v-if="result.failed" class="wp-trw__item" data-severity="error">
      <div class="wp-trw__head"><span class="wp-trw__type">run failed</span><span class="wp-trw__count">{{ result.failed }} run{{ result.failed === 1 ? "" : "s" }}</span></div>
      <p>The engine raised an error on these seeds. The Samples tab shows the message.</p>
    </div>
    <div v-for="(w, i) in result.warnings" :key="i" class="wp-trw__item" data-test="warning">
      <div class="wp-trw__head">
        <span class="wp-trw__type">{{ label(w.type) }}</span>
        <span class="wp-trw__count">{{ w.count }} of {{ result.runs }} runs</span>
      </div>
      <RichTextPreview :value="w.message" :uuid-to-name="uuidToName" surface="wildcard" />
      <div class="wp-trw__seeds">
        <span>Seeds:</span>
        <button v-for="s in w.seeds" :key="s" type="button" @click="emit('open', s)">{{ s }}</button>
        <span v-if="w.count > w.seeds.length">and {{ w.count - w.seeds.length }} more</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-trw { display: flex; flex-direction: column; gap: var(--wp-space-5); }
.wp-trw__empty {
  display: flex; flex-direction: column; align-items: center; gap: var(--wp-space-3);
  padding: var(--wp-space-8); text-align: center; color: var(--wp-text-muted); font-size: var(--wp-text-sm);
}
.wp-trw__empty strong { color: var(--wp-text); }
.wp-trw__item {
  background: var(--wp-bg-1); border: 1px solid var(--wp-border); border-left: 3px solid var(--wp-warn);
  border-radius: var(--wp-radius-sm); padding: var(--wp-space-5) var(--wp-space-6);
  display: flex; flex-direction: column; gap: var(--wp-space-3); font-size: var(--wp-text-sm);
}
.wp-trw__item[data-severity="error"] { border-left-color: var(--wp-danger); }
.wp-trw__item p { margin: 0; color: var(--wp-text-muted); }
.wp-trw__head { display: flex; justify-content: space-between; gap: var(--wp-space-5); }
.wp-trw__type { font: var(--wp-weight-medium) var(--wp-text-xs) var(--wp-font-mono); color: var(--wp-warn); text-transform: uppercase; letter-spacing: .04em; }
.wp-trw__item[data-severity="error"] .wp-trw__type { color: var(--wp-danger-text); }
.wp-trw__count { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trw__seeds { display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-2); font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trw__seeds button {
  font: var(--wp-text-xs) var(--wp-font-mono); cursor: pointer;
  background: var(--wp-bg-3); color: var(--wp-text-muted); border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm); padding: 0 var(--wp-space-3);
}
.wp-trw__seeds button:hover { color: var(--wp-text); border-color: var(--wp-border-strong); }
</style>
