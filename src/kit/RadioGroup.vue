<script setup lang="ts" generic="T extends string">
/**
 * Radio group: one of a few options, each with room for a line saying what
 * it does. Use it when the options need explaining; for two to five short
 * words that fit on one row use the Segmented control. Works on the canvas
 * (`size="sm"`) and in the manager (`md`).
 *
 *   <RadioGroup v-model="mode" :options="[{ value: 'tags', label: 'Tags', hint: 'Danbooru-style, comma separated' }]" aria-label="Prompt style" />
 *
 * APG radio group: one Tab stop (the chosen option), the arrow keys move and
 * choose, disabled options are skipped. `orientation="horizontal"` lays the
 * options out in a row. The `label` slot draws an option's label itself
 * (a name plus a badge), and `test-prefix` gives each option a `data-test`.
 *
 *   <RadioGroup v-model="provider" :options="opts" test-prefix="provider">
 *     <template #label="{ option }">{{ option.label }} <Badge text="Local" /></template>
 *   </RadioGroup>
 */
import { nextTick, ref } from "vue";

export interface RadioOption<V extends string = string> {
  value: V;
  label: string;
  hint?: string | undefined;
  disabled?: boolean | undefined;
}

const props = withDefaults(defineProps<{
  modelValue: T | null;
  options: RadioOption<T>[];
  orientation?: "vertical" | "horizontal" | undefined;
  size?: "sm" | "md" | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  ariaLabel?: string | undefined;
  /** Draw each option as a bordered card (for a few big choices). */
  cards?: boolean | undefined;
  /** `data-test` of each option is `<testPrefix>-<value>`. */
  testPrefix?: string | undefined;
}>(), { orientation: "vertical", size: "md", ariaLabel: undefined, testPrefix: undefined });

defineSlots<{ label?: (p: { option: RadioOption<T> }) => unknown }>();

const emit = defineEmits<{ (e: "update:modelValue", v: T): void }>();
const rootEl = ref<HTMLElement | null>(null);

function pick(v: T): void {
  if (!props.disabled && v !== props.modelValue) emit("update:modelValue", v);
}

function tabStop(): T | undefined {
  const live = props.options.filter((o) => !o.disabled);
  return (live.find((o) => o.value === props.modelValue) ?? live[0])?.value;
}

function onKeydown(ev: KeyboardEvent, at: T): void {
  if (props.disabled) return;
  const live = props.options.filter((o) => !o.disabled);
  const i = live.findIndex((o) => o.value === at);
  let next: number;
  switch (ev.key) {
    case "ArrowDown": case "ArrowRight": next = (i + 1) % live.length; break;
    case "ArrowUp": case "ArrowLeft": next = (i - 1 + live.length) % live.length; break;
    case " ": ev.preventDefault(); pick(at); return;
    default: return;
  }
  ev.preventDefault();
  const v = live[next].value;
  pick(v);
  void nextTick(() => {
    rootEl.value?.querySelectorAll<HTMLElement>("[role=radio]")[props.options.findIndex((o) => o.value === v)]?.focus();
  });
}
</script>

<template>
  <div
    ref="rootEl"
    class="wp-radio-group"
    role="radiogroup"
    :aria-label="ariaLabel"
    :aria-disabled="disabled || undefined"
    :aria-invalid="invalid || undefined"
    :data-orientation="orientation"
    :data-size="size"
    :data-cards="cards || undefined"
  >
    <!-- Each radio has a tabindex (roving: only the checked one is a Tab stop). -->
    <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
    <div
      v-for="o in options"
      :key="o.value"
      class="wp-radio-group__opt"
      role="radio"
      :aria-checked="modelValue === o.value"
      :aria-disabled="disabled || o.disabled || undefined"
      :tabindex="!disabled && o.value === tabStop() ? 0 : -1"
      :data-checked="modelValue === o.value || undefined"
      :data-test="testPrefix ? `${testPrefix}-${o.value}` : undefined"
      @click="!o.disabled && pick(o.value)"
      @keydown="onKeydown($event, o.value)"
    >
      <span class="wp-radio-group__dot" aria-hidden="true" />
      <span class="wp-radio-group__text">
        <span class="wp-radio-group__label"><slot name="label" :option="o">{{ o.label }}</slot></span>
        <span v-if="o.hint" class="wp-radio-group__hint">{{ o.hint }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.wp-radio-group { display: flex; flex-direction: column; gap: var(--wp-space-3); min-width: 0; font-family: var(--wp-font-sans); }
.wp-radio-group[data-orientation="horizontal"] { flex-direction: row; flex-wrap: wrap; gap: var(--wp-space-5); }
.wp-radio-group[data-size="sm"] { gap: var(--wp-space-2); }
.wp-radio-group__opt {
  display: flex; align-items: flex-start; gap: var(--wp-space-3); min-width: 0;
  padding: 2px; border-radius: var(--wp-radius-sm); color: var(--wp-text); cursor: pointer; outline: none;
}
.wp-radio-group[data-cards] .wp-radio-group__opt {
  flex: 1 1 0; padding: var(--wp-space-4); border: 1px solid var(--wp-border); border-radius: var(--wp-radius); background: var(--wp-bg-1);
  transition: border-color var(--wp-motion-hover), background var(--wp-motion-hover);
}
.wp-radio-group[data-cards] .wp-radio-group__opt[data-checked] { border-color: var(--wp-accent); background: color-mix(in srgb, var(--wp-accent) 8%, var(--wp-bg-1)); }
.wp-radio-group__opt:focus-visible { box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-radio-group__opt[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
.wp-radio-group__dot {
  position: relative; flex: none; box-sizing: border-box; width: 16px; height: 16px; margin-top: 1px;
  border: 1.5px solid var(--wp-border-strong); border-radius: 50%; /* round: a radio is round in every look */ background: var(--wp-bg-1);
  transition: border-color var(--wp-motion-hover);
}
.wp-radio-group[data-size="sm"] .wp-radio-group__dot { width: 13px; height: 13px; }
.wp-radio-group__opt:hover:not([aria-disabled="true"]) .wp-radio-group__dot { border-color: var(--wp-accent); }
.wp-radio-group__opt[data-checked] .wp-radio-group__dot { border-color: var(--wp-accent); }
.wp-radio-group__opt[data-checked] .wp-radio-group__dot::after {
  content: ""; position: absolute; inset: 3px; border-radius: 50%; /* round: radio dot */ background: var(--wp-accent);
}
.wp-radio-group[data-size="sm"] .wp-radio-group__opt[data-checked] .wp-radio-group__dot::after { inset: 2.5px; }
/* A picked option that is disabled turns grey, so it can't pass for a live one. */
.wp-radio-group__opt[aria-disabled="true"][data-checked] .wp-radio-group__dot { border-color: var(--wp-text-dim); }
.wp-radio-group__opt[aria-disabled="true"][data-checked] .wp-radio-group__dot::after { background: var(--wp-text-dim); }
.wp-radio-group[aria-invalid="true"] .wp-radio-group__dot { border-color: var(--wp-error-border); }
.wp-radio-group__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.wp-radio-group__label { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-3); font-size: var(--wp-text-sm); line-height: 18px; }
.wp-radio-group[data-size="sm"] .wp-radio-group__label { font-size: var(--wp-text-xs); line-height: 15px; }
.wp-radio-group__hint { color: var(--wp-text-muted); font-size: var(--wp-text-xs); line-height: 1.4; }
@media (prefers-reduced-motion: reduce) {
  .wp-radio-group__dot, .wp-radio-group[data-cards] .wp-radio-group__opt { transition: none; }
}
</style>
