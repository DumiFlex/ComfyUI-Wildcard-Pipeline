<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  library: string[];
  modelValue: string[] | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: string[] | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);

function isActive(sub: string): boolean {
  if (props.modelValue === null) return true;
  return props.modelValue.includes(sub);
}

function toggle(sub: string): void {
  const enabled = props.modelValue !== null
    ? new Set(props.modelValue)
    : new Set(props.library);
  if (enabled.has(sub)) enabled.delete(sub);
  else enabled.add(sub);
  // Preserve library order in emitted array.
  const next = props.library.filter((s) => enabled.has(s));
  emit("update:modelValue", next);
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Category filter</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <button
        v-if="hasOverride"
        type="button"
        class="wp-instance-section-reset"
        data-test="cf-reset"
        @click="onClickReset"
      >
        <i class="pi pi-replay" /> reset
      </button>
    </div>
    <div class="wp-instance-section-body">
      <button
        v-for="sub in library"
        :key="sub"
        type="button"
        class="wp-instance-chip wp-instance-chip-toggle"
        :class="{ 'is-active': isActive(sub) }"
        :data-test="`cf-chip-${sub}`"
        @click="() => toggle(sub)"
      >{{ sub }}</button>
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
  flex-wrap: wrap;
  gap: 4px;
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
.wp-instance-chip-toggle.is-active {
  background: var(--wp-accent-soft, var(--wp-bg2));
  border-color: var(--wp-accent);
  color: var(--wp-text);
}
.wp-instance-chip:hover {
  border-color: var(--wp-accent);
}
</style>
