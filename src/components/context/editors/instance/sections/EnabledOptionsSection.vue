<script setup lang="ts">
import { computed } from "vue";

interface LibraryOption {
  id: string;
  value: string;
}

const props = defineProps<{
  library: LibraryOption[];
  modelValue: string[] | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: string[] | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

function isChecked(id: string): boolean {
  if (props.modelValue === null) return true;
  return props.modelValue.includes(id);
}

function onToggle(id: string, ev: Event): void {
  const checked = (ev.target as HTMLInputElement).checked;
  // Currently-enabled set: either the override list, or all library ids when null.
  const enabled = props.modelValue !== null
    ? new Set(props.modelValue)
    : new Set(props.library.map((o) => o.id));
  if (checked) enabled.add(id);
  else enabled.delete(id);
  // Preserve library order in the emitted array for stability.
  const next = props.library.map((o) => o.id).filter((oid) => enabled.has(oid));
  emit("update:modelValue", next);
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Enabled options</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="eo-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body wp-instance-section-body-col">
      <label
        v-for="opt in library"
        :key="opt.id"
        class="wp-instance-row"
      >
        <input
          type="checkbox"
          :data-test="`eo-cb-${opt.id}`"
          :checked="isChecked(opt.id)"
          @change="(ev) => onToggle(opt.id, ev)"
        />
        <span class="wp-instance-row-id">{{ opt.id }}</span>
        <span class="wp-instance-row-value">{{ opt.value }}</span>
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
  min-width: 60px;
}
.wp-instance-row-value {
  flex: 1;
  font-family: var(--wp-font-mono);
}
</style>
