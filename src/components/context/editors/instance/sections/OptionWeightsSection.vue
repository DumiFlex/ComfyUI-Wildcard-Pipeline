<script setup lang="ts">
import { computed } from "vue";

interface LibraryRow {
  id: string;
  value: string;
  weight: number;
}

const props = defineProps<{
  library: LibraryRow[];
  modelValue: Record<string, number> | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: Record<string, number> | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

function overrideValue(id: string): string {
  const v = props.modelValue?.[id];
  return v === undefined ? "" : String(v);
}

function emitMap(map: Record<string, number>): void {
  if (Object.keys(map).length === 0) {
    emit("update:modelValue", null);
    return;
  }
  emit("update:modelValue", map);
}

function setEntry(id: string, raw: string): void {
  const current = { ...(props.modelValue ?? {}) };
  if (raw === "") {
    delete current[id];
  } else {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    current[id] = n;
  }
  emitMap(current);
}

function onInput(id: string, ev: Event): void {
  setEntry(id, (ev.target as HTMLInputElement).value);
}

function onRowReset(id: string): void {
  setEntry(id, "");
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Option weights</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="ow-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body wp-instance-section-body-col">
      <div
        v-for="row in library"
        :key="row.id"
        class="wp-instance-weight-row"
      >
        <span class="wp-instance-row-id">{{ row.id }}</span>
        <span class="wp-instance-row-value">{{ row.value }}</span>
        <input
          type="number"
          class="wp-instance-input wp-instance-weight-input"
          :data-test="`ow-input-${row.id}`"
          :aria-label="`Weight for ${row.id}`"
          :placeholder="String(row.weight)"
          :value="overrideValue(row.id)"
          step="0.1"
          @input="(ev) => onInput(row.id, ev)"
        />
        <button
          v-if="modelValue && modelValue[row.id] !== undefined"
          type="button"
          class="wp-instance-chip"
          :data-test="`ow-row-reset-${row.id}`"
          title="Reset this row"
          @click="() => onRowReset(row.id)"
        >&#x21BB;</button>
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
  gap: 4px;
}
.wp-instance-weight-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 11px/1.3 var(--wp-font-sans);
}
.wp-instance-row-id {
  font-family: var(--wp-font-mono);
  color: var(--wp-text-muted);
  min-width: 60px;
}
.wp-instance-row-value {
  flex: 1;
  font-family: var(--wp-font-mono);
  color: var(--wp-text);
}
.wp-instance-input {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  padding: 4px 6px;
  font: 11px/1.3 var(--wp-font-mono);
  border-radius: 3px;
}
.wp-instance-weight-input {
  width: 64px;
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
</style>
