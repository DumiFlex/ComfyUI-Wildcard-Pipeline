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
import type { SeedListConfig, SeedListStrategy } from "./types";
import SeedListModal from "../shared/SeedListModal.vue";

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
  }>(),
  { nodeMode: 0, baseSeed: 0, count: 1, previewStrategy: undefined, previousSeeds: null },
);

const emit = defineEmits<{ "update:modelValue": [next: SeedListConfig] }>();

const STRATEGIES: { id: SeedListStrategy; label: string; hint: string }[] = [
  { id: "hash_index", label: "hash", hint: "Independent per-iteration; recommended for varied results." },
  { id: "sequential", label: "sequential", hint: "base, base+1, base+2, … Predictable diffs." },
  { id: "prime_stride", label: "stride", hint: "base + i × 1,000,003. Wide spread, deterministic." },
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

function onSeedLocks(next: Record<string, number>): void {
  emit("update:modelValue", { ...props.modelValue, seed_locks: next });
}

/** True while strategy comes from the upstream loop_config wire.
 *  Mirrors what `setStockWidgetDisabled("count", ...)` does for the count
 *  stock widget in the host glue — chips can't live as a stock widget so
 *  the lock is handled inside the SFC via class + handler guard. */
const strategyLocked = computed<boolean>(() => props.modelValue.override_strategy);

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
      <div
        class="wp-seedlist__chips"
        :class="{ 'wp-seedlist__chips--locked': strategyLocked }"
        :title="strategyLocked ? STRATEGY_LOCKED_TOOLTIP : undefined"
        :aria-disabled="strategyLocked"
        role="radiogroup"
        aria-label="seed strategy"
      >
        <button
          v-for="s in STRATEGIES"
          :key="s.id"
          type="button"
          class="wp-seedlist__chip"
          :class="{ 'wp-seedlist__chip--active': modelValue.strategy === s.id }"
          :data-test="`seedlist-strategy-${s.id}`"
          :title="strategyLocked ? STRATEGY_LOCKED_TOOLTIP : s.hint"
          :disabled="strategyLocked"
          role="radio"
          :aria-checked="modelValue.strategy === s.id"
          @click="pickStrategy(s.id)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <button type="button" class="wp-seedlist__seedbtn" data-test="seedlist-seeds-btn" @click="seedsOpen = true">
      <span class="wp-seedlist__seedbtn-ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="20" cy="18" r="1.4" fill="currentColor" stroke="none" /></svg></span>
      Per-iteration seeds
      <span class="wp-seedlist__seedbtn-fill" />
      <span v-if="lockedCount" class="wp-seedlist__seedbtn-badge" data-test="seedlist-seeds-badge">{{ lockedCount }} locked</span>
      <svg class="wp-seedlist__seedbtn-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6" /></svg>
    </button>

    <div class="wp-seedlist__row" :title="OVERRIDE_SEED_TOOLTIP">
      <span class="wp-seedlist__row-label">Override base seed from loop</span>
      <button
        type="button"
        class="wp-seedlist__switch"
        :class="{ 'wp-seedlist__switch--on': modelValue.override_seed }"
        data-test="seedlist-override-seed-toggle"
        :aria-pressed="modelValue.override_seed"
        :aria-label="`Override base seed: ${modelValue.override_seed ? 'on' : 'off'}`"
        :title="OVERRIDE_SEED_TOOLTIP"
        @click="toggleOverrideSeed"
      >
        <span class="wp-seedlist__switch-thumb" />
      </button>
    </div>

    <div class="wp-seedlist__row" :title="OVERRIDE_COUNT_TOOLTIP">
      <span class="wp-seedlist__row-label">Override count from loop</span>
      <button
        type="button"
        class="wp-seedlist__switch"
        :class="{ 'wp-seedlist__switch--on': modelValue.override_count }"
        data-test="seedlist-override-count-toggle"
        :aria-pressed="modelValue.override_count"
        :aria-label="`Override count: ${modelValue.override_count ? 'on' : 'off'}`"
        :title="OVERRIDE_COUNT_TOOLTIP"
        @click="toggleOverrideCount"
      >
        <span class="wp-seedlist__switch-thumb" />
      </button>
    </div>

    <div class="wp-seedlist__row" :title="OVERRIDE_STRATEGY_TOOLTIP">
      <span class="wp-seedlist__row-label">Override strategy from loop</span>
      <button
        type="button"
        class="wp-seedlist__switch"
        :class="{ 'wp-seedlist__switch--on': modelValue.override_strategy }"
        data-test="seedlist-override-strategy-toggle"
        :aria-pressed="modelValue.override_strategy"
        :aria-label="`Override strategy: ${modelValue.override_strategy ? 'on' : 'off'}`"
        :title="OVERRIDE_STRATEGY_TOOLTIP"
        @click="toggleOverrideStrategy"
      >
        <span class="wp-seedlist__switch-thumb" />
      </button>
    </div>
    <SeedListModal v-if="seedsOpen" :node-name="'WP Seed List'" :base-seed="baseSeed"
      :count="count" :strategy="previewStrategy ?? modelValue.strategy" :seed-locks="modelValue.seed_locks ?? {}"
      :previous-seeds="previousSeeds"
      :override-hint="modelValue.override_seed ? 'Base seed comes from the wired loop while Override base seed from loop is on.' : ''"
      @update:seed-locks="onSeedLocks" @close="seedsOpen = false" />
  </div>
</template>

<style scoped>
@import "../shared/theme.css";

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

.wp-seedlist__chips { display: flex; gap: 4px; }
.wp-seedlist__chip {
  flex: 1;
  padding: 4px 6px;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  color: var(--wp-text-muted, #aeb1bb);
  font: 600 10px var(--wp-font-sans, sans-serif);
  cursor: pointer;
}
.wp-seedlist__chip:hover { color: var(--wp-text); border-color: var(--wp-border-strong, #4a4d55); }
.wp-seedlist__chip--active {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 18%, transparent);
  border-color: var(--wp-accent, #c4b5fd);
  color: var(--wp-accent, #c4b5fd);
}
.wp-seedlist__chip:disabled { cursor: not-allowed; }
/* Wrapper dims so the lock reads at a glance. Click blocking is the
 * `:disabled` attribute on each chip (pointer-events:none here would
 * suppress the hover-tooltip and the cursor change). */
.wp-seedlist__chips--locked { opacity: 0.45; }

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

.wp-seedlist__switch {
  flex-shrink: 0;
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
.wp-seedlist__switch-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  background: var(--wp-text-dim, #7a7d88);
  border-radius: 50%;
  transition: left var(--wp-motion-hover, 120ms) ease, background var(--wp-motion-hover, 120ms) ease;
}
.wp-seedlist__switch--on {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 22%, transparent);
  border-color: var(--wp-accent, #c4b5fd);
}
.wp-seedlist__switch--on .wp-seedlist__switch-thumb {
  left: 15px;
  background: var(--wp-accent, #c4b5fd);
}

/* Mute / bypass dim — same convention as WP_VarTo* and WP_ContextLoop. */
.wp-seedlist--muted { opacity: 0.45; pointer-events: none; }
.wp-seedlist--bypassed { opacity: 0.65; }

.wp-seedlist__seedbtn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 9px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px; color: var(--wp-text-muted, var(--wp-text2)); font: 600 10.5px var(--wp-font-sans); cursor: pointer; }
.wp-seedlist__seedbtn:hover { border-color: var(--wp-accent); color: var(--wp-accent-text, var(--wp-text)); }
.wp-seedlist__seedbtn-ico { color: var(--wp-accent); display: flex; }
.wp-seedlist__seedbtn-fill { flex: 1; }
.wp-seedlist__seedbtn-badge { font: 600 8px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .05em; padding: 2px 6px; border-radius: 3px; color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.14); border: 1px solid color-mix(in srgb, var(--wp-accent) 40%, transparent); }
.wp-seedlist__seedbtn-chev { color: var(--wp-text-dim, var(--wp-text3)); }
</style>
