<script setup lang="ts">
/** Bundle runtime — master Lock + Hide toggles that cascade across
 *  every applicable child. Tri-state (all / none / partial) matches
 *  the BundleHeader button visual. Stateless: parent calls the same
 *  `toggleBundleLock` / `toggleBundleInternal` handlers the header
 *  buttons use. `null` state hides the button entirely. */
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
    <button
      v-if="props.lockState !== null"
      type="button"
      class="toggle"
      :class="{ 'toggle--on': props.lockState === 'all', 'toggle--partial': props.lockState === 'partial' }"
      data-test="bdm-toggle-lock"
      role="switch"
      :aria-checked="props.lockState === 'all'"
      :title="props.lockState === 'all'
        ? 'Unlock seeds on all lockable children'
        : props.lockState === 'partial'
          ? 'Lock seeds on all lockable children (some already locked)'
          : 'Lock seeds on all lockable children — freezes each at its current roll'"
      @click="emit('toggle-lock')"
    >
      <i class="pi pi-lock" aria-hidden="true" />
      Lock all picks
    </button>
    <button
      v-if="props.internalState !== null"
      type="button"
      class="toggle"
      :class="{ 'toggle--on': props.internalState === 'all', 'toggle--partial': props.internalState === 'partial' }"
      data-test="bdm-toggle-internal"
      role="switch"
      :aria-checked="props.internalState === 'all'"
      :title="props.internalState === 'all'
        ? 'Clear internal on all children'
        : props.internalState === 'partial'
          ? 'Mark all children internal (some already)'
          : 'Mark all children internal — hides them from PromptAssembler'"
      @click="emit('toggle-internal')"
    >
      <i class="pi pi-eye-slash" aria-hidden="true" />
      Hide all from prompt
    </button>
    <span v-if="props.lockState === null && props.internalState === null" class="runtime__empty">
      No runtime-applicable children
    </span>
  </section>
</template>

<style scoped>
.runtime { padding: 10px 16px; background: var(--wp-bg2); border-bottom: 1px solid var(--wp-border-soft, var(--wp-border)); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.runtime__label { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: 0.14em; color: var(--wp-text-dim, var(--wp-text3)); }
.runtime__empty { font: 10px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); font-style: italic; }
.toggle { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px; border: 1px solid var(--wp-border); border-radius: 3px; font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); cursor: pointer; background: var(--wp-bg-deep, var(--wp-bg)); }
.toggle:hover { border-color: var(--wp-border-soft, var(--wp-border)); }
.toggle .pi { font-size: 11px; color: var(--wp-text-dim, var(--wp-text3)); }
.toggle--on { border-color: var(--wp-accent); color: var(--wp-accent-text, var(--wp-text)); background: rgba(99, 102, 241, 0.10); }
.toggle--on .pi { color: var(--wp-accent-text, var(--wp-text)); }
.toggle--partial { border-style: dashed; border-color: var(--wp-accent); color: var(--wp-accent); background: color-mix(in srgb, var(--wp-accent) 6%, transparent); }
.toggle--partial .pi { color: var(--wp-accent); }
</style>
