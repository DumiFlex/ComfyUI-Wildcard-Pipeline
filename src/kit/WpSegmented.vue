<script setup lang="ts" generic="T extends string">
/**
 * Segmented control: two to five short choices shown as joined buttons, one
 * of them on. For this few, showing them all is faster to read and change
 * than a select. Works on the canvas (`size="sm"`) and in the manager (`md`).
 *
 * It is a radio group (APG): only the chosen option is in the Tab order, the
 * arrow keys move to the next enabled option and choose it, Home/End jump to
 * the ends. With `icon-only` the labels become the buttons' names and
 * tooltips.
 *
 *   <WpSegmented v-model="theme" :options="[{ value: 'dark', label: 'Dark', icon: 'pi-moon' }]" aria-label="Theme" />
 */
import { nextTick, ref } from "vue";
import { vTooltip } from "./tooltip";

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: string;
  /** A PrimeIcons class, e.g. `pi-moon`. */
  icon?: string | undefined;
  disabled?: boolean | undefined;
  /** A tooltip saying what the option does. */
  hint?: string | undefined;
  /** A shortcut shown in the tooltip's key chip, e.g. "G". */
  kbd?: string | undefined;
  /** This option's `data-test`, when `testPrefix` doesn't fit. */
  testId?: string | undefined;
}

const props = withDefaults(defineProps<{
  modelValue: T;
  options: SegmentedOption<T>[];
  size?: "sm" | "md" | "lg" | undefined;
  /** Show only the icons; each label names its button and is its tooltip. */
  iconOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Fill the row: options share the width and long labels end in "…". */
  block?: boolean | undefined;
  ariaLabel?: string | undefined;
  /** `data-test` of each option is `<testPrefix>-<value>`. */
  testPrefix?: string | undefined;
}>(), { size: "md" });

const emit = defineEmits<{ (e: "update:modelValue", v: T): void }>();
const rootEl = ref<HTMLElement | null>(null);

function pick(v: T): void {
  if (props.disabled) return;
  if (v !== props.modelValue) emit("update:modelValue", v);
}

/** The option that takes Tab focus: the chosen one, else the first enabled. */
function tabStop(): T | undefined {
  const live = props.options.filter((o) => !o.disabled);
  return (live.find((o) => o.value === props.modelValue) ?? live[0])?.value;
}

function onKeydown(ev: KeyboardEvent): void {
  if (props.disabled) return;
  const live = props.options.filter((o) => !o.disabled);
  if (!live.length) return;
  const at = live.findIndex((o) => o.value === props.modelValue);
  let next: number;
  switch (ev.key) {
    case "ArrowRight": case "ArrowDown": next = (at + 1) % live.length; break;
    case "ArrowLeft": case "ArrowUp": next = at < 0 ? live.length - 1 : (at - 1 + live.length) % live.length; break;
    case "Home": next = 0; break;
    case "End": next = live.length - 1; break;
    default: return;
  }
  ev.preventDefault();
  const v = live[next].value;
  pick(v);
  void nextTick(() => {
    const i = props.options.findIndex((o) => o.value === v);
    rootEl.value?.querySelectorAll<HTMLElement>("[role=radio]")[i]?.focus();
  });
}
</script>

<template>
  <div
    ref="rootEl"
    class="wp-segmented"
    role="radiogroup"
    :aria-label="ariaLabel"
    :aria-disabled="disabled || undefined"
    :data-size="size"
    :data-icon-only="iconOnly || undefined"
    :data-block="block || undefined"
  >
    <button
      v-for="o in options"
      :key="o.value"
      v-tooltip="{ text: o.hint ?? (iconOnly || o.kbd ? o.label : null), kbd: o.kbd }"
      type="button"
      role="radio"
      class="wp-segmented__opt"
      :aria-checked="modelValue === o.value"
      :aria-label="iconOnly ? o.label : undefined"
      :data-active="modelValue === o.value ? 'true' : 'false'"
      :data-test="o.testId ?? (testPrefix ? `${testPrefix}-${o.value}` : undefined)"
      :tabindex="o.value === tabStop() && !disabled ? 0 : -1"
      :disabled="disabled || o.disabled"
      @click="pick(o.value)"
      @keydown="onKeydown"
    >
      <i v-if="o.icon" class="pi" :class="o.icon" aria-hidden="true" />
      <span v-if="!iconOnly" class="wp-segmented__label">{{ o.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.wp-segmented {
  display: inline-flex;
  flex: none;
  /* Keep its own width inside a column flex parent; block fills the row. */
  align-self: flex-start;
  max-width: 100%;
  padding: 2px;
  gap: 2px;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
  height: var(--wp-control-h-md);
  box-sizing: border-box;
}
.wp-segmented[data-size="sm"] { height: var(--wp-control-h-sm); border-radius: var(--wp-radius-sm); }
.wp-segmented[data-size="lg"] { height: var(--wp-control-h-lg); }
.wp-segmented__opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0 var(--wp-space-5);
  border: 0;
  border-radius: calc(var(--wp-radius) - 2px);
  background: transparent;
  color: var(--wp-text-muted);
  font: 500 var(--wp-text-sm)/1 var(--wp-font-sans);
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--wp-motion-hover), color var(--wp-motion-hover);
}
.wp-segmented[data-size="sm"] .wp-segmented__opt {
  padding: 0 var(--wp-space-4);
  border-radius: calc(var(--wp-radius-sm) - 1px);
  font-size: var(--wp-text-xs);
  gap: 4px;
}
.wp-segmented[data-size="lg"] .wp-segmented__opt { padding: 0 var(--wp-space-6); font-size: var(--wp-text-base); }
.wp-segmented[data-block] { display: flex; width: 100%; align-self: stretch; }
.wp-segmented[data-block] .wp-segmented__opt { flex: 1 1 0; }
.wp-segmented__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.wp-segmented[data-icon-only] .wp-segmented__opt { aspect-ratio: 1; padding: 0; }
.wp-segmented__opt:hover:not(:disabled) { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-segmented__opt[data-active="true"] {
  background: var(--wp-bg-4);
  color: var(--wp-text);
  box-shadow: var(--wp-shadow-sm), inset 0 0 0 1px var(--wp-border-strong);
  font-weight: 600;
}
.wp-segmented__opt[data-active="true"] .pi { color: var(--wp-accent-text); }
.wp-segmented__opt:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-segmented__opt:disabled { opacity: 0.45; cursor: not-allowed; }
.wp-segmented__opt .pi { font-size: 0.95em; }
@media (prefers-reduced-motion: reduce) {
  .wp-segmented__opt { transition: none; }
}
</style>
