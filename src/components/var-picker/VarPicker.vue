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
 *
 * Emits:
 *  - `update:modelValue(next: string)` — fires when user picks a new var.
 */
import { computed, ref } from "vue";

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
  }>(),
  { previewSource: "", previewParsed: null, previewDefault: "", nodeMode: 0 },
);

const emit = defineEmits<{ "update:modelValue": [next: string] }>();

const open = ref<boolean>(false);

const displayValue = computed<string>(() => {
  const v = props.modelValue?.trim();
  return v && v.length > 0 ? v : "(no var selected)";
});

const hasExecuted = computed<boolean>(() => Boolean(props.previewSource));
const usedDefault = computed<boolean>(() => props.previewParsed === null);
const isMuted = computed<boolean>(() => props.nodeMode === 2);
const isBypassed = computed<boolean>(() => props.nodeMode === 4);

function toggleOpen(): void {
  open.value = !open.value;
}

function pick(name: string): void {
  emit("update:modelValue", name);
  open.value = false;
}
</script>

<template>
  <div class="wp-var-picker" :class="{ 'wp-var-picker--muted': isMuted, 'wp-var-picker--bypassed': isBypassed }">
    <button
      type="button"
      class="wp-var-picker__trigger"
      :class="{ 'wp-var-picker__trigger--open': open }"
      :aria-expanded="open"
      aria-haspopup="listbox"
      data-test="var-picker-trigger"
      @click="toggleOpen"
    >
      <span class="wp-var-picker__value">{{ displayValue }}</span>
      <span class="wp-var-picker__caret" aria-hidden="true">▾</span>
    </button>

    <ul
      v-if="open"
      role="listbox"
      class="wp-var-picker__menu"
      data-test="var-picker-menu"
    >
      <li v-if="upstreamVars.length === 0" class="wp-var-picker__empty">
        No upstream variables — connect a WP Context node first.
      </li>
      <li
        v-for="name in upstreamVars"
        :key="name"
        role="option"
        :aria-selected="modelValue === name"
        class="wp-var-picker__opt"
        :class="{ 'wp-var-picker__opt--active': modelValue === name }"
        :data-test="`var-picker-opt-${name}`"
        @click="pick(name)"
      >
        {{ name }}
      </li>
    </ul>

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
        <template v-else-if="usedDefault">→ default ({{ previewDefault }})</template>
        <template v-else>→ {{ previewParsed }}</template>
      </span>
    </div>
    <div v-if="hasExecuted && previewSource" class="wp-var-picker__preview-src" data-test="var-picker-source">
      parsed from "{{ previewSource }}"
    </div>
  </div>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-var-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font: 11px var(--wp-font-mono, monospace);
  color: var(--wp-text);
}
.wp-var-picker__trigger {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  color: var(--wp-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
}
.wp-var-picker__trigger--open {
  border-color: var(--wp-accent, #c4b5fd);
}
.wp-var-picker__value { color: var(--wp-accent, #c4b5fd); }
.wp-var-picker__caret { color: var(--wp-text-dim, #7a7d88); }

.wp-var-picker__menu {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  max-height: 180px;
  overflow-y: auto;
}
.wp-var-picker__opt {
  padding: 4px 8px;
  cursor: pointer;
  color: var(--wp-text-muted, #aeb1bb);
}
.wp-var-picker__opt:hover { background: rgba(196, 181, 253, 0.1); color: var(--wp-text); }
.wp-var-picker__opt--active { background: rgba(196, 181, 253, 0.18); color: var(--wp-accent, #c4b5fd); }
.wp-var-picker__empty {
  padding: 6px 8px;
  font-style: italic;
  color: var(--wp-text-dim, #7a7d88);
  font-size: 10px;
}

.wp-var-picker__preview {
  display: flex;
  justify-content: space-between;
  padding: 6px 8px;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border-left: 2px solid var(--wp-rt-token-good, #4ad4c4);
  border-radius: 3px;
  font-size: 10px;
}
.wp-var-picker__preview--default { border-left-color: var(--wp-status-modified, #fbbf24); }
.wp-var-picker__preview--idle { border-left-color: var(--wp-text-dim, #595c66); }
.wp-var-picker__preview--idle .wp-var-picker__preview-value { color: var(--wp-text-dim, #7a7d88); font-weight: 400; font-style: italic; }
.wp-var-picker__preview-label { color: var(--wp-text-dim, #7a7d88); }
.wp-var-picker__preview-value {
  font-weight: 600;
  color: var(--wp-rt-token-good, #4ad4c4);
}
.wp-var-picker__preview--default .wp-var-picker__preview-value {
  color: var(--wp-status-modified, #fbbf24);
}
.wp-var-picker__preview-src {
  font-size: 9px;
  color: var(--wp-text-dim, #7a7d88);
  text-align: right;
}

/* Mute / bypass dim — mirrors how cleaner / context / debug widgets
 * react to ComfyUI's node.mode flag. Mute (2) is heavier than bypass
 * (4); bypass usually means "passthrough" so the user might still
 * tweak settings, mute means "node is dead this run". */
.wp-var-picker--muted { opacity: 0.45; pointer-events: none; }
.wp-var-picker--bypassed { opacity: 0.65; }
</style>
