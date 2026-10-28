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
import { computed, ref, watch } from "vue";
import WpSwitch from "../shared/WpSwitch.vue";
import WpButton from "../shared/WpButton.vue";
import WpIconButton from "../shared/WpIconButton.vue";
import WpSegmented, { type SegmentedOption } from "../shared/WpSegmented.vue";
import { vTooltip } from "../shared/tooltip";
import { remapSweepFrames, sweepFrameCount, type ContextLoopConfig, type LoopStrategy, type SweepConfig } from "./types";
import { collectSweepCandidates, sweepSourcesFromRaw, type SweepSourceRaw } from "./sweep-candidates";
import SweepModal from "./SweepModal.vue";
import SeedListModal from "../shared/SeedListModal.vue";
import { deriveLoopSeeds } from "../shared/seed-derive";
import { pushToast } from "../shared/toast-store";
import { currentFrame, setFrame } from "./frame-cursor";
import FrameChips from "../shared/FrameChips.vue";

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
    /** Downstream Context nodes (id + module JSON) the Sweep section
     *  draws its wildcards from. */
    sweepSources?: SweepSourceRaw[];
  }>(),
  { nodeMode: 0, baseSeed: 0, count: 1, previousSeeds: null, sweepSources: () => [] },
);

const emit = defineEmits<{ "update:modelValue": [next: ContextLoopConfig] }>();

/** Frame-grid collapse. Owned by the widget glue so it can persist to
 *  `node.properties` and survive a workflow save. */
const chipsCollapsed = defineModel<boolean>("chipsCollapsed", { default: false });

const STRATEGY_OPTIONS: SegmentedOption<LoopStrategy>[] = [
  { value: "hash_index", label: "hash", hint: "Independent per-iteration; recommended for varied results." },
  { value: "sequential", label: "sequential", hint: "base, base+1, base+2, … Predictable diffs." },
  { value: "prime_stride", label: "stride", hint: "base + i × 1,000,003. Wide spread, deterministic." },
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

const seedsOpen = ref(false);
const lockedCount = computed(() => Object.keys(props.modelValue.seed_locks ?? {}).length);

function onSeedLocks(next: Record<string, number>): void {
  emit("update:modelValue", { ...props.modelValue, seed_locks: next });
}

const bypassedCount = computed(() => (props.modelValue.bypass_frames ?? []).length);
/** 0-based bypassed frame indices — drives the dashed border on edit-frame
 *  chips so bypassed frames read at a glance without opening the modal. */
const bypassSet = computed(() => new Set(props.modelValue.bypass_frames ?? []));
function onBypassFrames(next: number[]): void {
  emit("update:modelValue", { ...props.modelValue, bypass_frames: next });
}

/* ---------------------------------------------------------------------------
 * Modifier-click on a frame chip — lock / bypass without the modal.
 *
 * Both states were already VISIBLE on the chips but only CHANGEABLE two clicks
 * away, inside a modal that covers the node you are reading. Toggling a couple
 * of frames is the common case; the modal earns its place for the bulk
 * operations (lock all, paste a series, out-of-range locks) and keeps them.
 *
 * Modifier choice: Alt-click locks a seed, Ctrl-click bypasses — the reflex
 * pairing users reach for. On macOS Ctrl-click IS a right-click, so Cmd stands
 * in for bypass there (see FrameChips `isBypassChord`); Alt/Option survives the
 * trip on every platform.
 * ------------------------------------------------------------------------- */

/** 0-based locked frame indices. Keys are strings in the config; anything
 *  non-numeric is ignored rather than becoming `NaN` in the set. */
const lockSet = computed(() => {
  const out = new Set<number>();
  for (const k of Object.keys(props.modelValue.seed_locks ?? {})) {
    const n = Number(k);
    if (Number.isInteger(n)) out.add(n);
  }
  return out;
});

/** The seed series this loop WOULD produce — the same values "Lock all" in
 *  the modal writes, so a chip-lock and a modal-lock agree. */
const derivedSeeds = computed(() =>
  deriveLoopSeeds(props.baseSeed, Math.max(1, props.count ?? 1), props.modelValue.strategy),
);

/** In-range frames that are still running. Bypassing the last one would leave
 *  the loop with nothing to execute, so the modal forbids it and so do we. */
const activeFrameCount = computed(() => {
  let n = 0;
  for (let i = 0; i < Math.max(1, props.count ?? 1); i++) if (!bypassSet.value.has(i)) n++;
  return n;
});

function toggleFrameLock(i: number): void {
  const next = { ...(props.modelValue.seed_locks ?? {}) };
  if (lockSet.value.has(i)) delete next[String(i)];
  else next[String(i)] = derivedSeeds.value[i] ?? props.baseSeed;
  emit("update:modelValue", { ...props.modelValue, seed_locks: next });
}

function toggleFrameBypass(i: number): void {
  const on = bypassSet.value.has(i);
  if (!on && activeFrameCount.value <= 1) {
    // Silence here would read as a broken click, and the reason is not
    // guessable from the chip.
    pushToast("A loop needs at least one running frame.", { severity: "warning" });
    return;
  }
  const next = new Set(bypassSet.value);
  if (on) next.delete(i);
  else next.add(i);
  onBypassFrames([...next].sort((a, b) => a - b));
}

const sweepCandidates = computed(() =>
  collectSweepCandidates(sweepSourcesFromRaw(props.sweepSources)),
);

const sweepOpen = ref(false);
/** Frames the sweep will run, or null when it is not driving the loop. */
const sweepFrames = computed(() => sweepFrameCount(props.modelValue));

// The frame being edited must still exist: a lower count drops it, and a
// sweep edit changes what each frame number means, so both go back to base.
watch(() => props.count, (n) => {
  if (currentFrame.value !== null && currentFrame.value >= Math.max(1, n ?? 1)) setFrame(null);
});

function onSweep(next: SweepConfig): void {
  if (currentFrame.value !== null) setFrame(null);
  const cfg = { ...props.modelValue, sweep: next };
  emit("update:modelValue", remapSweepFrames(props.modelValue, cfg, Math.max(1, props.count ?? 1)));
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
      <WpSegmented
        :model-value="modelValue.strategy"
        :options="STRATEGY_OPTIONS"
        size="sm"
        block
        aria-label="Seed strategy"
        test-prefix="loop-strategy"
        @update:model-value="pickStrategy"
      />
    </div>

    <WpButton
      block
      icon="pi-list"
      class="wp-loop__seedbtn"
      data-test="loop-seeds-btn"
      @click="seedsOpen = true"
    >
      Per-iteration seeds
      <span class="wp-loop__seedbtn-fill" />
      <span v-if="lockedCount" class="wp-loop__seedbtn-badge" data-test="loop-seeds-badge">{{ lockedCount }} locked</span>
      <span v-if="bypassedCount" class="wp-loop__seedbtn-badge" data-test="loop-seeds-bypass-badge">{{ bypassedCount }} bypassed</span>
      <i class="pi pi-chevron-right wp-loop__seedbtn-chev" aria-hidden="true" />
    </WpButton>

    <WpButton
      block
      icon="pi-th-large"
      class="wp-loop__seedbtn"
      data-test="loop-sweep-btn"
      hint="Run every combination of the wildcards you pick, one frame each."
      @click="sweepOpen = true"
    >
      Sweep combinations
      <span class="wp-loop__seedbtn-fill" />
      <span v-if="sweepFrames != null" class="wp-loop__seedbtn-badge" data-test="loop-sweep-badge">{{ sweepFrames }} {{ sweepFrames === 1 ? "frame" : "frames" }}</span>
      <span v-else-if="modelValue.sweep.enabled" class="wp-loop__seedbtn-badge wp-loop__seedbtn-badge--dim" data-test="loop-sweep-badge">on</span>
      <i class="pi pi-chevron-right wp-loop__seedbtn-chev" aria-hidden="true" />
    </WpButton>

    <!-- `base` is not a frame: it has no seed to lock and nothing to bypass,
         so it takes no modifiers. -->
    <FrameChips
      label="edit frame"
      :count="Math.max(1, count ?? 1)"
      :locked="[...lockSet]"
      :bypassed="[...bypassSet]"
      v-model:collapsed="chipsCollapsed"
      :current="currentFrame"
      selectable
      show-base
      bypass-interactive
      @select="setFrame"
      @toggle-lock="toggleFrameLock"
      @toggle-bypass="toggleFrameBypass"
    />


    <div
      class="wp-loop__row"
      v-tooltip="OVERRIDE_SEED_TOOLTIP"
    >
      <span class="wp-loop__row-label">Override Context seed</span>
      <WpSwitch
        data-test="loop-override-toggle"
        :model-value="modelValue.override_seed"
        aria-label="Override Context seed"
        @update:model-value="toggleOverride"
      />
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
        <WpIconButton
          icon="pi-globe"
          tone="accent"
          class="wp-loop__pi-btn"
          :pressed="modelValue.iteration_internal"
          data-test="loop-iteration-internal"
          :label="modelValue.iteration_internal ? `Make $${modelValue.iteration_var_name} public` : `Make $${modelValue.iteration_var_name} internal`"
          :hint="modelValue.iteration_internal
            ? `Mark $${modelValue.iteration_var_name} as PUBLIC (renders in prompts)`
            : `Mark $${modelValue.iteration_var_name} as INTERNAL (engine-only — strips from prompts)`"
          @click="toggleIterationInternal"
        />
        <WpIconButton
          tone="accent"
          class="wp-loop__pi-btn"
          :pressed="modelValue.total_internal"
          data-test="loop-total-internal"
          :label="modelValue.total_internal ? `Make $${modelValue.iteration_var_name}_total public` : `Make $${modelValue.iteration_var_name}_total internal`"
          :hint="modelValue.total_internal
            ? `Mark $${modelValue.iteration_var_name}_total as PUBLIC`
            : `Mark $${modelValue.iteration_var_name}_total as INTERNAL`"
          @click="toggleTotalInternal"
        >Σ</WpIconButton>
      </div>
    </div>

    <div class="wp-loop__row">
      <span class="wp-loop__row-label">Bypass loop</span>
      <WpSwitch
        data-test="loop-bypass-toggle"
        aria-label="Bypass loop"
        :model-value="modelValue.bypass"
        @update:model-value="toggleBypass"
      />
    </div>

    <SweepModal
      v-if="sweepOpen"
      :model-value="modelValue.sweep"
      :candidates="sweepCandidates"
      :loop-bypassed="modelValue.bypass"
      @update:model-value="onSweep"
      @close="sweepOpen = false"
    />

    <SeedListModal v-if="seedsOpen" :node-name="'WP Context Loop'" :base-seed="baseSeed"
      :count="count" :strategy="modelValue.strategy" :seed-locks="modelValue.seed_locks ?? {}"
      :previous-seeds="previousSeeds"
      :bypass-frames="modelValue.bypass_frames ?? []"
      :override-hint="!modelValue.override_seed ? 'These seeds apply only when Override Context seed is on.' : ''"
      @update:seed-locks="onSeedLocks" @update:bypass-frames="onBypassFrames" @close="seedsOpen = false" />
  </div>
</template>

<style scoped>
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


.wp-loop__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.wp-loop__row-label {
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #aeb1bb);
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
  color: var(--wp-accent, #6366f1);
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

.wp-loop__seedbtn-badge--dim { opacity: .6; }

/* Mute / bypass dim — same convention as WP_VarTo* and WP_Cleaner. */
.wp-loop--muted { opacity: 0.45; pointer-events: none; }
.wp-loop--bypassed { opacity: 0.65; }
</style>
