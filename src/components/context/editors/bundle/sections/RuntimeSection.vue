<script setup lang="ts">
/** Bundle runtime — master Lock + Hide toggles that cascade across
 *  every applicable child. Tri-state (all / none / partial) matches
 *  the BundleHeader button visual. Stateless: parent calls the same
 *  `toggleBundleLock` / `toggleBundleInternal` handlers the header
 *  buttons use. `null` state hides the button entirely. */
import WpSwitch from "../../../../../kit/WpSwitch.vue";
import { vTooltip } from "../../../../../kit/tooltip";

const props = withDefaults(
  defineProps<{
    lockState?: "all" | "none" | "partial" | null;
    internalState?: "all" | "none" | "partial" | null;
  }>(),
  { lockState: null, internalState: null },
);
const emit = defineEmits<{
  (e: "toggle-lock"): void;
  (e: "toggle-internal"): void;
}>();
</script>

<template>
  <section class="runtime">
    <span class="runtime__label">Runtime</span>
    <WpSwitch
      v-if="props.lockState !== null"
      v-tooltip="props.lockState === 'all'
        ? 'Unlock seeds on all lockable children'
        : props.lockState === 'partial'
          ? 'Lock seeds on all lockable children (some already locked)'
          : 'Lock seeds on all lockable children — freezes each at its current roll'"
      variant="chip"
      icon="pi-lock"
      label="Lock all picks"
      data-test="bdm-toggle-lock"
      :model-value="props.lockState === 'all'"
      :mixed="props.lockState === 'partial'"
      @update:model-value="emit('toggle-lock')"
    />
    <WpSwitch
      v-if="props.internalState !== null"
      v-tooltip="props.internalState === 'all'
        ? 'Clear internal on all children'
        : props.internalState === 'partial'
          ? 'Mark all children internal (some already)'
          : 'Mark all children internal — hides them from PromptAssembler'"
      variant="chip"
      icon="pi-eye-slash"
      label="Hide all from prompt"
      data-test="bdm-toggle-internal"
      :model-value="props.internalState === 'all'"
      :mixed="props.internalState === 'partial'"
      @update:model-value="emit('toggle-internal')"
    />
    <span v-if="props.lockState === null && props.internalState === null" class="runtime__empty">
      No runtime-applicable children
    </span>
  </section>
</template>

<style scoped>
.runtime { padding: 10px 16px; background: var(--wp-bg2); border-bottom: 1px solid var(--wp-border-soft, var(--wp-border)); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.runtime__label { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.14em; color: var(--wp-text-dim, var(--wp-text3)); }
.runtime__empty { font: 10px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); font-style: italic; }
</style>
