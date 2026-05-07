<script setup lang="ts">
import { computed } from "vue";
import { newModuleId } from "../../../../../widgets/_shared";

interface Row {
  id: string;
  name: string;
  value: string;
}

const props = defineProps<{
  library: Row[];
  modelValue: Row[] | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: Row[] | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

function startOverride(): void {
  // Copy the library snapshot into a working override.
  emit("update:modelValue", props.library.map((r) => ({ ...r })));
}

function patchRow(idx: number, patch: Partial<Row>): void {
  if (!props.modelValue) return;
  const next = props.modelValue.map((r, i) => (i === idx ? { ...r, ...patch } : r));
  emit("update:modelValue", next);
}

function onName(idx: number, ev: Event): void {
  patchRow(idx, { name: (ev.target as HTMLInputElement).value });
}

function onValue(idx: number, ev: Event): void {
  patchRow(idx, { value: (ev.target as HTMLInputElement).value });
}

function deleteRow(idx: number): void {
  if (!props.modelValue) return;
  const next = props.modelValue.filter((_, i) => i !== idx);
  emit("update:modelValue", next);
}

function addRow(): void {
  if (!props.modelValue) return;
  const next: Row[] = [...props.modelValue, { id: newModuleId(), name: "", value: "" }];
  emit("update:modelValue", next);
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Values override</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="vo-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body wp-instance-section-body-col">
      <template v-if="!hasOverride">
        <div
          v-for="row in library"
          :key="row.id"
          class="wp-instance-values-row"
          :data-test="`vo-row-${row.id}`"
        >
          <span class="wp-instance-values-name">{{ row.name }}</span>
          <span class="wp-instance-values-value">{{ row.value }}</span>
        </div>
        <button
          type="button"
          class="wp-instance-chip wp-instance-override-btn"
          data-test="vo-override-btn"
          @click="startOverride"
        >Override values</button>
      </template>
      <template v-else>
        <div
          v-for="(row, idx) in modelValue ?? []"
          :key="row.id"
          class="wp-instance-values-row"
          :data-test="`vo-row-${row.id}`"
        >
          <input
            type="text"
            class="wp-instance-input wp-instance-values-name"
            :data-test="`vo-name-${row.id}`"
            :aria-label="`Variable name for row ${row.id}`"
            :value="row.name"
            @input="(ev) => onName(idx, ev)"
          />
          <input
            type="text"
            class="wp-instance-input wp-instance-values-value"
            :data-test="`vo-value-${row.id}`"
            :aria-label="`Variable value for row ${row.id}`"
            :value="row.value"
            @input="(ev) => onValue(idx, ev)"
          />
          <button
            type="button"
            class="wp-instance-chip"
            :data-test="`vo-delete-${row.id}`"
            title="Delete row"
            @click="() => deleteRow(idx)"
          >&#x2715;</button>
        </div>
        <button
          type="button"
          class="wp-instance-chip"
          data-test="vo-add"
          @click="addRow"
        >+ Add row</button>
      </template>
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
  gap: 4px;
}
.wp-instance-values-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text);
}
.wp-instance-values-name {
  font-family: var(--wp-font-mono);
  color: var(--wp-text-muted);
  min-width: 100px;
  flex: 0 0 auto;
}
.wp-instance-values-value {
  font-family: var(--wp-font-mono);
  flex: 1;
}
.wp-instance-input {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  padding: 4px 6px;
  font: 11px/1.3 var(--wp-font-mono);
  border-radius: 3px;
}
.wp-instance-chip {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  color: var(--wp-text-muted);
  padding: 2px 6px;
  font: 10px/1 var(--wp-font-mono);
  cursor: pointer;
  border-radius: 3px;
}
.wp-instance-chip:hover {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
}
.wp-instance-override-btn {
  align-self: flex-start;
}
</style>
