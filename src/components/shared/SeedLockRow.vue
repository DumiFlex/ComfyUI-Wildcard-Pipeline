<script setup lang="ts">
/** One per-iteration row in SeedListModal — a per-row mirror of the
 *  module SeedLockControls. Unlocked shows the derived seed; locking
 *  captures it; locked exposes a seed input + ±spinners + roll. */
const props = defineProps<{
  index: number;       // 0-based
  derived: number;     // computed seed for this index (preview when unlocked)
  locked: boolean;
  seed: number | null; // locked seed value when locked
}>();
const emit = defineEmits<{ update: [payload: { index: number; seed: number | null }] }>();

const SEED_MAX = (2 ** 50) - 1; // MAX_SAFE_SEED (matches engine)
function randomSeed(): number {
  const hi = Math.floor(Math.random() * 0x40000);     // 18 bits
  const lo = Math.floor(Math.random() * 0x100000000); // 32 bits
  return (hi * 0x100000000 + lo) % (SEED_MAX + 1);
}
function set(seed: number | null) { emit("update", { index: props.index, seed }); }
function onLock() { set(props.locked ? null : props.derived); }
function onInput(ev: Event) {
  const n = Number((ev.target as HTMLInputElement).value.trim());
  if (Number.isFinite(n) && Number.isInteger(n)) set(n);
}
function bump(d: 1 | -1) {
  if (!props.locked || props.seed == null) return;
  set(Math.max(0, Math.min(SEED_MAX, props.seed + d)));
}
</script>

<template>
  <div class="srow" :class="{ 'srow--locked': locked }">
    <span class="srow__idx" data-test="seedrow-idx">#{{ index + 1 }}</span>
    <button type="button" class="toggle" :class="{ 'toggle--on': locked }"
      data-test="seedrow-lock" role="switch" :aria-checked="locked" @click="onLock">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="5" y="11" width="14" height="9" rx="1.5" /><path :d="locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 8 0'" />
      </svg>
      {{ locked ? "Locked" : "Lock" }}
    </button>
    <span class="srow__fill" />
    <span v-if="!locked" class="derived">
      <span class="derived__val" data-test="seedrow-derived">{{ derived }}</span>
      <span class="derived__tag">derived</span>
    </span>
    <span v-else class="seed-controls">
      <span class="seed-input-wrap">
        <input class="seed-input" data-test="seedrow-input" type="number" step="1"
          :value="seed ?? ''" aria-label="Locked seed" @input="onInput" />
        <span class="seed-spin">
          <button type="button" class="seed-spin-btn" tabindex="-1" aria-label="Increase" @click="bump(1)">
            <svg width="6" height="4" viewBox="0 0 8 5"><path d="M0 5 L4 0 L8 5 Z" fill="currentColor" /></svg></button>
          <button type="button" class="seed-spin-btn" tabindex="-1" aria-label="Decrease" @click="bump(-1)">
            <svg width="6" height="4" viewBox="0 0 8 5"><path d="M0 0 L4 5 L8 0 Z" fill="currentColor" /></svg></button>
        </span>
      </span>
      <button type="button" class="seed-roll" data-test="seedrow-roll" title="Random seed"
        aria-label="Random seed" @click="set(randomSeed())">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" /></svg>
      </button>
    </span>
  </div>
</template>

<style scoped>
.srow { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 5px; }
.srow--locked { background: rgba(99,102,241,0.07); box-shadow: inset 2px 0 0 var(--wp-accent, #6366f1); }
.srow__idx { flex-shrink: 0; width: 30px; text-align: right; font: 600 11px var(--wp-font-mono, monospace); color: var(--wp-text-dim, #7a7d88); }
.srow--locked .srow__idx { color: var(--wp-accent-text, #c4b5fd); }
.srow__fill { flex: 1; }
.toggle { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border: 1px solid var(--wp-border); border-radius: 3px; font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); cursor: pointer; background: var(--wp-bg-deep, var(--wp-bg)); flex-shrink: 0; }
.toggle:hover { border-color: var(--wp-border-strong, var(--wp-border2)); }
.toggle svg { color: var(--wp-text-dim, var(--wp-text3)); }
.toggle--on { border-color: var(--wp-accent); color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.10); }
.toggle--on svg { color: var(--wp-accent-text, var(--wp-text)); }
.derived { display: inline-flex; align-items: center; gap: 8px; }
.derived__val { font: 11px var(--wp-font-mono, monospace); color: var(--wp-text4, #888); }
.derived__tag { font: 600 8px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .07em; color: var(--wp-text-dim, var(--wp-text3)); border: 1px solid var(--wp-border); border-radius: 3px; padding: 1px 5px; }
.seed-controls { display: inline-flex; align-items: center; gap: 6px; }
.seed-input-wrap { display: inline-flex; align-items: stretch; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px; height: 24px; width: 178px; overflow: hidden; }
.seed-input-wrap:focus-within { border-color: var(--wp-accent); }
.seed-input { flex: 1; background: transparent; border: 0; padding: 0 7px; font: 11px var(--wp-font-mono, monospace); color: var(--wp-text); text-align: right; min-width: 0; -moz-appearance: textfield; }
.seed-input::-webkit-outer-spin-button, .seed-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.seed-input:focus { outline: none; }
.seed-spin { display: flex; flex-direction: column; width: 14px; flex-shrink: 0; border-left: 1px solid var(--wp-border); background: rgba(99,102,241,.04); }
.seed-spin-btn { flex: 1; display: flex; align-items: center; justify-content: center; background: transparent; border: 0; padding: 0; color: var(--wp-text-dim, var(--wp-text3)); cursor: pointer; line-height: 0; }
.seed-spin-btn + .seed-spin-btn { border-top: 1px solid var(--wp-border); }
.seed-spin-btn:hover { color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.12); }
.seed-roll { background: transparent; border: 0; color: var(--wp-text-dim, var(--wp-text3)); cursor: pointer; padding: 2px 4px; display: flex; }
.seed-roll:hover { color: var(--wp-accent-text, var(--wp-text)); }
</style>
