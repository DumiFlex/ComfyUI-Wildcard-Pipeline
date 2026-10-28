<script setup lang="ts">
/**
 * SeedLockControls — shared lock-seed UI used by every kind that
 * honors `instance.locked_seed` (wildcard / combine / fixed_values).
 *
 * Owns the lock toggle, the seed number input + ±1 spinners, the
 * roll-random button, and the `_ui.last_locked_seed` memory pattern
 * for restoring the user's seed when they toggle off→on.
 *
 * Why extracted: wildcard shipped first, combine + fixed_values
 * copied it verbatim (only the toggle label differs). With three
 * copies in the codebase, fixing a bug in one means fixing three.
 * Now there's one source of truth — kind-specific RuntimeSections
 * mount this component plus their own kind-specific extras (e.g.
 * Hide-from-prompt toggle). The label stays a prop so each kind can
 * use the verb that fits ("Lock pick" for wildcard's option pick;
 * "Lock seed" for combine + fixed_values' alternation roll).
 *
 * The data-test ids match what the previous standalone RuntimeSection
 * tests expected — `runtime-lock`, `runtime-seed`, `runtime-roll`,
 * `runtime-seed-up`, `runtime-seed-down` — so the existing test
 * suites pass without modification.
 */
import { computed, inject } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import { LockSeedKey } from "../../lock-seed-ctx";
import WpNumber from "../../../shared/WpNumber.vue";
import WpSwitch from "../../../shared/WpSwitch.vue";
import WpButton from "../../../shared/WpButton.vue";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    /** Verb on the lock toggle. Wildcard says "Lock pick" (the option
     *  pick), combine + fixed_values say "Lock seed" (the alternation
     *  roll). Defaults to "Lock seed" — the more common case. */
    label?: string;
  }>(),
  { label: "Lock seed" },
);
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

// The seed the module actually rolled — provided by ContextWidget. Used as the
// default when locking so "Lock" pins what the user saw, not a fresh random.
const lockSeedFor = inject(LockSeedKey, null);

const instance = computed(() => props.module.instance ?? {});
const locked = computed(() => typeof instance.value.locked_seed === "number");
const seedValue = computed(() =>
  typeof instance.value.locked_seed === "number" ? instance.value.locked_seed : null,
);

function emitInstance(patchFields: Record<string, unknown>): void {
  const next = { ...instance.value, ...patchFields };
  emit("update", { instance: next });
}

/** Match ComfyUI's seed widget range — server-side seeds run up to
 *  2^64-1, but JS `Number` only represents integers exactly up to
 *  2^53-1 (`Number.MAX_SAFE_INTEGER`). Picking that as the ceiling
 *  keeps the value round-trippable through JSON without precision
 *  loss. ComfyUI's stock seed widget already operates inside this
 *  same safe range, so locked seeds compose cleanly. */
const SEED_MAX = Number.MAX_SAFE_INTEGER;

function randomSeed(): number {
  // `Math.random() * SEED_MAX` loses precision near the top of the
  // range; combining two 32-bit halves keeps the distribution uniform
  // across the full safe-integer space.
  const hi = Math.floor(Math.random() * 0x200000); // top 21 bits
  const lo = Math.floor(Math.random() * 0x100000000); // bottom 32 bits
  return hi * 0x100000000 + lo;
}

function onLockClick(): void {
  if (locked.value) {
    // Toggling off — preserve _ui.last_locked_seed for the next on-toggle.
    emitInstance({ locked_seed: null });
  } else {
    const ui = instance.value._ui ?? {};
    const remembered = typeof ui.last_locked_seed === "number" ? ui.last_locked_seed : null;
    // Prefer the seed the module ACTUALLY rolled (frame #k's captured seed, or
    // the last-run seed) so locking reproduces what the user saw; then the
    // remembered seed; a fresh random only as a last resort.
    const resolved = lockSeedFor?.(props.module);
    const seed = typeof resolved === "number" ? resolved : (remembered ?? randomSeed());
    emitInstance({
      locked_seed: seed,
      _ui: { ...ui, last_locked_seed: seed },
    });
  }
}

function onSeedInput(n: number | null): void {
  if (n === null || !Number.isInteger(n)) return;
  const ui = instance.value._ui ?? {};
  emitInstance({
    locked_seed: n,
    _ui: { ...ui, last_locked_seed: n },
  });
}

function onRollClick(): void {
  const seed = randomSeed();
  const ui = instance.value._ui ?? {};
  emitInstance({
    locked_seed: seed,
    _ui: { ...ui, last_locked_seed: seed },
  });
}
</script>

<template>
  <WpSwitch
    variant="chip"
    icon="pi-lock"
    :label="label"
    data-test="runtime-lock"
    :model-value="locked"
    @update:model-value="onLockClick"
  />

  <div v-if="locked" class="seed-block">
    <span class="seed-block__label">Seed</span>
    <WpNumber
      class="seed-input-wrap" :model-value="seedValue" :min="0" :max="SEED_MAX" commit="input"
      aria-label="Locked seed" up-label="Increase seed" down-label="Decrease seed"
      data-test="runtime-seed" @update:model-value="onSeedInput"
    />
    <WpButton
      variant="ghost"
      icon="pi-refresh"
      data-test="runtime-roll"
      tip="Generate random seed"
      aria-label="Generate random seed"
      @click="onRollClick"
    />
  </div>
</template>

<style scoped>
.seed-block {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: rgba(99, 102, 241, 0.06);
  border-left: 2px solid var(--wp-accent);
  border-radius: 0 3px 3px 0;
}
.seed-block__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--wp-accent-text, var(--wp-text));
}
.seed-input-wrap { width: 200px; }
</style>
