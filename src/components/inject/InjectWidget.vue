<template>
  <div class="wp-inject-root">
    <div
      v-for="(row, index) in rows"
      :key="row.slot"
      class="wp-inject-row"
      :class="{
        'wp-inject-row--disabled': !row.connected,
        'wp-inject-row--slot-disabled': row.connected && row.cfg.enabled === false,
        'wp-conflict-error': row.hasConflict,
      }"
      :title="row.conflictTooltip"
    >
      <!-- Enable/disable toggle — only on connected slots -->
      <label
        v-if="row.connected"
        class="wp-module-toggle"
        :title="row.cfg.enabled === false ? 'Enable slot' : 'Disable slot'"
        @pointerdown.stop
        @click.stop
      >
        <input
          type="checkbox"
          :checked="row.cfg.enabled !== false"
          @change="toggleEnabled(row.slot)"
        />
        <span class="wp-toggle-mark"></span>
      </label>

      <span class="wp-inject-slot-label">{{ row.slot }}</span>
      <span class="wp-inject-arrow">→</span>
      <span class="wp-inject-dollar">$</span>
      <input
        type="text"
        class="wp-inject-var-input"
        :value="row.cfg.varName"
        :disabled="!row.connected"
        placeholder="variable_name"
        spellcheck="false"
        @input="onVarChange(row.slot, ($event.target as HTMLInputElement).value)"
      />

      <!-- Internal button — only on connected slots -->
      <button
        v-if="row.connected"
        class="wp-module-internal-btn"
        type="button"
        @click.stop="toggleInternal(row.slot)"
        :title="row.cfg.internal ? 'Make visible in assembler' : 'Hide from assembler'"
      ><i :class="row.cfg.internal ? 'pi pi-eye-slash' : 'pi pi-eye'"></i></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Conflict } from '@/extension/conflicts';
import type { InjectSlotConfig } from '@/types';

const SLOT_NAMES = ["input_1", "input_2", "input_3"];

const props = withDefaults(
  defineProps<{
    modelValue: Record<string, string | InjectSlotConfig>;
    connectedSlots: string[];
    conflicts?: Conflict[];
  }>(),
  { conflicts: () => [] },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: Record<string, string | InjectSlotConfig>): void;
}>();

/** Normalize a slot value to InjectSlotConfig */
function normalize(val: string | InjectSlotConfig | undefined): InjectSlotConfig {
  if (!val) return { varName: "" };
  if (typeof val === "string") return { varName: val };
  return val;
}

const rows = computed(() =>
  SLOT_NAMES.map((slot, index) => {
    const moduleConflicts = props.conflicts.filter(c => c.moduleIndex === index);
    const cfg = normalize(props.modelValue[slot]);
    return {
      slot,
      cfg,
      connected: props.connectedSlots.includes(slot),
      hasConflict: moduleConflicts.length > 0,
      conflictTooltip: moduleConflicts.map(c => `⚠ ${c.message}`).join('\n'),
    };
  }),
);

function onVarChange(slot: string, value: string) {
  const existing = normalize(props.modelValue[slot]);
  const updated: Record<string, string | InjectSlotConfig> = {
    ...props.modelValue,
    [slot]: { ...existing, varName: value },
  };
  emit("update:modelValue", updated);
}

function toggleEnabled(slot: string) {
  const existing = normalize(props.modelValue[slot]);
  const wasEnabled = existing.enabled !== false;
  const updated: Record<string, string | InjectSlotConfig> = {
    ...props.modelValue,
    [slot]: { ...existing, enabled: wasEnabled ? false : undefined },
  };
  emit("update:modelValue", updated);
}

function toggleInternal(slot: string) {
  const existing = normalize(props.modelValue[slot]);
  const updated: Record<string, string | InjectSlotConfig> = {
    ...props.modelValue,
    [slot]: { ...existing, internal: existing.internal ? undefined : true },
  };
  emit("update:modelValue", updated);
}
</script>

<style>
@import "../pipeline/widget-theme.css";
</style>

<style scoped>
.wp-inject-root,
.wp-inject-root * {
  box-sizing: border-box;
}

.wp-inject-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
  gap: 4px;
  padding: 8px 10px;
}

.wp-inject-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  transition: opacity 0.15s;
}

.wp-inject-row--disabled {
  opacity: 0.35;
  pointer-events: none;
}

.wp-inject-row--slot-disabled {
  opacity: 0.5;
}

.wp-inject-row.wp-conflict-error {
  border-color: var(--wp-red);
  background: var(--wp-red-bg);
  opacity: 1;
}

.wp-inject-slot-label {
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px;
  color: var(--wp-text2);
  white-space: nowrap;
  min-width: 48px;
}

.wp-inject-arrow {
  color: var(--wp-text3);
  font-size: 11px;
  flex-shrink: 0;
}

.wp-inject-dollar {
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  color: var(--wp-accent);
  flex-shrink: 0;
}

.wp-inject-var-input {
  flex: 1;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  color: var(--wp-text);
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 3px 6px;
  outline: none;
  min-width: 0;
  transition: border-color 0.15s;
}

.wp-inject-var-input:focus {
  border-color: var(--wp-accent);
}

.wp-inject-var-input::placeholder {
  color: var(--wp-text3);
}

.wp-inject-var-input:disabled {
  background: transparent;
  border-color: transparent;
  color: var(--wp-text3);
}

/* ── Enable/disable toggle (mirrors PipelineWidget) ── */
.wp-module-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  cursor: pointer;
}
.wp-module-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.wp-toggle-mark {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid var(--wp-border2);
  background: var(--wp-bg2);
  transition: all 0.15s;
  position: relative;
}
.wp-module-toggle input:checked + .wp-toggle-mark {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}
.wp-module-toggle:hover .wp-toggle-mark {
  border-color: var(--wp-accent);
}

/* ── Internal button (mirrors PipelineWidget) ── */
.wp-module-internal-btn {
  background: none;
  border: none;
  color: var(--wp-text3);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 1px;
}
.wp-module-internal-btn:hover {
  color: var(--wp-teal);
}
.wp-inject-row--internal .wp-module-internal-btn {
  color: var(--wp-teal);
}
</style>
