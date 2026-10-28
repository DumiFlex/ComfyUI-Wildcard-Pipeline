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
import WpSwitch from "../../../../shared/WpSwitch.vue";

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

// "Match variable": pick the option whose text equals `$<name>` instead of
// rolling (engine `_match_variable_option`). Stored bare, absent when empty.
const matchVar = computed(() =>
  typeof instance.value.match_variable === "string" ? instance.value.match_variable : "",
);
function onMatchInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value.replace(/^\$/, "").trim();
  const next: Record<string, unknown> = { ...instance.value };
  if (raw) next.match_variable = raw;
  else delete next.match_variable;
  emit("update", { instance: next as ModuleEntry["instance"] });
}
</script>

<template>
  <section class="runtime">
    <span class="runtime__label">Runtime</span>
    <SeedLockControls :module="module" label="Lock pick" @update="emit('update', $event)" />
    <WpSwitch
      variant="chip"
      icon="pi-eye-slash"
      label="Hide from prompt"
      data-test="runtime-hide"
      :model-value="internal"
      :disabled="frameActive"
      @update:model-value="onHideClick"
    />
    <WpSwitch
      variant="chip"
      icon="pi-link"
      label="Hold across run"
      data-test="runtime-hold"
      :model-value="held"
      :disabled="frameActive"
      @update:model-value="onHoldClick"
    />
    <label class="match" :class="{ 'match--on': matchVar }" data-test="runtime-match">
      <i class="pi pi-equals" aria-hidden="true" />
      <span>Match variable</span>
      <span class="match__sigil">$</span>
      <input
        class="match__input"
        type="text"
        spellcheck="false"
        placeholder="model_variant"
        data-test="runtime-match-input"
        :value="matchVar"
        :disabled="frameActive || undefined"
        @change="onMatchInput"
      >
    </label>
    <p
      v-if="matchVar"
      class="runtime__frame-hint"
      data-test="runtime-match-hint"
    >Picks the option whose text equals ${{ matchVar }}. No match uses the fallback option, else rolls as usual.</p>
    <p
      v-if="frameActive"
      class="runtime__frame-hint"
      data-test="runtime-frame-hint"
    >Hide from prompt, Hold across run and Match variable apply to every frame — switch to base to change.</p>
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
.match {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 10px;
  border: 1px solid var(--wp-border);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font: 11px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  background: var(--wp-bg-deep, var(--wp-bg));
}
.match .pi { font-size: 11px; color: var(--wp-text-dim, var(--wp-text3)); }
.match--on { border-color: var(--wp-accent); color: var(--wp-accent-text, var(--wp-text)); }
.match__sigil { font-family: var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); margin-right: -4px; }
.match__input {
  width: 120px;
  padding: 2px 6px;
  border: 1px solid var(--wp-border-soft, var(--wp-border));
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg2);
  color: var(--wp-text);
  font: 11px var(--wp-font-mono, monospace);
}
.match__input:disabled { opacity: 0.45; cursor: not-allowed; }
.runtime__frame-hint {
  margin: 4px 0 0;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
</style>
