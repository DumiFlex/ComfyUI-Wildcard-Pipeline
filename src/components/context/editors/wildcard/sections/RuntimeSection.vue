<script setup lang="ts">
/**
 * Wildcard RuntimeSection — composes the shared `<SeedLockControls />`
 * (label "Lock pick" because wildcard pins an option pick, not an
 * alternation roll) plus the kind-specific Hide-from-prompt toggle.
 *
 * Kept thin since the 2026-05-09 extraction; previous body lived
 * inline alongside two verbatim copies for combine + fixed_values.
 */
import { computed } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import SeedLockControls from "../../_shared/SeedLockControls.vue";

const props = defineProps<{ module: ModuleEntry; frameActive?: boolean }>();
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const instance = computed(() => props.module.instance ?? {});
const internal = computed(() => instance.value.internal === true);

function onHideClick(): void {
  emit("update", { instance: { ...instance.value, internal: !internal.value } });
}

const held = computed(() => instance.value.seed_scope === "hold");
function onHoldClick(): void {
  emit("update", { instance: { ...instance.value, seed_scope: held.value ? "vary" : "hold" } });
}
</script>

<template>
  <section class="runtime">
    <span class="runtime__label">Runtime</span>
    <SeedLockControls :module="module" label="Lock pick" @update="emit('update', $event)" />
    <button
      type="button"
      class="toggle"
      :class="{ 'toggle--on': internal }"
      data-test="runtime-hide"
      role="switch"
      :aria-checked="internal"
      :disabled="frameActive || undefined"
      @click="onHideClick"
    >
      <i class="pi pi-eye-slash" aria-hidden="true" />
      Hide from prompt
    </button>
    <button
      type="button"
      class="toggle"
      :class="{ 'toggle--on': held }"
      data-test="runtime-hold"
      role="switch"
      :aria-checked="held"
      :disabled="frameActive || undefined"
      @click="onHoldClick"
    >
      <i class="pi pi-link" aria-hidden="true" />
      Hold across run
    </button>
    <p
      v-if="frameActive"
      class="runtime__frame-hint"
      data-test="runtime-frame-hint"
    >Hide from prompt and Hold across run apply to every frame — switch to base to change.</p>
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
.toggle:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.runtime__frame-hint {
  margin: 4px 0 0;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
</style>
