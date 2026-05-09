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
import { computed } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

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

const instance = computed(() => props.module.instance ?? {});
const locked = computed(() => typeof instance.value.locked_seed === "number");
const seedValue = computed(() =>
  typeof instance.value.locked_seed === "number" ? String(instance.value.locked_seed) : "",
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
    const seed = remembered ?? randomSeed();
    emitInstance({
      locked_seed: seed,
      _ui: { ...ui, last_locked_seed: seed },
    });
  }
}

function onSeedInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value.trim();
  if (raw === "") return;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return;
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

function bumpSeed(direction: 1 | -1): void {
  if (!locked.value) return;
  const current = typeof instance.value.locked_seed === "number"
    ? instance.value.locked_seed
    : 0;
  // Clamp to [0, SEED_MAX] — same safe-integer range as randomSeed.
  const next = Math.max(0, Math.min(SEED_MAX, current + direction));
  const ui = instance.value._ui ?? {};
  emitInstance({
    locked_seed: next,
    _ui: { ...ui, last_locked_seed: next },
  });
}
</script>

<template>
  <button
    type="button"
    class="toggle"
    :class="{ 'toggle--on': locked }"
    data-test="runtime-lock"
    role="switch"
    :aria-checked="locked"
    @click="onLockClick"
  >
    <i class="pi pi-lock" aria-hidden="true" />
    {{ label }}
  </button>

  <div v-if="locked" class="seed-block">
    <span class="seed-block__label">Seed</span>
    <span class="seed-input-wrap">
      <input
        class="seed-input"
        data-test="runtime-seed"
        type="number"
        step="1"
        :value="seedValue"
        aria-label="Locked seed"
        @input="onSeedInput"
      />
      <span class="seed-spin">
        <button
          type="button"
          class="seed-spin-btn"
          data-test="runtime-seed-up"
          tabindex="-1"
          aria-label="Increase seed"
          @click="bumpSeed(1)"
        ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
          <path d="M0 5 L4 0 L8 5 Z" fill="currentColor" />
        </svg></button>
        <button
          type="button"
          class="seed-spin-btn"
          data-test="runtime-seed-down"
          tabindex="-1"
          aria-label="Decrease seed"
          @click="bumpSeed(-1)"
        ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
          <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
        </svg></button>
      </span>
    </span>
    <button
      type="button"
      class="seed-roll"
      data-test="runtime-roll"
      title="Generate random seed"
      aria-label="Generate random seed"
      @click="onRollClick"
    >
      <i class="pi pi-refresh" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: pointer;
  background: var(--wp-bg-deep, var(--wp-bg));
}
.toggle:hover { border-color: var(--wp-border-soft, var(--wp-border)); }
.toggle .pi { font-size: 11px; color: var(--wp-text-dim, var(--wp-text3)); }
.toggle--on {
  border-color: var(--wp-accent);
  color: var(--wp-accent-text, var(--wp-text));
  background: rgba(99, 102, 241, 0.10);
}
.toggle--on .pi { color: var(--wp-accent-text, var(--wp-text)); }
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
.seed-input-wrap {
  display: inline-flex;
  align-items: stretch;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  height: 24px;
  width: 200px;
  overflow: hidden;
}
.seed-input-wrap:focus-within { border-color: var(--wp-accent); }
.seed-input {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0 7px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  text-align: right;
  min-width: 0;
  -moz-appearance: textfield;
}
.seed-input::-webkit-outer-spin-button,
.seed-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.seed-input:focus { outline: none; }
.seed-spin {
  display: flex;
  flex-direction: column;
  width: 14px;
  flex-shrink: 0;
  border-left: 1px solid var(--wp-border);
  background: rgba(99, 102, 241, 0.04);
}
.seed-spin-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  line-height: 0;
}
.seed-spin-btn + .seed-spin-btn {
  border-top: 1px solid var(--wp-border);
}
.seed-spin-btn:hover {
  color: var(--wp-accent-text, var(--wp-text));
  background: rgba(99, 102, 241, 0.12);
}
.seed-roll {
  background: transparent;
  border: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 2px 4px;
  font-size: 10px;
}
.seed-roll:hover { color: var(--wp-accent-text, var(--wp-text)); }
</style>
