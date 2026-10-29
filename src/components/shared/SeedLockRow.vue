<script setup lang="ts">
/** One per-iteration row in SeedListModal — a per-row mirror of the
 *  module SeedLockControls. Unlocked shows the derived seed; locking
 *  captures it; locked exposes a seed input + ±spinners + roll. */
import WpNumber from "../../kit/WpNumber.vue";
import WpSwitch from "../../kit/WpSwitch.vue";
import WpButton from "../../kit/WpButton.vue";
import { vTooltip } from "../../kit/tooltip";

const props = defineProps<{
  index: number;       // 0-based
  derived: number;     // computed seed for this index (preview when unlocked)
  locked: boolean;
  seed: number | null; // locked seed value when locked
  /** Locked index beyond the current count — dimmed but still editable;
   *  re-activates if count grows back. */
  inactive?: boolean;
  /** The seed this frame ACTUALLY used on the previous run (captured from the
   *  node's loop series). null/undefined when there's no prior run for this
   *  frame — the "lock previous" button greys out. Distinct from `derived`,
   *  which is the UPCOMING seed computed from the current base. */
  previous?: number | null;
  /** When true, render a per-frame bypass toggle (Context Loop only). */
  bypassable?: boolean;
  /** Whether this frame is currently bypassed. */
  bypassed?: boolean;
  /** Disable the bypass toggle (e.g. it's the last active frame). */
  bypassDisabled?: boolean;
}>();
const emit = defineEmits<{
  update: [payload: { index: number; seed: number | null }];
  bypass: [payload: { index: number; bypassed: boolean }];
}>();

const SEED_MAX = (2 ** 50) - 1; // MAX_SAFE_SEED (matches engine)
function randomSeed(): number {
  const hi = Math.floor(Math.random() * 0x40000);     // 18 bits
  const lo = Math.floor(Math.random() * 0x100000000); // 32 bits
  return (hi * 0x100000000 + lo) % (SEED_MAX + 1);
}
function set(seed: number | null) { emit("update", { index: props.index, seed }); }
function onLock() { set(props.locked ? null : props.derived); }
/** Fill + lock the seed this frame used on the previous run. No-op (button is
 *  disabled) when there's no captured previous for this frame. */
function lockPrevious() { if (props.previous != null) set(props.previous); }
function onSeed(n: number | null) {
  if (n !== null && Number.isInteger(n)) set(n);
}
</script>

<template>
  <div class="srow" :class="{ 'srow--locked': locked, 'srow--inactive': inactive, 'srow--bypassed': bypassed }">
    <span class="srow__idx" data-test="seedrow-idx">#{{ index + 1 }}</span>
    <WpSwitch v-if="bypassable" v-tooltip="bypassed ? 'Frame bypassed — click to re-enable' : 'Bypass this frame (skip its generation)'"
      variant="chip" icon="pi-ban" :label="bypassed ? 'Bypassed' : 'Bypass'" data-test="seedrow-bypass"
      :model-value="bypassed" :disabled="bypassDisabled"
      @update:model-value="emit('bypass', { index, bypassed: !bypassed })" />
    <WpSwitch variant="chip" :icon="locked ? 'pi-lock' : 'pi-lock-open'" :label="locked ? 'Locked' : 'Lock'"
      data-test="seedrow-lock" :model-value="locked" @update:model-value="onLock" />
    <WpButton
      v-tooltip="previous == null
        ? 'No previous run captured for this frame'
        : `Lock the seed this frame used last run (${previous})`"
      variant="outline" icon="pi-history" data-test="seedrow-lockprev"
      :disabled="previous == null"
      @click="lockPrevious">
      Prev
    </WpButton>
    <span class="srow__fill" />
    <span v-if="!locked" class="derived">
      <span class="derived__val" data-test="seedrow-derived">{{ derived }}</span>
      <span class="derived__tag">derived</span>
    </span>
    <span v-else class="seed-controls">
      <WpNumber
        class="seed-input-wrap" :model-value="seed" :min="0" :max="SEED_MAX" commit="input"
        aria-label="Locked seed" data-test="seedrow-input" @update:model-value="onSeed"
      />
      <WpButton
        variant="ghost"
        icon="pi-refresh"
        data-test="seedrow-roll"
        aria-label="Random seed"
        @click="set(randomSeed())"
      />
    </span>
  </div>
</template>

<style scoped>
.srow { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: min(5px, var(--wp-radius-cap, 999px)); }
.srow--locked { background: rgba(99,102,241,0.07); box-shadow: inset 2px 0 0 var(--wp-accent, #6366f1); }
/* out-of-range lock: dimmed ("deemed down") but still interactive — hover lifts it. */
.srow--inactive { opacity: .5; }
.srow--inactive:hover { opacity: .85; }
/* Bypassed row — purple-dimmed wash + a dashed left accent bar so it reads
 * clearly even when the struck-through seed alone is too faint. The dashed
 * bar echoes the loop node's dashed bypass chips. */
.srow--bypassed {
  background:
    repeating-linear-gradient(
      to bottom,
      var(--wp-accent, #6366f1) 0 4px,
      transparent 4px 8px
    ) left / 3px 100% no-repeat,
    color-mix(in srgb, var(--wp-accent, #6366f1) 11%, transparent);
  border-radius: min(5px, var(--wp-radius-cap, 999px));
}
.srow--bypassed .derived__val { text-decoration: line-through; opacity: .65; }
.srow--bypassed .srow__idx { color: var(--wp-accent-text, #a5b4fc); opacity: .75; }
.srow__idx { flex-shrink: 0; width: 30px; text-align: right; font: 600 11px var(--wp-font-mono, monospace); color: var(--wp-text-dim, #7a7d88); }
.srow--locked .srow__idx { color: var(--wp-accent-text, #a5b4fc); }
.srow__fill { flex: 1; }
/* Same shrink rule as the locked column, so a 15-digit derived seed clips
 * instead of shoving the DERIVED tag past the panel edge. */
.derived { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.derived__val { font: 11px var(--wp-font-mono, monospace); color: var(--wp-text4, #888); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.derived__tag { flex-shrink: 0; }
.derived__tag { font: 600 8px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .07em; color: var(--wp-text-dim, var(--wp-text3)); border: 1px solid var(--wp-border); border-radius: min(3px, var(--wp-radius-cap, 999px)); padding: 1px 5px; }
/* The value column has to SHRINK. A locked row carries three fixed-width
 * toggles plus a 178px input and a roll button; on the 486px modal that
 * overran the panel, clipping the input at the right edge and pushing the
 * roll button out of view entirely. `min-width: 0` lets the flex item shrink
 * below its content, and the input wrap now treats 178px as a max rather than
 * a fixed size. */
.seed-controls { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 0 1 auto; }
.seed-input-wrap { flex: 1 1 auto; min-width: 88px; max-width: 178px; }
</style>
