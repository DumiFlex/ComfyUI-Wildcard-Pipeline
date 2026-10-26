<script setup lang="ts">
/**
 * Shared number field for the canvas tree: a number input with our stacked
 * ▲/▼ arrows instead of the browser's spinner (hidden). The SPA has
 * `manager/components/ui/Input.vue`; the canvas can't load the SPA CSS, so
 * this is its own small copy of the look every canvas stepper used to
 * hand-roll (seed rows, sweep limit, Image Filter timeout).
 *
 * Emits a finite number only: typing commits on `change` (or every
 * keystroke with `commit="input"`); the arrows, ArrowUp/ArrowDown and the
 * wheel step by `step` and clamp to `min` / `max`. Size it from the parent with a class on the root
 * (`height`, `width`); `dataTest` lands on the input, with `-up` / `-down`
 * on the arrows.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null;
    min?: number;
    max?: number;
    step?: number;
    ariaLabel?: string;
    upLabel?: string;
    downLabel?: string;
    dataTest?: string;
    commit?: "change" | "input";
    disabled?: boolean;
  }>(),
  { step: 1, commit: "change", upLabel: "Increase", downLabel: "Decrease" },
);

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

function clamp(n: number): number {
  let v = n;
  if (props.min !== undefined) v = Math.max(props.min, v);
  if (props.max !== undefined) v = Math.min(props.max, v);
  return v;
}

function onType(ev: Event, kind: "change" | "input"): void {
  if (kind !== props.commit) return;
  const raw = (ev.target as HTMLInputElement).value;
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) return;
  emit("update:modelValue", n);
}

/** ArrowUp / ArrowDown and the wheel (while focused) step like the arrows.
 *  Every key stops here so the canvas doesn't read it as a shortcut. */
function onKey(ev: KeyboardEvent): void {
  ev.stopPropagation();
  if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
  ev.preventDefault();
  bump(ev.key === "ArrowUp" ? 1 : -1);
}
function onWheel(ev: WheelEvent): void {
  if (document.activeElement !== ev.target) return;
  ev.preventDefault();
  bump(ev.deltaY < 0 ? 1 : -1);
}

/** Step with the step's decimal precision, so 1 + 0.1 shows 1.1. */
function bump(dir: 1 | -1): void {
  if (props.disabled) return;
  const dot = String(props.step).indexOf(".");
  const f = dot < 0 ? 1 : 10 ** (String(props.step).length - dot - 1);
  emit("update:modelValue", clamp(Math.round(((props.modelValue ?? 0) + dir * props.step) * f) / f));
}
</script>

<template>
  <span class="wp-cnum" :class="{ 'is-disabled': disabled }">
    <input
      class="wp-cnum__field"
      type="number"
      :value="modelValue ?? ''"
      :min="min"
      :max="max"
      step="any"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :data-test="dataTest"
      @input="onType($event, 'input')"
      @change="onType($event, 'change')"
      @keydown="onKey"
      @wheel="onWheel"
    />
    <span class="wp-cnum__spin">
      <button
        type="button" class="wp-cnum__btn" tabindex="-1" :disabled="disabled"
        :aria-label="upLabel" :data-test="dataTest && `${dataTest}-up`" @click="bump(1)"
      ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true"><path d="M0 5 L4 0 L8 5 Z" fill="currentColor" /></svg></button>
      <button
        type="button" class="wp-cnum__btn" tabindex="-1" :disabled="disabled"
        :aria-label="downLabel" :data-test="dataTest && `${dataTest}-down`" @click="bump(-1)"
      ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true"><path d="M0 0 L4 5 L8 0 Z" fill="currentColor" /></svg></button>
    </span>
  </span>
</template>

<style scoped>
.wp-cnum {
  display: inline-flex; align-items: stretch; height: 24px; min-width: 0; overflow: hidden;
  background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); border-radius: 3px;
}
.wp-cnum:focus-within { border-color: var(--wp-accent); }
.wp-cnum.is-disabled { opacity: .5; }
.wp-cnum__field {
  flex: 1; min-width: 0; padding: 0 7px; background: transparent; border: 0;
  color: var(--wp-text); font: 11px var(--wp-font-mono, monospace); text-align: right;
  -moz-appearance: textfield; appearance: textfield;
}
.wp-cnum__field::-webkit-outer-spin-button, .wp-cnum__field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.wp-cnum__field:focus { outline: none; }
.wp-cnum__spin { display: flex; flex-direction: column; width: 14px; flex-shrink: 0; border-left: 1px solid var(--wp-border); background: rgba(99,102,241,.04); }
.wp-cnum__btn {
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
  background: transparent; color: var(--wp-text-dim, #7a7d88); cursor: pointer; line-height: 0;
}
.wp-cnum__btn + .wp-cnum__btn { border-top: 1px solid var(--wp-border); }
.wp-cnum__btn:hover:not(:disabled) { color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.12); }
.wp-cnum__btn:disabled { cursor: default; }
</style>
