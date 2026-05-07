<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  library: string;
  modelValue: string | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: string | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

function onInput(ev: Event): void {
  const v = (ev.target as HTMLInputElement).value;
  emit("update:modelValue", v.length > 0 ? v : null);
}

function onClickDefault(): void {
  emit("update:modelValue", null);
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Variable binding</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="vb-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body">
      <input
        type="text"
        class="wp-instance-input"
        data-test="vb-input"
        aria-label="Variable binding override"
        :placeholder="library"
        :value="modelValue ?? ''"
        @input="onInput"
      />
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-chip"
        data-test="vb-default-chip"
        title="Use library default"
        @click="onClickDefault"
      >&#x21BB; {{ library }}</button>
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
.wp-instance-input {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  padding: 4px 6px;
  font: 11px/1.3 var(--wp-font-mono);
  border-radius: 3px;
  flex: 1;
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
