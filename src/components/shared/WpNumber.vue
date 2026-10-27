<script setup lang="ts">
/**
 * The one number field, on the canvas and in the manager: a number input
 * with our stacked ▲/▼ arrows instead of the browser's spinner (hidden).
 * It replaced the canvas steppers every widget used to hand-roll (seed rows,
 * sweep limit, Image Filter timeout) and Input's `type="number"` mode.
 *
 * Emits a finite number only: typing commits on `change` (or every
 * keystroke with `commit="input"`); the arrows, ArrowUp/ArrowDown and the
 * wheel step by `step` and clamp to `min` / `max`. Typed values snap to 3
 * decimals and stepped values to the step's own precision, so float fuzz
 * (1.2999999999999998) never reaches a store. With `nullable`, clearing the
 * box emits `null` (a "use the default" field with a placeholder).
 *
 * `size` follows the control scale (sm 24 / md 32 / lg 40); the canvas uses
 * `sm`, manager forms `md`. `class` and `style` land on the box (set a width
 * there); other attributes and listeners (`@blur`, `@keydown.enter`, `id`)
 * land on the input. `dataTest` lands on the input, with `-up` / `-down` on
 * the arrows. `suffix` shows a unit after the number ("px", "s"). Reads
 * only SHARED_TOKENS, so it wears whichever side it is on.
 */
import { computed, ref, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue: number | null;
    min?: number;
    max?: number;
    step?: number;
    size?: "sm" | "md" | "lg";
    placeholder?: string;
    ariaLabel?: string;
    upLabel?: string;
    downLabel?: string;
    dataTest?: string;
    commit?: "change" | "input";
    /** Clearing the box emits null instead of being ignored. */
    nullable?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    /** Unit shown after the number ("px", "s"). */
    suffix?: string;
  }>(),
  { step: 1, size: "sm", commit: "change", upLabel: "Increase", downLabel: "Decrease" },
);

const emit = defineEmits<{ "update:modelValue": [value: number | null] }>();

const attrs = useAttrs();
const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
const inputAttrs = computed(() => {
  const { class: _c, style: _s, ...rest } = attrs;
  return rest;
});

function clamp(n: number): number {
  let v = n;
  if (props.min !== undefined) v = Math.max(props.min, v);
  if (props.max !== undefined) v = Math.min(props.max, v);
  return v;
}

function onType(ev: Event, kind: "change" | "input"): void {
  if (kind !== props.commit) return;
  const raw = (ev.target as HTMLInputElement).value;
  if (raw === "") {
    if (props.nullable) emit("update:modelValue", null);
    return;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  emit("update:modelValue", Math.round(n * 1000) / 1000);
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

const field = ref<HTMLInputElement | null>(null);
defineExpose({ focus: () => field.value?.focus(), select: () => field.value?.select(), el: field });

/** Step with the step's decimal precision, so 1 + 0.1 shows 1.1. */
function bump(dir: 1 | -1): void {
  if (props.disabled) return;
  const dot = String(props.step).indexOf(".");
  const f = dot < 0 ? 1 : 10 ** (String(props.step).length - dot - 1);
  emit("update:modelValue", clamp(Math.round(((props.modelValue ?? 0) + dir * props.step) * f) / f));
}
</script>

<template>
  <span
    class="wp-cnum"
    :class="[`wp-cnum--${size}`, { 'is-disabled': disabled, 'is-invalid': invalid }]"
    v-bind="rootAttrs"
  >
    <input
      ref="field"
      class="wp-cnum__field"
      type="number"
      :value="modelValue ?? ''"
      :min="min"
      :max="max"
      step="any"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-invalid="invalid || undefined"
      :data-test="dataTest"
      v-bind="inputAttrs"
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
      ><i class="pi pi-chevron-up" aria-hidden="true" /></button>
      <button
        type="button" class="wp-cnum__btn" tabindex="-1" :disabled="disabled"
        :aria-label="downLabel" :data-test="dataTest && `${dataTest}-down`" @click="bump(-1)"
      ><i class="pi pi-chevron-down" aria-hidden="true" /></button>
    </span>
  </span>
</template>

<style scoped>
.wp-cnum {
  --cnum-spin: 16px;
  display: inline-flex; align-items: stretch; height: var(--wp-control-h-sm); min-width: 0; overflow: hidden;
  box-sizing: border-box;
  background: var(--wp-bg-2); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  font: 11px var(--wp-font-mono);
  transition: border-color var(--wp-motion-quick), box-shadow var(--wp-motion-quick);
}
.wp-cnum--md { --cnum-spin: 20px; height: var(--wp-control-h-md); font-size: 12.5px; }
.wp-cnum--lg { --cnum-spin: 22px; height: var(--wp-control-h-lg); font-size: 13.5px; }
.wp-cnum:hover { border-color: var(--wp-border-strong); }
.wp-cnum:focus-within { border-color: var(--wp-border-focus); box-shadow: var(--wp-focus-ring); }
.wp-cnum.is-invalid { border-color: var(--wp-error-border); }
.wp-cnum.is-disabled { opacity: .45; cursor: not-allowed; }
.wp-cnum__field {
  flex: 1; min-width: 0; padding: 0 6px 0 8px; background: transparent; border: 0;
  color: var(--wp-text); font: inherit; text-align: right;
  -moz-appearance: textfield; appearance: textfield;
}
.wp-cnum__field::-webkit-outer-spin-button, .wp-cnum__field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.wp-cnum__field::placeholder { color: var(--wp-text-dim); }
.wp-cnum__field:focus { outline: none; }
.wp-cnum__field:disabled { cursor: not-allowed; }
.wp-cnum__suffix {
  display: inline-flex; align-items: center; flex-shrink: 0; padding-right: 6px;
  color: var(--wp-text-dim); user-select: none;
}
.wp-cnum__spin {
  display: flex; flex-direction: column; width: var(--cnum-spin); flex-shrink: 0;
  border-left: 1px solid var(--wp-border); background: color-mix(in oklab, var(--wp-accent) 4%, transparent);
}
.wp-cnum__btn {
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 0; border: 0;
  background: transparent; color: var(--wp-text-dim); cursor: pointer; line-height: 0;
}
.wp-cnum__btn .pi { font-size: 7px; }
.wp-cnum--md .wp-cnum__btn .pi, .wp-cnum--lg .wp-cnum__btn .pi { font-size: 8px; }
.wp-cnum__btn + .wp-cnum__btn { border-top: 1px solid var(--wp-border); }
.wp-cnum__btn:hover:not(:disabled) { color: var(--wp-accent-text); background: color-mix(in oklab, var(--wp-accent) 12%, transparent); }
.wp-cnum__btn:disabled { cursor: not-allowed; }
</style>
