<script setup lang="ts">
/**
 * ContextLoopWidget — DOM widget for WP_ContextLoop.
 *
 * Owns the strategy chips, override-seed toggle, iteration-var-name
 * text field, and bypass toggle. The `seed` and `count` widgets live
 * outside this SFC as stock ComfyUI INT widgets (native
 * control_after_generate + min/max validation respectively).
 *
 * Value contract: `modelValue` is a `ContextLoopConfig` object; emit
 * `update:modelValue` with the full new config on any change. The
 * host glue (`src/widgets/context_loop.ts`) serializes to JSON and
 * pushes via `host.setValue` so ComfyUI's widget value matches.
 */
import { computed } from "vue";
import type { ContextLoopConfig, LoopStrategy } from "./types";

const props = withDefaults(
  defineProps<{
    modelValue: ContextLoopConfig;
    /** Litegraph mode: 0 = ALWAYS (live), 2 = NEVER (muted), 4 = BYPASS.
     *  Drives the dim overlay so canvas-side mute/bypass reads visually. */
    nodeMode?: number;
  }>(),
  { nodeMode: 0 },
);

const emit = defineEmits<{ "update:modelValue": [next: ContextLoopConfig] }>();

const STRATEGIES: { id: LoopStrategy; label: string; hint: string }[] = [
  { id: "hash_index", label: "hash", hint: "Independent per-iteration; recommended for varied results." },
  { id: "sequential", label: "sequential", hint: "base, base+1, base+2, … Predictable diffs." },
  { id: "prime_stride", label: "stride", hint: "base + i × 1,000,003. Wide spread, deterministic." },
];

const isMuted = computed<boolean>(() => props.nodeMode === 2);
const isBypassed = computed<boolean>(() => props.nodeMode === 4);

function pickStrategy(s: LoopStrategy): void {
  if (props.modelValue.strategy === s) return;
  emit("update:modelValue", { ...props.modelValue, strategy: s });
}

function toggleOverride(): void {
  emit("update:modelValue", { ...props.modelValue, override_seed: !props.modelValue.override_seed });
}

function toggleBypass(): void {
  emit("update:modelValue", { ...props.modelValue, bypass: !props.modelValue.bypass });
}

function onIterationVarInput(ev: Event): void {
  const v = (ev.target as HTMLInputElement).value;
  emit("update:modelValue", { ...props.modelValue, iteration_var_name: v });
}

function toggleIterationInternal(): void {
  emit("update:modelValue", {
    ...props.modelValue,
    iteration_internal: !props.modelValue.iteration_internal,
  });
}

function toggleTotalInternal(): void {
  emit("update:modelValue", {
    ...props.modelValue,
    total_internal: !props.modelValue.total_internal,
  });
}
</script>

<template>
  <div
    class="wp-loop"
    :class="{
      'wp-loop--muted': isMuted,
      'wp-loop--bypassed': isBypassed,
      'wp-loop--bypass-on': modelValue.bypass,
    }"
  >
    <div class="wp-loop__section">
      <div class="wp-loop__label">strategy</div>
      <div class="wp-loop__chips" role="radiogroup" aria-label="seed strategy">
        <button
          v-for="s in STRATEGIES"
          :key="s.id"
          type="button"
          class="wp-loop__chip"
          :class="{ 'wp-loop__chip--active': modelValue.strategy === s.id }"
          :data-test="`loop-strategy-${s.id}`"
          :title="s.hint"
          role="radio"
          :aria-checked="modelValue.strategy === s.id"
          @click="pickStrategy(s.id)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <div class="wp-loop__row">
      <span class="wp-loop__row-label">override seed</span>
      <button
        type="button"
        class="wp-loop__switch"
        :class="{ 'wp-loop__switch--on': modelValue.override_seed }"
        data-test="loop-override-toggle"
        :aria-pressed="modelValue.override_seed"
        @click="toggleOverride"
      >
        <span class="wp-loop__switch-thumb" />
      </button>
    </div>

    <div class="wp-loop__section">
      <div class="wp-loop__label">iteration var</div>
      <div class="wp-loop__var-input">
        <span class="wp-loop__var-prefix">$</span>
        <input
          type="text"
          class="wp-loop__var-text"
          :value="modelValue.iteration_var_name"
          data-test="loop-iteration-var"
          aria-label="iteration variable name"
          @input="onIterationVarInput"
        />
        <button
          type="button"
          class="wp-loop__pi-btn"
          :class="{ 'wp-loop__pi-btn--on': modelValue.iteration_internal }"
          data-test="loop-iteration-internal"
          :aria-pressed="modelValue.iteration_internal"
          :title="modelValue.iteration_internal
            ? `Mark $${modelValue.iteration_var_name} as PUBLIC (renders in prompts)`
            : `Mark $${modelValue.iteration_var_name} as INTERNAL (engine-only — strips from prompts)`"
          @click="toggleIterationInternal"
        >
          <i class="pi pi-globe" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="wp-loop__pi-btn"
          :class="{ 'wp-loop__pi-btn--on': modelValue.total_internal }"
          data-test="loop-total-internal"
          :aria-pressed="modelValue.total_internal"
          :title="modelValue.total_internal
            ? `Mark $${modelValue.iteration_var_name}_total as PUBLIC`
            : `Mark $${modelValue.iteration_var_name}_total as INTERNAL`"
          @click="toggleTotalInternal"
        >
          <span class="wp-loop__pi-btn-label">Σ</span>
        </button>
      </div>
    </div>

    <div class="wp-loop__row">
      <span class="wp-loop__row-label">bypass loop</span>
      <button
        type="button"
        class="wp-loop__switch"
        :class="{ 'wp-loop__switch--on': modelValue.bypass }"
        data-test="loop-bypass-toggle"
        :aria-pressed="modelValue.bypass"
        @click="toggleBypass"
      >
        <span class="wp-loop__switch-thumb" />
      </button>
    </div>
  </div>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-loop {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font: 11px var(--wp-font-mono, monospace);
  color: var(--wp-text);
  padding: 4px 0;
}
.wp-loop__section { display: flex; flex-direction: column; gap: 4px; }
.wp-loop__label {
  font: 600 9px var(--wp-font-sans, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
}

.wp-loop__chips { display: flex; gap: 4px; }
.wp-loop__chip {
  flex: 1;
  padding: 4px 6px;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  color: var(--wp-text-muted, #aeb1bb);
  font: 600 10px var(--wp-font-sans, sans-serif);
  cursor: pointer;
}
.wp-loop__chip:hover { color: var(--wp-text); border-color: var(--wp-border-strong, #4a4d55); }
.wp-loop__chip--active {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 18%, transparent);
  border-color: var(--wp-accent, #c4b5fd);
  color: var(--wp-accent, #c4b5fd);
}

.wp-loop__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.wp-loop__row-label {
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #aeb1bb);
}

.wp-loop__switch {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  position: relative;
  padding: 0;
  cursor: pointer;
  transition: background var(--wp-motion-hover, 120ms) ease, border-color var(--wp-motion-hover, 120ms) ease;
}
.wp-loop__switch-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  background: var(--wp-text-dim, #7a7d88);
  border-radius: 50%;
  transition: left var(--wp-motion-hover, 120ms) ease, background var(--wp-motion-hover, 120ms) ease;
}
.wp-loop__switch--on {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 22%, transparent);
  border-color: var(--wp-accent, #c4b5fd);
}
.wp-loop__switch--on .wp-loop__switch-thumb {
  left: 15px;
  background: var(--wp-accent, #c4b5fd);
}

.wp-loop__var-input {
  display: flex;
  align-items: center;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  padding: 0 6px;
}
.wp-loop__var-prefix {
  font: 600 11px var(--wp-font-mono, monospace);
  color: var(--wp-accent, #c4b5fd);
  margin-right: 4px;
}
.wp-loop__var-text {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 4px 0;
  font: 11px var(--wp-font-mono, monospace);
  color: var(--wp-text);
  outline: none;
}
.wp-loop__var-text:focus { color: var(--wp-text); }

.wp-loop__pi-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: 2px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  color: var(--wp-text-dim, #7a7d88);
  cursor: pointer;
  font: 600 11px var(--wp-font-mono, monospace);
}
.wp-loop__pi-btn:hover { color: var(--wp-text); border-color: var(--wp-border-strong, #4a4d55); }
.wp-loop__pi-btn--on {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 18%, transparent);
  border-color: var(--wp-accent, #c4b5fd);
  color: var(--wp-accent, #c4b5fd);
}
.wp-loop__pi-btn .pi { font-size: 11px; }
.wp-loop__pi-btn-label { font: 600 12px var(--wp-font-mono, monospace); line-height: 1; }

/* Bypass-on visually dims the strategy/override/var rows since the loop
 * is effectively off. The bypass row itself stays bright. */
.wp-loop--bypass-on .wp-loop__section,
.wp-loop--bypass-on .wp-loop__row:not(:last-child) {
  opacity: 0.45;
  pointer-events: none;
}

/* Mute / bypass dim — same convention as WP_VarTo* and WP_Cleaner. */
.wp-loop--muted { opacity: 0.45; pointer-events: none; }
.wp-loop--bypassed { opacity: 0.65; }
</style>
