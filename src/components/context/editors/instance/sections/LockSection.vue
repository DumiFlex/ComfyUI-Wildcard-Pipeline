<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  // Library has no concept of locked seed — pass undefined to honour the
  // shared section signature.
  library: undefined;
  modelValue: number | null;
  lastLockedSeed?: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: number | null];
  "update:lastLockedSeed": [next: number];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

function randomSeed(): number {
  // 31-bit non-zero seed — wide enough for the engine and safe for a
  // signed-int input.
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}

function onToggle(ev: Event): void {
  const checked = (ev.target as HTMLInputElement).checked;
  if (checked) {
    const seed = props.lastLockedSeed ?? randomSeed();
    emit("update:modelValue", seed);
    if (props.lastLockedSeed === undefined) {
      emit("update:lastLockedSeed", seed);
    }
    return;
  }
  // Toggling off — clear the override but keep lastLockedSeed memory.
  emit("update:modelValue", null);
}

function onSeedInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  const n = Number(raw);
  if (raw === "" || Number.isNaN(n)) return;
  emit("update:modelValue", n);
  emit("update:lastLockedSeed", n);
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Lock seed</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="lk-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body">
      <label class="wp-instance-toggle">
        <input
          type="checkbox"
          data-test="lk-toggle"
          :checked="hasOverride"
          @change="onToggle"
        />
        <span>Lock seed</span>
      </label>
      <input
        v-if="hasOverride"
        type="number"
        class="wp-instance-input wp-instance-seed-input"
        data-test="lk-seed"
        aria-label="Locked seed"
        :value="modelValue ?? ''"
        @input="onSeedInput"
      />
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
.wp-instance-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text);
  cursor: pointer;
}
.wp-instance-input {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  padding: 4px 6px;
  font: 11px/1.3 var(--wp-font-mono);
  border-radius: 3px;
}
.wp-instance-seed-input {
  width: 120px;
}
</style>
