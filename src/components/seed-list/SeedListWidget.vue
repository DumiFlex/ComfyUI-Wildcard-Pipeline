<script setup lang="ts">
/**
 * SeedListWidget — DOM widget for WP_SeedList.
 *
 * Owns the strategy chips + the three independent override toggles
 * (seed / count / strategy). `base_seed` and `count` are stock
 * ComfyUI Int widgets (native control_after_generate + min/max
 * validation respectively) so they stay outside this SFC.
 *
 * Value contract: `modelValue` is a `SeedListConfig` object; emit
 * `update:modelValue` with the full new config on any change. The
 * host glue (`src/widgets/seed_list.ts`) serializes to JSON and
 * pushes via `host.setValue` so ComfyUI's widget value matches.
 */
import { computed, ref } from "vue";
import WpSwitch from "../../kit/WpSwitch.vue";
import WpSegmented, { type SegmentedOption } from "../../kit/WpSegmented.vue";
import { vTooltip } from "../../kit/tooltip";
import type { SeedListConfig, SeedListStrategy } from "./types";
import SeedListModal from "../shared/SeedListModal.vue";
import FrameChips from "../shared/FrameChips.vue";
import { deriveLoopSeeds } from "../shared/seed-derive";
import WpButton from "../../kit/WpButton.vue";

const props = withDefaults(
  defineProps<{
    modelValue: SeedListConfig;
    /** Litegraph mode: 0 = ALWAYS (live), 2 = NEVER (muted), 4 = BYPASS.
     *  Drives the dim overlay so canvas-side mute/bypass reads visually. */
    nodeMode?: number;
    /** Effective base seed for the modal preview (already resolved by the host
     *  glue — either local base_seed or the wired loop's seed, depending on
     *  override_seed + whether a loop is connected). */
    baseSeed?: number;
    /** Effective iteration count for the modal preview (resolved by host glue). */
    count?: number;
    /** Effective strategy for the modal preview. When supplied (loop wired +
     *  override_strategy on), the modal uses this instead of modelValue.strategy.
     *  The strategy CHIPS still reflect modelValue.strategy (the local config).
     *  Undefined = use modelValue.strategy (no loop / override off). */
    previewStrategy?: SeedListStrategy;
    /** The seed each frame used on the PREVIOUS run, captured from the node's
     *  executed `loop_seeds` UI payload by the host glue. Drives the seed
     *  modal's per-frame "lock previous" button. Null until a run lands. */
    previousSeeds?: number[] | null;
    /** 0-based frames the wired loop bypasses (resolved by the host glue —
     *  only when Override count from loop is on). Shown READ-ONLY in the
     *  modal (dimmed rows + "N bypassed" badge); bypass is owned by the loop.
     *  Empty when no loop is wired or none are bypassed. */
    bypassedFrames?: number[];
  }>(),
  { nodeMode: 0, baseSeed: 0, count: 1, previewStrategy: undefined, previousSeeds: null, bypassedFrames: () => [] },
);

const emit = defineEmits<{ "update:modelValue": [next: SeedListConfig] }>();

/** Frame-grid collapse. Owned by the widget glue so it can persist to
 *  `node.properties` and survive a workflow save. */
const chipsCollapsed = defineModel<boolean>("chipsCollapsed", { default: false });

const STRATEGIES: SegmentedOption<SeedListStrategy>[] = [
  { value: "hash_index", label: "hash", hint: "Independent per-iteration; recommended for varied results." },
  { value: "sequential", label: "sequential", hint: "base, base+1, base+2, … Predictable diffs." },
  { value: "prime_stride", label: "stride", hint: "base + i × 1,000,003. Wide spread, deterministic." },
];

const OVERRIDE_SEED_TOOLTIP =
  "When ON and a WP Context Loop is wired into loop_config, this node uses " +
  "the loop's base_seed instead of the local base_seed widget. The local " +
  "value stays as the fallback for when the wire is missing.";

const OVERRIDE_COUNT_TOOLTIP =
  "When ON and a WP Context Loop is wired into loop_config, this node uses " +
  "the loop's count instead of the local count widget. The local value " +
  "stays as the fallback for when the wire is missing.";

const OVERRIDE_STRATEGY_TOOLTIP =
  "When ON and a WP Context Loop is wired into loop_config, this node uses " +
  "the loop's strategy instead of the local chips. The local value stays " +
  "as the fallback for when the wire is missing.";

const STRATEGY_LOCKED_TOOLTIP =
  "Strategy is sourced from the wired Loop config — turn off " +
  "'Override strategy from loop' to edit locally.";

const isMuted = computed<boolean>(() => props.nodeMode === 2);
const isBypassed = computed<boolean>(() => props.nodeMode === 4);

const seedsOpen = ref(false);
const lockedCount = computed(() => Object.keys(props.modelValue.seed_locks ?? {}).length);
const bypassedCount = computed(() => props.bypassedFrames.length);

function onSeedLocks(next: Record<string, number>): void {
  emit("update:modelValue", { ...props.modelValue, seed_locks: next });
}

/* ---------------------------------------------------------------------------
 * Frame chips — lock a seed without opening the modal.
 *
 * Unlike the Loop's chips these take a PLAIN click, because this node has no
 * edit cursor: there is nothing else a chip could do, and making people hold
 * Shift for the only available action would be ceremony.
 *
 * Bypass is shown but not editable. It belongs to the WP Context Loop wired
 * into `loop_config` (and only surfaces when "Override count from loop" is
 * on) — changing it here would mean writing to a different node.
 * ------------------------------------------------------------------------ */

const BYPASS_READONLY_HINT = "Bypassed by the wired Context Loop — change it there.";

/** 0-based locked frame indices. Config keys are strings; a non-numeric key
 *  is ignored rather than becoming `NaN` in the set. */
const lockSet = computed(() => {
  const out = new Set<number>();
  for (const k of Object.keys(props.modelValue.seed_locks ?? {})) {
    const n = Number(k);
    if (Number.isInteger(n)) out.add(n);
  }
  return out;
});

/** The seed series this node WOULD produce, using the same effective values
 *  the modal previews with — so a chip-lock and a modal-lock agree. */
const derivedSeeds = computed(() =>
  deriveLoopSeeds(
    props.baseSeed,
    Math.max(1, props.count ?? 1),
    props.previewStrategy ?? props.modelValue.strategy,
  ),
);

function toggleFrameLock(i: number): void {
  const next = { ...(props.modelValue.seed_locks ?? {}) };
  if (lockSet.value.has(i)) delete next[String(i)];
  else next[String(i)] = derivedSeeds.value[i] ?? props.baseSeed;
  emit("update:modelValue", { ...props.modelValue, seed_locks: next });
}

/** True while strategy comes from the upstream loop_config wire.
 *  Mirrors what `setStockWidgetDisabled("count", ...)` does for the count
 *  stock widget in the host glue — chips can't live as a stock widget so
 *  the lock is handled inside the SFC via class + handler guard. */
const strategyLocked = computed<boolean>(() => props.modelValue.override_strategy);
/** While the loop owns the strategy, the locked tooltip on the group says why. */
const strategyOptions = computed(() => STRATEGIES.map((s) => (strategyLocked.value ? { ...s, hint: undefined } : s)));

function pickStrategy(s: SeedListStrategy): void {
  if (strategyLocked.value) return;
  if (props.modelValue.strategy === s) return;
  emit("update:modelValue", { ...props.modelValue, strategy: s });
}

function toggleOverrideSeed(): void {
  emit("update:modelValue", {
    ...props.modelValue,
    override_seed: !props.modelValue.override_seed,
  });
}

function toggleOverrideCount(): void {
  emit("update:modelValue", {
    ...props.modelValue,
    override_count: !props.modelValue.override_count,
  });
}

function toggleOverrideStrategy(): void {
  emit("update:modelValue", {
    ...props.modelValue,
    override_strategy: !props.modelValue.override_strategy,
  });
}
</script>

<template>
  <div
    class="wp-seedlist"
    :class="{
      'wp-seedlist--muted': isMuted,
      'wp-seedlist--bypassed': isBypassed,
    }"
  >
    <div class="wp-seedlist__section">
      <div class="wp-seedlist__label">strategy</div>
      <WpSegmented
        v-tooltip="strategyLocked ? STRATEGY_LOCKED_TOOLTIP : null"
        :model-value="modelValue.strategy"
        :options="strategyOptions"
        size="sm"
        block
        :disabled="strategyLocked"
        aria-label="Seed strategy"
        test-prefix="seedlist-strategy"
        data-test="seedlist-strategy"
        @update:model-value="pickStrategy"
      />
    </div>

    <WpButton
      block
      icon="pi-list"
      class="wp-seedlist__seedbtn"
      data-test="seedlist-seeds-btn"
      @click="seedsOpen = true"
    >
      Per-iteration seeds
      <span class="wp-seedlist__seedbtn-fill" />
      <span v-if="lockedCount" class="wp-seedlist__seedbtn-badge" data-test="seedlist-seeds-badge">{{ lockedCount }} locked</span>
      <span v-if="bypassedCount" class="wp-seedlist__seedbtn-badge" data-test="seedlist-seeds-bypass-badge">{{ bypassedCount }} bypassed</span>
      <i class="pi pi-chevron-right wp-seedlist__seedbtn-chev" aria-hidden="true" />
    </WpButton>

    <!-- Directly under the seeds button it belongs to: the chips are the
         inline view of what that modal lists, so they read as its expansion
         rather than as another unrelated section. -->
    <FrameChips
      label="seeds"
      test-id="seedlist-frame"
      v-model:collapsed="chipsCollapsed"
      :count="Math.max(1, count ?? 1)"
      :locked="[...lockSet]"
      :bypassed="bypassedFrames"
      :bypass-readonly-hint="BYPASS_READONLY_HINT"
      @toggle-lock="toggleFrameLock"
    />

    <div class="wp-seedlist__row" v-tooltip="OVERRIDE_SEED_TOOLTIP">
      <span class="wp-seedlist__row-label">Override base seed from loop</span>
      <WpSwitch
        data-test="seedlist-override-seed-toggle"
        :model-value="modelValue.override_seed"
        aria-label="Override base seed"
        @update:model-value="toggleOverrideSeed"
      />
    </div>

    <div class="wp-seedlist__row" v-tooltip="OVERRIDE_COUNT_TOOLTIP">
      <span class="wp-seedlist__row-label">Override count from loop</span>
      <WpSwitch
        data-test="seedlist-override-count-toggle"
        :model-value="modelValue.override_count"
        aria-label="Override count"
        @update:model-value="toggleOverrideCount"
      />
    </div>

    <div class="wp-seedlist__row" v-tooltip="OVERRIDE_STRATEGY_TOOLTIP">
      <span class="wp-seedlist__row-label">Override strategy from loop</span>
      <WpSwitch
        data-test="seedlist-override-strategy-toggle"
        :model-value="modelValue.override_strategy"
        aria-label="Override strategy"
        @update:model-value="toggleOverrideStrategy"
      />
    </div>
    <SeedListModal v-if="seedsOpen" :node-name="'WP Seed List'" :base-seed="baseSeed"
      :count="count" :strategy="previewStrategy ?? modelValue.strategy" :seed-locks="modelValue.seed_locks ?? {}"
      :previous-seeds="previousSeeds"
      :bypass-frames="bypassedFrames.length ? bypassedFrames : undefined" :bypass-readonly="true"
      :override-hint="modelValue.override_seed ? 'Base seed comes from the wired loop while Override base seed from loop is on.' : ''"
      @update:seed-locks="onSeedLocks" @close="seedsOpen = false" />
  </div>
</template>

<style scoped>
.wp-seedlist {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font: 11px var(--wp-font-mono, monospace);
  color: var(--wp-text);
  padding: 4px 0;
}
.wp-seedlist__section { display: flex; flex-direction: column; gap: 4px; }
.wp-seedlist__label {
  font: 600 9px var(--wp-font-sans, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
}

.wp-seedlist__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.wp-seedlist__row-label {
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #aeb1bb);
  flex: 1;
}


/* Mute / bypass dim — same convention as WP_VarTo* and WP_ContextLoop. */
.wp-seedlist--muted { opacity: 0.45; pointer-events: none; }
.wp-seedlist--bypassed { opacity: 0.65; }

.wp-seedlist__seedbtn-fill { flex: 1; }
.wp-seedlist__seedbtn-badge { font: 600 8px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .05em; padding: 2px 6px; border-radius: min(3px, var(--wp-radius-cap, 999px)); color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.14); border: 1px solid color-mix(in srgb, var(--wp-accent) 40%, transparent); }
.wp-seedlist__seedbtn-chev { color: var(--wp-text-dim, var(--wp-text3)); }
</style>
