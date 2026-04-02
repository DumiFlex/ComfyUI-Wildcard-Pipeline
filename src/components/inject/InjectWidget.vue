<template>
  <div class="wp-inject-root">
    <div
      v-for="row in rows"
      :key="row.slot"
      class="wp-inject-row"
      :class="{
        'wp-inject-row--disabled': !row.connected,
        'wp-conflict-error': row.hasConflict,
      }"
      :title="row.conflictTooltip"
    >
      <span class="wp-inject-slot-label">{{ row.slot }}</span>
      <span class="wp-inject-arrow">→</span>
      <span class="wp-inject-dollar">$</span>
      <input
        type="text"
        class="wp-inject-var-input"
        :value="row.varName"
        :disabled="!row.connected"
        placeholder="variable_name"
        spellcheck="false"
        @input="onVarChange(row.slot, ($event.target as HTMLInputElement).value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Conflict } from '@/extension/conflicts';

const SLOT_NAMES = ["input_1", "input_2", "input_3"];

const props = withDefaults(
  defineProps<{
    modelValue: Record<string, string>;
    connectedSlots: string[];
    conflicts?: Conflict[];
  }>(),
  { conflicts: () => [] },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: Record<string, string>): void;
}>();

const rows = computed(() =>
  SLOT_NAMES.map((slot, index) => {
    const moduleConflicts = props.conflicts.filter(c => c.moduleIndex === index);
    return {
      slot,
      varName: props.modelValue[slot] ?? "",
      connected: props.connectedSlots.includes(slot),
      hasConflict: moduleConflicts.length > 0,
      conflictTooltip: moduleConflicts.map(c => `⚠ ${c.message}`).join('\n'),
    };
  }),
);

function onVarChange(slot: string, value: string) {
  const updated = { ...props.modelValue, [slot]: value };
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
</style>
