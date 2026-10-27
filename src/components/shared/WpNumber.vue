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
 * wheel step by `step` and clamp to `min` / `max`. Height comes from `size`
 * on the control scale (sm 24, the canvas default / md 32, the manager
 * default / lg 40); give the root a class for its width. `suffix` shows a
 * unit after the number. `dataTest` lands on the input, with `-up` / `-down`
 * on the arrows. Reads only SHARED_TOKENS, so it wears whichever side it is on.
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
    size?: "sm" | "md" | "lg";
    /** Unit shown after the number ("px", "s"). */
    suffix?: string;
  }>(),
  { step: 1, commit: "change", upLabel: "Increase", downLabel: "Decrease", size: "sm", suffix: undefined },
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
  <span class="wp-cnum" :class="[`wp-cnum--${size}`, { 'is-disabled': disabled }]">
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
    <span v-if="suffix" class="wp-cnum__suffix" aria-hidden="true">{{ suffix }}</span>
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
  --wp-cnum-spin: 16px;
  display: inline-flex; align-items: stretch; height: var(--wp-control-h-sm); min-width: 0; overflow: hidden;
  box-sizing: border-box;
  background: var(--wp-bg); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  font-size: 11px;
  transition: border-color .12s, box-shadow .12s;
}
.wp-cnum--md { --wp-cnum-spin: 20px; height: var(--wp-control-h-md); font-size: 12.5px; background: var(--wp-bg-2); }
.wp-cnum--lg { --wp-cnum-spin: 22px; height: var(--wp-control-h-lg); font-size: 13.5px; background: var(--wp-bg-2); }
.wp-cnum:focus-within { border-color: var(--wp-accent-500); box-shadow: var(--wp-focus-ring); }
.wp-cnum.is-disabled { opacity: .45; cursor: not-allowed; }
.wp-cnum__field {
  flex: 1; min-width: 0; padding: 0 6px 0 8px; background: transparent; border: 0;
  color: var(--wp-text); font: inherit; font-family: var(--wp-font-mono); text-align: right;
  -moz-appearance: textfield; appearance: textfield;
}
.wp-cnum__field:disabled { cursor: not-allowed; }
.wp-cnum__field::-webkit-outer-spin-button, .wp-cnum__field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.wp-cnum__field:focus { outline: none; }
.wp-cnum__suffix {
  display: inline-flex; align-items: center; flex-shrink: 0; padding-right: 6px;
  color: var(--wp-text-dim); font-family: var(--wp-font-mono); user-select: none;
}
.wp-cnum__spin {
  display: flex; flex-direction: column; width: var(--wp-cnum-spin); flex-shrink: 0;
  border-left: 1px solid var(--wp-border); background: color-mix(in srgb, var(--wp-accent) 4%, transparent);
}
.wp-cnum__btn {
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
  background: transparent; color: var(--wp-text-dim); cursor: pointer; line-height: 0;
}
.wp-cnum--md .wp-cnum__btn svg, .wp-cnum--lg .wp-cnum__btn svg { width: 8px; height: 5px; }
.wp-cnum__btn + .wp-cnum__btn { border-top: 1px solid var(--wp-border); }
.wp-cnum__btn:hover:not(:disabled) { color: var(--wp-accent-text); background: color-mix(in srgb, var(--wp-accent) 12%, transparent); }
.wp-cnum__btn:disabled { cursor: not-allowed; }
</style>
