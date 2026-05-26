<script setup lang="ts">
/**
 * MatrixLegend — collapsible explanation panel below the matrix.
 * Lists each rule state with a cell sample + plain-language
 * description of its runtime effect. Collapsed by default.
 */
import { ref } from "vue";

const expanded = ref(false);

function toggle(): void {
  expanded.value = !expanded.value;
}
</script>

<template>
  <div class="legend">
    <button
      type="button"
      class="legend-toggle"
      :class="{ open: expanded }"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <span>? Legend</span>
      <span class="chev" aria-hidden="true">▾</span>
    </button>
    <div v-if="expanded" class="legend-body">
      <div class="legend-row">
        <span class="legend-sample s-neutral"><span class="glyph">·</span></span>
        <span class="legend-name n-neutral">Neutral</span>
        <span class="legend-desc">No rule. Source and target roll independently.</span>
      </div>
      <div class="legend-row">
        <span class="legend-sample s-exclude"><span class="glyph">×</span></span>
        <span class="legend-name n-exclude">Exclude</span>
        <span class="legend-desc">When the source sub-cat is picked, these target values are excluded entirely.</span>
      </div>
      <div class="legend-row">
        <span class="legend-sample s-boost"><span class="glyph">↑</span><span class="factor">1.8</span></span>
        <span class="legend-name n-boost">Boost</span>
        <span class="legend-desc">When the source sub-cat is picked, target values in this column are N times more likely.</span>
      </div>
      <div class="legend-row">
        <span class="legend-sample s-reduce"><span class="glyph">↓</span><span class="factor">0.5</span></span>
        <span class="legend-name n-reduce">Reduce</span>
        <span class="legend-desc">When the source sub-cat is picked, target values in this column are N times less likely.</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.legend { margin-top: 14px; }
.legend-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--wp-border, #2a2d35);
  border-radius: 4px;
  background: color-mix(in srgb, var(--wp-text) 2%, transparent);
  color: var(--wp-text-muted, #8a8d99);
  font: 600 10px var(--wp-font-sans, sans-serif);
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.legend-toggle:hover {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 8%, transparent);
  color: var(--wp-accent-text, #c4b5fd);
  border-color: var(--wp-border-strong, #4a4d55);
}
.legend-toggle .chev { transition: transform 0.15s; display: inline-block; }
.legend-toggle.open .chev { transform: rotate(180deg); }

.legend-body {
  margin-top: 10px;
  background: var(--wp-bg2, #1a1d24);
  border: 1px solid var(--wp-border, #2a2d35);
  border-radius: 6px;
  padding: 12px 14px;
}
.legend-row {
  display: grid;
  grid-template-columns: 70px 80px 1fr;
  gap: 12px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.legend-row:last-child { border-bottom: 0; }
.legend-sample {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 64px;
  height: 32px;
  border-radius: 4px;
  font: 600 12px var(--wp-font-mono, monospace);
}
.legend-sample.s-neutral {
  background: color-mix(in srgb, var(--wp-text) 4%, transparent);
  color: var(--wp-text-dim, #595c66);
  border: 1px dashed color-mix(in srgb, var(--wp-text) 10%, transparent);
}
.legend-sample.s-exclude { background: color-mix(in srgb, var(--wp-danger, #ef4444) 22%, transparent); color: var(--wp-danger); border: 1px solid color-mix(in srgb, var(--wp-danger, #ef4444) 45%, transparent); }
.legend-sample.s-boost { background: color-mix(in srgb, var(--wp-success, #22c55e) 22%, transparent); color: var(--wp-success); border: 1px solid color-mix(in srgb, var(--wp-success, #22c55e) 45%, transparent); }
.legend-sample.s-reduce { background: color-mix(in srgb, var(--wp-warn, #f97316) 22%, transparent); color: var(--wp-warn); border: 1px solid color-mix(in srgb, var(--wp-warn, #f97316) 45%, transparent); }
.glyph { font-size: 14px; line-height: 1; }
.factor { font-size: 11px; font-weight: 700; }
.legend-name {
  font: 700 10px var(--wp-font-sans, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.legend-name.n-neutral { color: var(--wp-text-muted); }
.legend-name.n-exclude { color: var(--wp-danger); }
.legend-name.n-boost { color: var(--wp-success); }
.legend-name.n-reduce { color: var(--wp-warn); }
.legend-desc {
  font: 11px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #8a8d99);
  line-height: 1.45;
}
</style>
