<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  modelValue: "library" | "instance";
  hasInstanceTab: boolean;
  instanceModified: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [tab: "library" | "instance"];
}>();

const isLibrary = computed(() => props.modelValue === "library");
const isInstance = computed(() => props.modelValue === "instance");

function selectLibrary(): void { emit("update:modelValue", "library"); }
function selectInstance(): void { emit("update:modelValue", "instance"); }
</script>

<template>
  <div class="wp-tab-strip" role="tablist">
    <button
      type="button"
      role="tab"
      class="wp-tab"
      :class="{ 'wp-tab--active': isLibrary }"
      :aria-selected="isLibrary"
      data-test="tab-library"
      @click="selectLibrary"
    >Library</button>
    <button
      v-if="hasInstanceTab"
      type="button"
      role="tab"
      class="wp-tab"
      :class="{ 'wp-tab--active': isInstance }"
      :aria-selected="isInstance"
      data-test="tab-instance"
      @click="selectInstance"
    >
      Instance
      <span
        v-if="instanceModified"
        class="wp-tab-modified-dot"
        data-test="tab-instance-dot"
        aria-label="modified"
      />
    </button>
  </div>
</template>

<style scoped>
.wp-tab-strip {
  display: flex;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg2);
}
.wp-tab {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 8px 14px;
  font: 500 11px/1 var(--wp-font-sans);
  color: var(--wp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.wp-tab--active {
  color: var(--wp-accent-text, var(--wp-text));
  border-bottom-color: var(--wp-accent);
  background: var(--wp-bg);
}
.wp-tab-modified-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--wp-status-modified, #fb923c);
  display: inline-block;
}
</style>
