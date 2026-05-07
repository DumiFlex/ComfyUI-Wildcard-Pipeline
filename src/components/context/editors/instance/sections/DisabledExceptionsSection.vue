<script setup lang="ts">
import { computed } from "vue";
import { encodeKey } from "../keys";

interface Exception {
  // Tier 2 (current) shape uses `*_value`; legacy payloads use bare
  // `source` / `target`. Engine accepts either via the same fallback
  // chain — see `engine/modules/constraint_handler.py:215`. Mirror it
  // here so a constraint authored against the legacy shape still keys
  // its disabled cells correctly. Reading only `*_value` would emit
  // `encodeKey([undefined, undefined])` and silently drop selections.
  source_value?: string;
  target_value?: string;
  source?: string;
  target?: string;
  mode: string;
  factor: number;
}

const props = defineProps<{
  library: Exception[];
  modelValue: string[] | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: string[] | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

interface Row {
  key: string;
  exception: Exception;
  index: number;
}

const rows = computed<Row[]>(() =>
  props.library.map((ex, index) => ({
    key: encodeKey([ex.source_value ?? ex.source ?? "", ex.target_value ?? ex.target ?? ""]),
    exception: ex,
    index,
  })),
);

function isDisabled(key: string): boolean {
  return props.modelValue?.includes(key) ?? false;
}

function emitList(keys: string[]): void {
  if (keys.length === 0) {
    emit("update:modelValue", null);
    return;
  }
  emit("update:modelValue", keys);
}

function onToggle(key: string, ev: Event): void {
  const checked = (ev.target as HTMLInputElement).checked;
  const current = new Set(props.modelValue ?? []);
  if (checked) current.add(key);
  else current.delete(key);
  // Preserve library order in emitted array.
  const next = rows.value.map((r) => r.key).filter((k) => current.has(k));
  emitList(next);
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Disabled exceptions</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="de-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body wp-instance-section-body-col">
      <label
        v-for="row in rows"
        :key="row.key"
        class="wp-instance-row"
      >
        <input
          type="checkbox"
          :data-test="`de-cb-${row.index}`"
          :checked="isDisabled(row.key)"
          @change="(ev) => onToggle(row.key, ev)"
        />
        <span class="wp-instance-row-id">{{ row.exception.source_value ?? row.exception.source ?? "" }} &rarr; {{ row.exception.target_value ?? row.exception.target ?? "" }}</span>
        <span class="wp-instance-row-value">{{ row.exception.mode }} ({{ row.exception.factor }})</span>
      </label>
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
  min-width: 100px;
}
.wp-instance-row-value {
  flex: 1;
  font-family: var(--wp-font-mono);
}
</style>
