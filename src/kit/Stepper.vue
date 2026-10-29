<script setup lang="ts" generic="T extends string">
/**
 * Stepper: the "1 · 2 · 3" header of a job done in steps (the pack builder,
 * an import, a setup). Done steps show a check, a step with a problem shows
 * a mark, and the current one is lit. Works on the canvas and in the manager.
 *
 *   <Stepper v-model="step" :steps="[{ id: 'describe', label: 'Describe' }, { id: 'plan', label: 'Plan', state: 'done' }]" clickable />
 *
 * It is an ordered list with `aria-current="step"` on the current step. With
 * `clickable` each step is a button that emits `update:modelValue`; with
 * `linear` only done steps and the next one can be picked.
 */
import { computed } from "vue";

export interface StepperStep<V extends string = string> {
  id: V;
  label: string;
  /** A short line under the label. */
  hint?: string | undefined;
  /** done shows a check, error a mark. Steps before the current one count as done unless set. */
  state?: "todo" | "done" | "error" | undefined;
  disabled?: boolean | undefined;
}

const props = withDefaults(defineProps<{
  modelValue: T;
  steps: StepperStep<T>[];
  clickable?: boolean | undefined;
  /** Only done steps and the one after the last done step can be picked. */
  linear?: boolean | undefined;
  orientation?: "horizontal" | "vertical" | undefined;
  size?: "sm" | "md" | undefined;
  ariaLabel?: string | undefined;
}>(), { orientation: "horizontal", size: "md", ariaLabel: "Steps" });

const emit = defineEmits<{ (e: "update:modelValue", v: T): void }>();

const current = computed(() => props.steps.findIndex((s) => s.id === props.modelValue));

function stateOf(i: number): "todo" | "done" | "error" | "current" {
  const s = props.steps[i];
  if (s.state === "error") return "error";
  if (i === current.value) return "current";
  if (s.state) return s.state;
  return i < current.value ? "done" : "todo";
}

/** The furthest step a linear stepper lets you reach. */
const reach = computed(() => {
  let i = 0;
  while (i < props.steps.length && (stateOf(i) === "done" || i <= current.value)) i++;
  return i;
});

function canPick(i: number): boolean {
  const s = props.steps[i];
  if (!props.clickable || s.disabled) return false;
  return !props.linear || i <= reach.value;
}

const STATE_WORD = { done: "done", error: "has a problem", current: "current step", todo: "" } as const;
</script>

<template>
  <ol class="wp-stepper" :data-orientation="orientation" :data-size="size" :aria-label="ariaLabel">
    <li
      v-for="(s, i) in steps"
      :key="s.id"
      class="wp-stepper__step"
      :data-state="stateOf(i)"
      :aria-current="i === current ? 'step' : undefined"
    >
      <component
        :is="clickable ? 'button' : 'div'"
        class="wp-stepper__body"
        :type="clickable ? 'button' : undefined"
        :disabled="clickable ? !canPick(i) : undefined"
        @click="canPick(i) && s.id !== modelValue && emit('update:modelValue', s.id)"
      >
        <span class="wp-stepper__mark" aria-hidden="true">
          <i v-if="stateOf(i) === 'done'" class="pi pi-check" />
          <i v-else-if="stateOf(i) === 'error'" class="pi pi-exclamation-triangle" />
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span class="wp-stepper__text">
          <span class="wp-stepper__label">{{ s.label }}</span>
          <span v-if="s.hint" class="wp-stepper__hint">{{ s.hint }}</span>
          <span v-if="STATE_WORD[stateOf(i)]" class="wp-stepper__sr">, {{ STATE_WORD[stateOf(i)] }}</span>
        </span>
      </component>
      <span v-if="i < steps.length - 1" class="wp-stepper__line" aria-hidden="true" />
    </li>
  </ol>
</template>

<style scoped>
.wp-stepper {
  display: flex; align-items: flex-start; gap: var(--wp-space-3);
  margin: 0; padding: 0; list-style: none; min-width: 0;
  font-family: var(--wp-font-sans);
}
.wp-stepper[data-orientation="vertical"] { flex-direction: column; gap: 0; }
.wp-stepper__step { display: flex; align-items: center; gap: var(--wp-space-3); flex: 1 1 0; min-width: 0; }
.wp-stepper__step:last-child { flex: 0 1 auto; }
.wp-stepper[data-orientation="vertical"] .wp-stepper__step { flex-direction: column; align-items: flex-start; gap: 0; width: 100%; }
.wp-stepper__body {
  display: inline-flex; align-items: center; gap: var(--wp-space-3); min-width: 0;
  margin: 0; padding: 2px var(--wp-space-2) 2px 2px; border: 0; border-radius: var(--wp-radius);
  background: transparent; color: var(--wp-text-muted); font: inherit; text-align: left;
}
button.wp-stepper__body { cursor: pointer; }
button.wp-stepper__body:hover:not(:disabled) { background: var(--wp-row-hover); color: var(--wp-text); }
button.wp-stepper__body:disabled { cursor: default; }
button.wp-stepper__body:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-stepper__mark {
  display: inline-grid; place-items: center; flex: none; box-sizing: border-box;
  width: 24px; height: 24px; border-radius: min(50%, var(--wp-radius-cap, 999px));
  border: 1.5px solid var(--wp-border-strong); background: var(--wp-bg-1);
  color: var(--wp-text-muted); font: 600 var(--wp-text-xs)/1 var(--wp-font-sans); font-variant-numeric: tabular-nums;
}
.wp-stepper[data-size="sm"] .wp-stepper__mark { width: 20px; height: 20px; font-size: 10px; }
.wp-stepper__mark .pi { font-size: 10px; }
.wp-stepper__text { display: flex; flex-direction: column; min-width: 0; }
.wp-stepper__label { font-size: var(--wp-text-sm); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-stepper[data-size="sm"] .wp-stepper__label { font-size: var(--wp-text-xs); }
.wp-stepper__hint { font-size: var(--wp-text-xs); color: var(--wp-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-stepper__sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.wp-stepper__line { flex: 1; min-width: 12px; height: 1.5px; border-radius: min(1px, var(--wp-radius-cap, 999px)); background: var(--wp-border); }
.wp-stepper[data-orientation="vertical"] .wp-stepper__line { flex: none; width: 1.5px; min-width: 0; height: 16px; margin: 2px 0 2px 13px; }
.wp-stepper[data-orientation="vertical"][data-size="sm"] .wp-stepper__line { margin-left: 11px; }
.wp-stepper__step[data-state="done"] .wp-stepper__mark { border-color: var(--wp-accent); background: var(--wp-accent); color: var(--wp-bg); }
.wp-stepper__step[data-state="done"] .wp-stepper__line { background: var(--wp-accent); }
.wp-stepper__step[data-state="current"] .wp-stepper__mark { border-color: var(--wp-accent); color: var(--wp-accent-text); box-shadow: 0 0 0 3px var(--wp-accent-glow); }
.wp-stepper__step[data-state="current"] .wp-stepper__body { color: var(--wp-text); }
.wp-stepper__step[data-state="current"] .wp-stepper__label { font-weight: 600; }
.wp-stepper__step[data-state="error"] .wp-stepper__mark { border-color: var(--wp-danger); color: var(--wp-danger); }
.wp-stepper__step[data-state="error"] .wp-stepper__label { color: var(--wp-danger-text); }
</style>
