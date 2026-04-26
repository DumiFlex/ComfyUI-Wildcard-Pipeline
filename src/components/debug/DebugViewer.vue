<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ snapshot: string }>();

const pretty = computed(() => {
  if (!props.snapshot) return "";
  try { return JSON.stringify(JSON.parse(props.snapshot), null, 2); }
  catch { return props.snapshot; }
});
</script>

<template>
  <div class="wp-debug">
    <pre v-if="pretty" class="wp-debug__pre">{{ pretty }}</pre>
    <p v-else class="wp-debug__empty">Run the graph to capture a snapshot.</p>
  </div>
</template>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
.wp-debug {
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  line-height: 1.4;
  padding: 6px;
  color: var(--wp-text);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
.wp-debug__pre {
  background: var(--wp-bg);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 8px;
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.wp-debug__empty {
  color: var(--wp-text3);
  font-style: italic;
  font-family: var(--wp-font-sans, sans-serif);
  text-align: center;
  margin: auto 0;
}
</style>
