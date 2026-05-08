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

function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
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
      Lock pick
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
      <input
        class="seed-input"
        data-test="runtime-seed"
        type="number"
        step="1"
        :value="seedValue"
        aria-label="Locked seed"
        @input="onSeedInput"
      />
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
.seed-input {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  padding: 3px 7px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  width: 110px;
}
.seed-input:focus {
  border-color: var(--wp-accent);
  outline: none;
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
