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
import { computed, ref } from "vue";
import type { ContextLoopConfig, LoopStrategy } from "./types";
import SeedListModal from "../shared/SeedListModal.vue";
import { currentFrame, setFrame } from "./frame-cursor";

const props = withDefaults(
  defineProps<{
    modelValue: ContextLoopConfig;
    /** Litegraph mode: 0 = ALWAYS (live), 2 = NEVER (muted), 4 = BYPASS.
     *  Drives the dim overlay so canvas-side mute/bypass reads visually. */
    nodeMode?: number;
    /** Base seed forwarded from the host ComfyUI INT widget. */
    baseSeed?: number;
    /** Iteration count forwarded from the host ComfyUI INT widget. */
    count?: number;
    /** The seed each frame used on the PREVIOUS run, captured from the node's
     *  executed `loop_seeds` UI payload by the host glue. Drives the seed
     *  modal's per-frame "lock previous" button. Null until a run lands. */
    previousSeeds?: number[] | null;
  }>(),
  { nodeMode: 0, baseSeed: 0, count: 1, previousSeeds: null },
);

const emit = defineEmits<{ "update:modelValue": [next: ContextLoopConfig] }>();

const STRATEGIES: { id: LoopStrategy; label: string; hint: string }[] = [
  { id: "hash_index", label: "hash", hint: "Independent per-iteration; recommended for varied results." },
  { id: "sequential", label: "sequential", hint: "base, base+1, base+2, … Predictable diffs." },
  { id: "prime_stride", label: "stride", hint: "base + i × 1,000,003. Wide spread, deterministic." },
];

/** Same wording as the WP_ContextLoop schema-level tooltip for the
 *  override toggle — surfaces on hover for the SFC row. Long form so
 *  users see exactly what flipping it changes downstream. */
const OVERRIDE_SEED_TOOLTIP =
  "When ON, the loop chooses the seed for every iteration so the whole batch " +
  "is reproducible from this Loop's seed widget — each downstream WP Context " +
  "ignores its own seed and uses the loop's. When OFF (default), each WP " +
  "Context keeps its own seed and the loop only nudges per-iteration variation " +
  "on top.";

const isMuted = computed<boolean>(() => props.nodeMode === 2);
const isBypassed = computed<boolean>(() => props.nodeMode === 4);
const frameChips = computed(() =>
  Array.from({ length: Math.max(1, props.count ?? 1) }, (_, i) => i),
);

const seedsOpen = ref(false);
const lockedCount = computed(() => Object.keys(props.modelValue.seed_locks ?? {}).length);

function onSeedLocks(next: Record<string, number>): void {
  emit("update:modelValue", { ...props.modelValue, seed_locks: next });
}

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

    <button type="button" class="wp-loop__seedbtn" data-test="loop-seeds-btn" @click="seedsOpen = true">
      <span class="wp-loop__seedbtn-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="20" cy="18" r="1.4" fill="currentColor" stroke="none" /></svg></span>
      Per-iteration seeds
      <span class="wp-loop__seedbtn-fill" />
      <span v-if="lockedCount" class="wp-loop__seedbtn-badge" data-test="loop-seeds-badge">{{ lockedCount }} locked</span>
      <svg class="wp-loop__seedbtn-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6" /></svg>
    </button>

    <div class="wp-loop__section">
      <div class="wp-loop__label">edit frame</div>
      <div class="wp-loop__chips" role="radiogroup" aria-label="Edit frame">
        <button type="button" class="wp-loop__chip" :class="{ 'wp-loop__chip--active': currentFrame === null }"
          data-test="loop-frame-base" role="radio" :aria-checked="currentFrame === null" @click="setFrame(null)">base</button>
        <button v-for="i in frameChips" :key="i" type="button" class="wp-loop__chip"
          :class="{ 'wp-loop__chip--active': currentFrame === i }"
          :data-test="`loop-frame-${i + 1}`" role="radio" :aria-checked="currentFrame === i" @click="setFrame(i)">#{{ i + 1 }}</button>
      </div>
    </div>

    <div
      class="wp-loop__row"
      :title="OVERRIDE_SEED_TOOLTIP"
    >
      <span class="wp-loop__row-label">Override Context seed</span>
      <button
        type="button"
        class="wp-loop__switch"
        :class="{ 'wp-loop__switch--on': modelValue.override_seed }"
        data-test="loop-override-toggle"
        :aria-pressed="modelValue.override_seed"
        :aria-label="`Override Context seed: ${modelValue.override_seed ? 'on' : 'off'}`"
        :title="OVERRIDE_SEED_TOOLTIP"
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
      <span class="wp-loop__row-label">Bypass loop</span>
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

    <SeedListModal v-if="seedsOpen" :node-name="'WP Context Loop'" :base-seed="baseSeed"
      :count="count" :strategy="modelValue.strategy" :seed-locks="modelValue.seed_locks ?? {}"
      :previous-seeds="previousSeeds"
      :override-hint="!modelValue.override_seed ? 'These seeds apply only when Override Context seed is on.' : ''"
      @update:seed-locks="onSeedLocks" @close="seedsOpen = false" />
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

/* Grid (not flex) so the frame chips WRAP onto multiple rows instead of
   overflowing the node at high iteration counts. auto-fill keeps a uniform
   cell width; the last row's chips grow to 1fr to fill it. */
.wp-loop__chips {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 4px;
}
.wp-loop__chip {
  padding: 4px 6px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  width: 18px;
  height: 18px;
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
.wp-loop__pi-btn .pi { font-size: 9px; }
.wp-loop__pi-btn-label { font: 600 10px var(--wp-font-mono, monospace); line-height: 1; }

.wp-loop__seedbtn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 9px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px; color: var(--wp-text-muted, var(--wp-text2)); font: 600 10.5px var(--wp-font-sans); cursor: pointer; }
.wp-loop__seedbtn:hover { border-color: var(--wp-accent); color: var(--wp-accent-text, var(--wp-text)); }
.wp-loop__seedbtn-ico { color: var(--wp-accent); display: flex; }
.wp-loop__seedbtn-fill { flex: 1; }
.wp-loop__seedbtn-badge { font: 600 8px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .05em; padding: 2px 6px; border-radius: 3px; color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.14); border: 1px solid color-mix(in srgb, var(--wp-accent) 40%, transparent); }
.wp-loop__seedbtn-chev { color: var(--wp-text-dim, var(--wp-text3)); }

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
