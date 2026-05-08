<script setup lang="ts">
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

const props = defineProps<{ module: ModuleEntry }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const instance = computed(() => props.module.instance ?? {});
const locked = computed(() => typeof instance.value.locked_seed === "number");
const seedValue = computed(() =>
  typeof instance.value.locked_seed === "number" ? String(instance.value.locked_seed) : "",
);
const internal = computed(() => instance.value.internal === true);

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

function onHideClick(): void {
  emitInstance({ internal: !internal.value });
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
  <section class="runtime">
    <span class="runtime__label">Runtime</span>

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
      Lock seed
    </button>

    <button
      type="button"
      class="toggle"
      :class="{ 'toggle--on': internal }"
      data-test="runtime-hide"
      role="switch"
      :aria-checked="internal"
      @click="onHideClick"
    >
      <i class="pi pi-eye-slash" aria-hidden="true" />
      Hide from prompt
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
  </section>
</template>

<style scoped>
.runtime {
  padding: 10px 16px;
  background: var(--wp-bg2);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.runtime__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
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
/* Seed input mirrors the OptionRow weight control: themed wrapper
 * holding the number field plus a stacked custom up/down spinner.
 * Native browser spinners hidden via `appearance: textfield` (FF) +
 * `::-webkit-*-spin-button` (Chrome/Safari). The custom buttons step
 * by ±1 (integer seed) and clamp to [0, 0x7fffffff]. */
.seed-input-wrap {
  display: inline-flex;
  align-items: stretch;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  height: 24px;
  /* Wide enough to show a full Number.MAX_SAFE_INTEGER (16 digits)
   * plus the 14px spinner column without overflow. */
  width: 200px;
  overflow: hidden;
}
.seed-input-wrap:focus-within {
  border-color: var(--wp-accent);
}
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
.seed-input:focus {
  outline: none;
}
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
