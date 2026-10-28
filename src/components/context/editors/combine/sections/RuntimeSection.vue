<script setup lang="ts">
/**
 * Combine RuntimeSection — composes the shared `<SeedLockControls />`
 * (default "Lock seed" label; combine pins inline `{a|b|c}`
 * alternation resolution, not an option pick) plus the
 * Hide-from-prompt toggle.
 *
 * Slimmed during the 2026-05-09 extraction — previously held a
 * verbatim copy of wildcard's lock UI.
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
</script>

<template>
  <section class="runtime">
    <span class="runtime__label">Runtime</span>
    <SeedLockControls :module="module" @update="emit('update', $event)" />
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
.runtime__frame-hint {
  margin: 4px 0 0;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
</style>
