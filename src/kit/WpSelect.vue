<script setup lang="ts" generic="T extends string | number">
/**
 * Shared dropdown for the canvas tree. A real <select> (keyboard, screen
 * readers and the option list come from the browser) drawn with our field
 * look and chevron instead of the browser's control, so every canvas
 * dropdown matches. The SPA's `ui/Select.vue` is a full custom listbox;
 * the canvas bundle has no room for one, and nodes sit on a zoomable
 * canvas where a native list positions itself correctly.
 *
 * `options` values may be strings or numbers; the chosen option's own
 * value is emitted (not the DOM's string). `placeholder` adds a disabled
 * first entry shown while nothing is chosen (`modelValue` null or ""), for
 * "pick to add" menus. Size it from the parent with a class on the root
 * (height, width, font-size).
 * `dataTest` lands on the <select>.
 */
import { nextTick } from "vue";

const props = defineProps<{
  modelValue: T | null;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  placeholder?: string | undefined;
  ariaLabel?: string | undefined;
  dataTest?: string | undefined;
  disabled?: boolean | undefined;
  /** Lands on the <select>, for a `<label for>`. */
  id?: string | undefined;
}>();

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

function onChange(ev: Event): void {
  const el = ev.target as HTMLSelectElement;
  const i = el.selectedIndex - (props.placeholder === undefined ? 0 : 1);
  const opt = props.options[i];
  if (opt) emit("update:modelValue", opt.value);
  // Stay controlled: when the parent keeps its value (a "pick to add" menu
  // stays on its placeholder), put the shown entry back.
  void nextTick(() => {
    const at = props.options.findIndex((o) => o.value === props.modelValue);
    el.selectedIndex = at < 0 ? 0 : at + (props.placeholder === undefined ? 0 : 1);
  });
}

function selected(o: { value: T }): boolean {
  return o.value === props.modelValue;
}
</script>

<template>
  <span class="wp-cselect" :class="{ 'is-disabled': disabled }">
    <select
      :id="id"
      class="wp-cselect__field"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :data-test="dataTest"
      @change="onChange"
      @keydown.stop
    >
      <option
        v-if="placeholder !== undefined" value="" disabled
        :selected="modelValue === null || modelValue === ''"
      >{{ placeholder }}</option>
      <option
        v-for="o in options" :key="String(o.value)" :value="o.value"
        :disabled="o.disabled" :selected="selected(o)"
      >{{ o.label }}</option>
    </select>
    <svg class="wp-cselect__chev" width="8" height="5" viewBox="0 0 8 5" aria-hidden="true"><path d="M0 0 L4 5 L8 0 Z" fill="currentColor" /></svg>
  </span>
</template>

<style scoped>
.wp-cselect { position: relative; display: inline-flex; align-items: stretch; height: 24px; min-width: 0; font-size: 11px; }
.wp-cselect__field {
  flex: 1; min-width: 0; height: 100%; padding: 0 20px 0 7px; margin: 0;
  background: var(--wp-bg-deep, var(--wp-bg)); color: var(--wp-text);
  border: 1px solid var(--wp-border); border-radius: min(3px, var(--wp-radius-cap, 999px));
  font: inherit; cursor: pointer;
  appearance: none; -webkit-appearance: none; text-overflow: ellipsis;
}
.wp-cselect__field:hover:not(:disabled) { border-color: var(--wp-border-strong, var(--wp-text-dim)); }
.wp-cselect__field:focus { outline: none; border-color: var(--wp-accent); }
.wp-cselect__field option { background: var(--wp-bg2, var(--wp-bg)); color: var(--wp-text); }
.wp-cselect__chev { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); color: var(--wp-text-dim, #7a7d88); pointer-events: none; }
.wp-cselect.is-disabled { opacity: .5; }
.wp-cselect.is-disabled .wp-cselect__field { cursor: default; }
</style>
