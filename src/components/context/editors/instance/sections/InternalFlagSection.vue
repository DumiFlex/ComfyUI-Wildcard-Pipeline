<script setup lang="ts">
import { computed } from "vue";
import WpCheck from "../../../../../kit/WpCheck.vue";
import WpButton from "../../../../../kit/WpButton.vue";

const props = defineProps<{
  library: boolean;
  modelValue: boolean | null;
}>();

const emit = defineEmits<{
  "update:modelValue": [next: boolean | null];
  "reset": [];
}>();

const hasOverride = computed(() => props.modelValue !== null);
const effective = computed(() => (props.modelValue !== null ? props.modelValue : props.library));

function onToggle(v: boolean): void {
  emit("update:modelValue", v);
}

function onClickReset(): void {
  emit("reset");
}
</script>

<template>
  <section class="wp-instance-section">
    <div class="wp-instance-section-head">
      <span class="wp-instance-section-title">Internal flag</span>
      <span v-if="hasOverride" class="wp-instance-section-modified">modified</span>
      <WpButton
        v-if="hasOverride"
        variant="ghost"
        icon="pi-replay"
        data-test="if-reset"
        @click="onClickReset"
      >Reset</WpButton>
    </div>
    <div class="wp-instance-section-body">
      <div class="wp-instance-toggle">
        <WpCheck
          data-test="if-toggle"
          :model-value="effective"
          aria-label="Internal binding (engine-only)"
          @update:model-value="onToggle"
        />
        <span aria-hidden="true">Internal binding (engine-only)</span>
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
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
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
</style>
