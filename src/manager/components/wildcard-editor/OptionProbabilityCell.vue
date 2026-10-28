<script setup lang="ts">
/**
 * One option row's probability cell: the share bar and, for a non-null
 * option, the fallback chip + its hover-revealed toggle.
 */
import { formatProbability } from "../../utils/percent";

defineProps<{
  /** The option's draw probability, 0–100. */
  percent: number;
  isNull: boolean;
  fallback: boolean;
  /** Row index, for the `data-test` hooks. */
  index: number;
}>();

const emit = defineEmits<{ "toggle-fallback": [] }>();
</script>

<template>
  <div class="opt-prob">
    <div class="opt-prob__bar">
      <div class="opt-prob__fill" :style="{ width: percent + '%' }" />
    </div>
    <span class="opt-prob__value wp-mono">{{ formatProbability(percent) }}</span>
  </div>
  <!-- One fallback per wildcard: setting it here moves the flag
       off any other option. The toggle is hover-revealed like
       the grip so the resting table looks unchanged. -->
  <div v-if="!isNull" class="wc-fallback-line">
    <span
      v-if="fallback"
      class="wc-fallback-chip"
      :data-test="`wc-opt-fallback-chip-${index}`"
      title="Rolls normally, and is also used when constraints or weights leave nothing else to pick."
    >
      <i class="pi pi-shield" aria-hidden="true" />
      <span>fallback</span>
    </span>
    <button
      type="button"
      class="wc-fallback-toggle"
      :aria-pressed="fallback ? 'true' : 'false'"
      :data-test="`wc-opt-fallback-${index}`"
      :title="fallback
        ? 'Make this an ordinary option again'
        : 'Also use this option when every option is ruled out'"
      @click.stop="emit('toggle-fallback')"
    >{{ fallback ? "unset" : "set as fallback" }}</button>
  </div>
</template>

<style scoped>
.opt-prob {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
}
.opt-prob__bar {
  flex: 1;
  height: 6px;
  background: var(--wp-bg-3);
  border-radius: var(--wp-radius-cap, 999px);
  overflow: hidden;
}
.opt-prob__fill {
  height: 100%;
  background: var(--wp-accent-gradient);
}
.opt-prob__value {
  width: 32px;
  text-align: right;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
}

/* Fallback option: rolls normally and also stands in when nothing else is
   left to pick, so the chip sits under its probability. */
.wc-fallback-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.wc-fallback-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 45%, transparent);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent);
  color: var(--wp-accent-400, var(--wp-accent-500));
  font-family: var(--wp-font-mono, monospace);
  font-size: var(--wp-text-xs, 11px);
  font-weight: 600;
}
.wc-fallback-chip .pi { font-size: 10px; }
.wc-fallback-toggle {
  padding: 0;
  border: none;
  background: none;
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono, monospace);
  font-size: var(--wp-text-xs, 11px);
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s, color .12s;
}
tr:hover .wc-fallback-toggle,
.wc-fallback-toggle:focus-visible { opacity: 0.8; }
.wc-fallback-toggle:hover { opacity: 1; color: var(--wp-accent-500); text-decoration: underline; }
</style>
