<script setup lang="ts">
/**
 * VarPicker — dropdown of upstream `$var` names + live parse preview.
 *
 * Mounted as the custom widget for inputs of type `WP_VAR_PICKER`.
 * Stores its value as `"$seed"` (with leading `$`) on `node.properties.var_name`.
 *
 * Props:
 *  - `modelValue: string` — current var name (with `$`); `""` when nothing picked.
 *  - `upstreamVars: string[]` — names of `$vars` produced by upstream WP_Context
 *    chains. The widget's host (`src/widgets/var_picker.ts`) computes this
 *    via `collectUpstreamVariables` and refreshes it via the standard
 *    `reactiveFromGraph` poll + connection-change cadence.
 *  - `previewSource: string` — the live value of the chosen upstream var
 *    (raw text, before parsing). Empty when no var selected / var missing.
 *  - `previewParsed: string | null` — formatted parsed result, e.g. `"1920"`
 *    or `"true"`. `null` means "fell back to default" — the strip then
 *    renders the amber default state with the default literal from
 *    `previewDefault`.
 *  - `previewDefault: string` — formatted default value (e.g. `"0"`).
 *  - `wiredTo: string` — WP_VarToChoice only: the dropdown input its output
 *    feeds (`Load Checkpoint › ckpt_name · 24 options`), read off the canvas.
 *  - `choiceNote: string` — WP_VarToChoice only: how the last run found its
 *    value (`Matched “x” loosely.`, `No match for “x”. Used y.`). Replaces the
 *    `parsed from` line, and the amber state reads "fallback".
 *
 * Emits:
 *  - `update:modelValue(next: string)` — fires when user picks a new var.
 */
import { computed } from "vue";
import Combobox from "@/kit/Combobox.vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    upstreamVars: readonly string[];
    previewSource?: string;
    previewParsed?: string | null;
    previewDefault?: string;
    /** Litegraph mode: 0 = ALWAYS (live), 2 = NEVER (muted), 4 = BYPASS.
     *  Drives the dim overlay so canvas-side mute/bypass reads visually. */
    nodeMode?: number;
    wiredTo?: string;
    choiceNote?: string;
  }>(),
  { previewSource: "", previewParsed: null, previewDefault: "", nodeMode: 0, wiredTo: "", choiceNote: "" },
);

const emit = defineEmits<{ "update:modelValue": [next: string] }>();

/** The upstream vars as kit Combobox options (the list filters as you type,
 *  with or without the leading `$`, since every name carries it). */
const options = computed(() => props.upstreamVars.map((name) => ({ value: name, label: name })));
const picked = computed<string | null>(() => (props.modelValue?.trim() ? props.modelValue : null));

function onPick(next: string | string[] | null): void {
  if (typeof next === "string" && next) emit("update:modelValue", next);
}

const hasExecuted = computed<boolean>(() => Boolean(props.previewSource || props.choiceNote));
const usedDefault = computed<boolean>(() => props.previewParsed === null);
const isMuted = computed<boolean>(() => props.nodeMode === 2);
const isBypassed = computed<boolean>(() => props.nodeMode === 4);

</script>

<template>
  <div class="wp-var-picker" :class="{ 'wp-var-picker--muted': isMuted, 'wp-var-picker--bypassed': isBypassed }">
    <Combobox
      class="wp-var-picker__field"
      :model-value="picked"
      :options="options"
      size="sm"
      mono
      placeholder="(no var selected)"
      :empty-text="upstreamVars.length ? 'No variable matches' : 'No upstream variables: connect a WP Context node first.'"
      aria-label="Variable"
      data-test="var-picker-trigger"
      @update:model-value="onPick"
    />

    <div
      class="wp-var-picker__preview"
      :class="{
        'wp-var-picker__preview--default': hasExecuted && usedDefault,
        'wp-var-picker__preview--idle': !hasExecuted,
      }"
      data-test="var-picker-preview"
    >
      <span class="wp-var-picker__preview-label">last execute</span>
      <span class="wp-var-picker__preview-value">
        <template v-if="!hasExecuted">→ <em>run workflow to see result</em></template>
        <template v-else-if="usedDefault">→ {{ choiceNote ? "fallback" : "default" }} ({{ previewDefault }})</template>
        <template v-else>→ {{ previewParsed }}</template>
      </span>
    </div>
    <div v-if="hasExecuted && choiceNote" class="wp-var-picker__preview-src" data-test="var-picker-choice-note">
      {{ choiceNote }}
    </div>
    <div v-else-if="hasExecuted && previewSource" class="wp-var-picker__preview-src" data-test="var-picker-source">
      parsed from "{{ previewSource }}"
    </div>
    <div v-if="wiredTo" class="wp-var-picker__wired" data-test="var-picker-wired">
      <span class="wp-var-picker__preview-label">into</span>
      <span class="wp-var-picker__wired-value">{{ wiredTo }}</span>
    </div>
  </div>
</template>

<style scoped>
.wp-var-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font: 11px var(--wp-font-mono, monospace);
  color: var(--wp-text);
}
/* The kit Combobox; the picked $var reads in the accent like the old trigger. */
.wp-var-picker__field :deep(.wp-combo__field) { color: var(--wp-accent); }
.wp-var-picker__preview {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border-left: 2px solid var(--wp-rt-token-good);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font-size: 10px;
}
.wp-var-picker__preview--default { border-left-color: var(--wp-status-modified); }
.wp-var-picker__preview--idle { border-left-color: var(--wp-text-dim); }
.wp-var-picker__preview--idle .wp-var-picker__preview-value { color: var(--wp-text-dim); font-weight: 400; font-style: italic; }
.wp-var-picker__preview-label { color: var(--wp-text-dim); flex: none; }
.wp-var-picker__preview-value {
  min-width: 0;
  text-align: right;
  overflow-wrap: anywhere;
  font-weight: 600;
  color: var(--wp-rt-token-good);
}
.wp-var-picker__preview--default .wp-var-picker__preview-value {
  color: var(--wp-status-modified);
}
.wp-var-picker__preview-src {
  font-size: 9px;
  color: var(--wp-text-dim);
  text-align: right;
  overflow-wrap: anywhere;
}
.wp-var-picker__wired {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
}
.wp-var-picker__wired-value {
  min-width: 0;
  text-align: right;
  color: var(--wp-text-muted);
  overflow-wrap: anywhere;
}

/* Mute / bypass dim — mirrors how cleaner / context / debug widgets
 * react to ComfyUI's node.mode flag. Mute (2) is heavier than bypass
 * (4); bypass usually means "passthrough" so the user might still
 * tweak settings, mute means "node is dead this run". */
.wp-var-picker--muted { opacity: 0.45; pointer-events: none; }
.wp-var-picker--bypassed { opacity: 0.65; }
</style>
