<script setup lang="ts">
import { computed } from "vue";
import WpCheck from "../../../../shared/WpCheck.vue";

interface Rule {
  id: string;
  label?: string;
  source_value?: string;
  target_value?: string;
}

const props = defineProps<{
  library: Rule[];
  modelValue: string[] | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: string[] | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

function isDisabled(id: string): boolean {
  return props.modelValue?.includes(id) ?? false;
}

function emitList(ids: string[]): void {
  if (ids.length === 0) {
    emit("update:modelValue", null);
    return;
  }
  emit("update:modelValue", ids);
}

function onToggle(id: string, next: boolean): void {
  const current = new Set(props.modelValue ?? []);
  if (next) current.add(id);
  else current.delete(id);
  // Preserve library order in emitted array.
  const ordered = props.library.map((r) => r.id).filter((rid) => current.has(rid));
  emitList(ordered);
}

function ruleLabel(rule: Rule): string {
  if (rule.label) return rule.label;
  if (rule.source_value !== undefined && rule.target_value !== undefined) {
    return `${rule.source_value} -> ${rule.target_value}`;
  }
  return rule.id;
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Disabled rules</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="dr-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body wp-instance-section-body-col">
      <div
        v-for="rule in library"
        :key="rule.id"
        class="wp-instance-row"
      >
        <WpCheck
          :data-test="`dr-cb-${rule.id}`"
          :model-value="isDisabled(rule.id)"
          :aria-label="`disable rule ${rule.id}`"
          @update:model-value="(v) => onToggle(rule.id, v)"
        />
        <span class="wp-instance-row-id">{{ rule.id }}</span>
        <span class="wp-instance-row-value">{{ ruleLabel(rule) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.wp-instance-section {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--wp-border-soft, var(--wp-border));
}
.wp-instance-section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.wp-instance-section-title {
  font: 600 10px/1 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.wp-instance-section-modified {
  background: rgba(251, 146, 60, 0.18);
  color: var(--wp-status-modified, #fb923c);
  padding: 1px 5px;
  border-radius: 2px;
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
}
.wp-instance-section-reset {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--wp-border);
  color: var(--wp-text-muted);
  padding: 2px 6px;
  font: 9px/1 var(--wp-font-sans);
  cursor: pointer;
  border-radius: 3px;
}
.wp-instance-section-body {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wp-instance-section-body-col {
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
}
.wp-instance-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text);
  cursor: pointer;
}
.wp-instance-row-id {
  font-family: var(--wp-font-mono);
  color: var(--wp-text-muted);
  min-width: 60px;
}
.wp-instance-row-value {
  flex: 1;
  font-family: var(--wp-font-mono);
}
</style>
