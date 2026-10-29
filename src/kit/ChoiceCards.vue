<script setup lang="ts" generic="T extends string">
/**
 * Choice cards: pick one of a handful of options that each need a picture to
 * be understood (a colour theme, a look, a layout). Each card shows the
 * `preview` slot, a name and, unless `compact`, a one-line hint (compact puts
 * the hint in the card's tooltip).
 *
 * It is a radio group (APG), like the segmented control: only the chosen card
 * is in the Tab order, the arrow keys move to the next card and choose it,
 * Home/End jump to the ends.
 *
 *   <ChoiceCards v-model="look" :options="LOOKS" aria-label="Look">
 *     <template #preview="{ option }"><LookDrawing :id="option.value" /></template>
 *   </ChoiceCards>
 */
import { nextTick, ref } from "vue";

export interface ChoiceCardOption<V extends string = string> {
  value: V;
  label: string;
  hint?: string | undefined;
  /** Inline style for the card, e.g. CSS variables its preview reads. */
  style?: Record<string, string> | undefined;
}

const props = defineProps<{
  modelValue: T;
  options: ChoiceCardOption<T>[];
  /** Three to a row, smaller, hint as tooltip: for narrow panels. */
  compact?: boolean | undefined;
  ariaLabel?: string | undefined;
  /** `data-test` of each card is `<testPrefix>-<value>`. */
  testPrefix?: string | undefined;
}>();

const emit = defineEmits<{ (e: "update:modelValue", v: T): void }>();
defineSlots<{ preview?(p: { option: ChoiceCardOption<T>; on: boolean }): unknown }>();
const rootEl = ref<HTMLElement | null>(null);

function pick(v: T): void {
  if (v !== props.modelValue) emit("update:modelValue", v);
}

function tabStop(): T | undefined {
  return (props.options.find((o) => o.value === props.modelValue) ?? props.options[0])?.value;
}

function onKeydown(ev: KeyboardEvent): void {
  const all = props.options;
  if (!all.length) return;
  const at = all.findIndex((o) => o.value === props.modelValue);
  let next: number;
  switch (ev.key) {
    case "ArrowRight": case "ArrowDown": next = (at + 1) % all.length; break;
    case "ArrowLeft": case "ArrowUp": next = at < 0 ? all.length - 1 : (at - 1 + all.length) % all.length; break;
    case "Home": next = 0; break;
    case "End": next = all.length - 1; break;
    default: return;
  }
  ev.preventDefault();
  pick(all[next].value);
  void nextTick(() => rootEl.value?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus());
}
</script>

<template>
  <div
    ref="rootEl"
    class="wp-choice-cards"
    :class="{ 'wp-choice-cards--compact': compact }"
    role="radiogroup"
    :aria-label="ariaLabel"
  >
    <button
      v-for="o in options"
      :key="o.value"
      :title="compact ? o.hint : undefined"
      type="button"
      role="radio"
      class="wp-choice-card"
      :aria-checked="modelValue === o.value"
      :tabindex="o.value === tabStop() ? 0 : -1"
      :data-test="testPrefix ? `${testPrefix}-${o.value}` : undefined"
      :style="o.style"
      @click="pick(o.value)"
      @keydown="onKeydown"
    >
      <slot name="preview" :option="o" :on="modelValue === o.value" />
      <span class="wp-choice-card__name">{{ o.label }}</span>
      <span v-if="!compact && o.hint" class="wp-choice-card__hint">{{ o.hint }}</span>
    </button>
  </div>
</template>

<style scoped>
.wp-choice-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--wp-space-4);
  width: 100%;
}
.wp-choice-cards--compact { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--wp-space-3); }
.wp-choice-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--wp-space-3);
  min-width: 0;
  padding: var(--wp-space-4);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
  color: var(--wp-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--wp-motion-hover), background var(--wp-motion-hover);
}
.wp-choice-card:hover { border-color: var(--wp-border-strong); background: var(--wp-bg-3); }
.wp-choice-card[aria-checked="true"] {
  border-color: var(--wp-accent-500);
  box-shadow: inset 0 0 0 1px var(--wp-accent-500);
  background: color-mix(in oklab, var(--wp-accent-500) 10%, var(--wp-bg-2));
}
.wp-choice-card:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
.wp-choice-card__name { font-size: var(--wp-text-base); font-weight: 600; line-height: var(--wp-line-base); }
.wp-choice-card__hint { font-size: var(--wp-text-xs); line-height: var(--wp-line-xs); color: var(--wp-text-muted); }
.wp-choice-cards--compact .wp-choice-card { padding: var(--wp-space-3); gap: var(--wp-space-2); }
.wp-choice-cards--compact .wp-choice-card__name { font-size: var(--wp-text-xs); }
@media (prefers-reduced-motion: reduce) {
  .wp-choice-card { transition: none; }
}
</style>
