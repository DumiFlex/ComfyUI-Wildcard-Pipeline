<script setup lang="ts">
/**
 * Performance overlay HUD — small fixed-position panel showing
 * frontend-observable WP metrics in real time. Toggled by
 * `wildcardPipeline.display.perfOverlay`; flipping the setting flips
 * the reactive `perfOverlayVisible` ref in perf-stats which gates
 * the v-if below.
 *
 * Layout: bottom-left of the viewport, semi-transparent dark panel,
 * compact 6-row grid of label / value pairs. Reset button zeroes the
 * counters (moduleCount stays — it's a snapshot, not a counter).
 *
 * Position avoids overlapping ComfyUI's bottom toolbar (typically ~50px)
 * by anchoring above it. Width is intrinsic to its content so the panel
 * stays out of the way when metrics are short.
 */
import { computed } from "vue";
import {
  perfStats,
  perfOverlayVisible,
  resetPerfStats,
} from "../../extension/perf-stats";

/** Cache hit ratio derived for display — clamps to 0 when no lookups
 *  have happened yet so the HUD shows "—" instead of NaN. */
const cacheRatio = computed<string>(() => {
  const total = perfStats.cacheHits + perfStats.cacheMisses;
  if (total === 0) return "—";
  return `${Math.round((perfStats.cacheHits / total) * 100)}%`;
});

function onReset(): void {
  resetPerfStats();
}
</script>

<template>
  <Teleport to="body">
    <aside
      v-if="perfOverlayVisible"
      class="wp-perf"
      data-test="wp-perf-overlay"
      role="status"
      aria-live="polite"
      aria-label="Wildcard Pipeline performance overlay"
    >
      <header class="wp-perf__head">
        <span class="wp-perf__title">WP perf</span>
        <button
          class="wp-perf__reset"
          type="button"
          title="Reset counters"
          aria-label="Reset performance counters"
          @click="onReset"
        >
          <i class="pi pi-refresh" aria-hidden="true"></i>
        </button>
      </header>
      <dl class="wp-perf__grid">
        <dt>modules</dt>
        <dd data-test="wp-perf-modules">{{ perfStats.moduleCount }}</dd>

        <dt>cache hit</dt>
        <dd data-test="wp-perf-cache-ratio">{{ cacheRatio }}</dd>

        <dt>cache h/m</dt>
        <dd data-test="wp-perf-cache-hits">
          {{ perfStats.cacheHits }} / {{ perfStats.cacheMisses }}
        </dd>

        <dt>scan</dt>
        <dd data-test="wp-perf-scan">{{ perfStats.lastScanMs.toFixed(1) }} ms</dd>

        <dt>queue</dt>
        <dd data-test="wp-perf-queue">{{ perfStats.lastQueueMs.toFixed(1) }} ms</dd>
      </dl>
    </aside>
  </Teleport>
</template>

<style scoped>
.wp-perf {
  position: fixed;
  bottom: 64px;
  left: 12px;
  z-index: 9000;
  background: rgba(20, 20, 24, 0.88);
  border: 1px solid var(--wp-border, #444);
  border-radius: var(--wp-radius-sm, 4px);
  color: var(--wp-text, #ddd);
  font: 10px/1.3 var(--wp-font-mono, ui-monospace, "JetBrains Mono", monospace);
  padding: 6px 8px;
  min-width: 140px;
  pointer-events: auto;
  user-select: none;
  /* Subtle backdrop so the HUD reads cleanly over busy node graphs */
  backdrop-filter: blur(2px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.wp-perf__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
  padding-bottom: 3px;
  border-bottom: 1px dashed var(--wp-border, #444);
}
.wp-perf__title {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-accent, #6366f1);
}
.wp-perf__reset {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--wp-text3, #888);
  cursor: pointer;
  padding: 1px 4px;
  font-size: 9px;
  line-height: 1;
}
.wp-perf__reset:hover {
  border-color: var(--wp-border2, #555);
  color: var(--wp-text, #ddd);
}
.wp-perf__grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 8px;
  margin: 0;
}
.wp-perf__grid dt {
  color: var(--wp-text3, #888);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wp-perf__grid dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
