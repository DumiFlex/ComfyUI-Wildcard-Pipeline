<script setup lang="ts">
/**
 * A colour swatch that opens a picker: the colour square, a hex box, and
 * (with `alpha`) an opacity number, or (with `allowNone`) a "None" choice.
 * The value is a hex string, `#rrggbb` or `#rrggbbaa` once it is
 * see-through, or `none`. Other text (a colour name typed in a workflow) is
 * kept and shown as it is until a pick replaces it. Sits on the kit Popover,
 * so it follows the swatch on scroll and closes on Escape or a click
 * outside. Works on the canvas (`size="sm"`) and in the manager.
 *
 *   <ColorField v-model="labelColor" alpha allow-none size="sm" aria-label="Label band" />
 */
import { computed, ref, watch } from "vue";
import HsvPicker from "./HsvPicker.vue";
import Popover from "./Popover.vue";
import WpNumber from "./WpNumber.vue";
import WpButton from "./WpButton.vue";
import { rgbToHex } from "./hsv";

const props = withDefaults(defineProps<{
  modelValue: string;
  /** Offer an opacity number (writes `#rrggbbaa`). */
  alpha?: boolean;
  /** Offer "None" (writes `none`). */
  allowNone?: boolean;
  size?: "sm" | "md";
  ariaLabel?: string;
  disabled?: boolean;
  dataTest?: string;
}>(), { alpha: false, allowNone: false, size: "sm", ariaLabel: "Colour", disabled: false, dataTest: undefined });

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` → `{ rgb: "#rrggbb", alpha: 0-255 }`. */
function parse(value: string): { rgb: string; alpha: number } | null {
  const v = value.trim();
  if (!HEX.test(v)) return null;
  let h = v.slice(1).toLowerCase();
  if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
  return { rgb: `#${h.slice(0, 6)}`, alpha: h.length === 8 ? parseInt(h.slice(6), 16) : 255 };
}
function compose(rgb: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  return a >= 255 ? rgb : `${rgb}${a.toString(16).padStart(2, "0")}`;
}

const open = ref(false);
const isNone = computed(() => props.modelValue.trim().toLowerCase() === "none");
const parsed = computed(() => parse(props.modelValue));
const BLACK = rgbToHex({ r: 0, g: 0, b: 0 });
const rgb = computed(() => parsed.value?.rgb ?? BLACK);
const alphaValue = computed(() => (parsed.value ? parsed.value.alpha : 255));
const opacity = computed(() => Math.round((alphaValue.value / 255) * 100));

const shown = computed(() => (isNone.value ? "none" : props.modelValue.trim() || "none"));
const swatch = computed(() => {
  if (isNone.value) return "transparent";
  const p = parsed.value;
  if (!p) return props.modelValue;
  return `rgba(${parseInt(p.rgb.slice(1, 3), 16)}, ${parseInt(p.rgb.slice(3, 5), 16)}, ${parseInt(p.rgb.slice(5, 7), 16)}, ${p.alpha / 255})`;
});

const draft = ref(props.modelValue);
watch(() => props.modelValue, (v) => { draft.value = v; });
watch(open, (v) => { if (v) draft.value = props.modelValue; });

function onHsv(hex: string): void {
  emit("update:modelValue", compose(hex, props.alpha ? alphaValue.value : 255));
}
function onOpacity(pct: number | null): void {
  if (pct === null) return;
  emit("update:modelValue", compose(rgb.value, (pct / 100) * 255));
}
function onDraft(ev: Event): void {
  const v = (ev.target as HTMLInputElement).value.trim();
  draft.value = v;
  const p = parse(v);
  if (p) emit("update:modelValue", compose(p.rgb, props.alpha ? p.alpha : 255));
}
function pickNone(): void {
  emit("update:modelValue", "none");
  open.value = false;
}
</script>

<template>
  <Popover v-model:open="open" :label="ariaLabel">
    <template #trigger="{ props: triggerProps }">
      <button
        v-bind="triggerProps"
        type="button"
        class="wp-color-field"
        :class="[`wp-color-field--${size}`, { 'is-none': isNone }]"
        :disabled="disabled"
        :aria-label="`${ariaLabel}: ${shown}`"
        :data-test="dataTest"
      >
        <span class="wp-color-field__chip" aria-hidden="true">
          <span class="wp-color-field__fill" :style="{ background: swatch }" />
        </span>
        <span class="wp-color-field__value" aria-hidden="true">{{ shown }}</span>
      </button>
    </template>
    <div class="wp-color-field__panel" @keydown.stop>
      <HsvPicker :model-value="rgb" :aria-label="ariaLabel" @update:model-value="onHsv" />
      <div class="wp-color-field__row">
        <input
          class="wp-color-field__hex"
          :value="draft"
          :aria-label="`${ariaLabel} hex`"
          spellcheck="false"
          :data-test="dataTest ? `${dataTest}-hex` : undefined"
          @change="onDraft"
          @keydown.enter="onDraft"
        >
        <WpNumber
          v-if="alpha"
          class="wp-color-field__alpha"
          :model-value="isNone ? 0 : opacity"
          :min="0"
          :max="100"
          suffix="%"
          size="sm"
          :aria-label="`${ariaLabel} opacity`"
          :data-test="dataTest ? `${dataTest}-alpha` : undefined"
          @update:model-value="onOpacity"
        />
      </div>
      <WpButton
        v-if="allowNone"
        size="sm"
        variant="ghost"
        icon="pi-ban"
        :pressed="isNone"
        :data-test="dataTest ? `${dataTest}-none` : undefined"
        @click="pickNone"
      >None</WpButton>
    </div>
  </Popover>
</template>

<style scoped>
.wp-color-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: var(--wp-control-h-sm, 24px);
  padding: 0 8px 0 3px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  color: var(--wp-text);
  font: 11px var(--wp-font-mono, monospace);
  cursor: pointer;
}
.wp-color-field--md { height: var(--wp-control-h-md, 32px); font-size: 12px; }
.wp-color-field:hover:not(:disabled) { border-color: var(--wp-border-strong); }
.wp-color-field:focus-visible { outline: 2px solid var(--wp-focus-ring); outline-offset: 1px; }
.wp-color-field:disabled { opacity: 0.5; cursor: default; }
.wp-color-field__chip {
  position: relative;
  flex: none;
  width: 16px;
  height: 16px;
  overflow: hidden;
  border: 1px solid var(--wp-border-strong);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  /* Checks show through a see-through colour. */
  background: repeating-conic-gradient(var(--wp-bg-4) 0 25%, var(--wp-bg-1) 0 50%) 0 0 / 8px 8px;
}
.wp-color-field__fill { position: absolute; inset: 0; }
.wp-color-field.is-none .wp-color-field__chip::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(to top right, transparent calc(50% - 1px), var(--wp-danger) 50%, transparent calc(50% + 1px));
}
.wp-color-field__value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-color-field.is-none .wp-color-field__value { color: var(--wp-text-dim); font-family: var(--wp-font-sans, sans-serif); }

.wp-color-field__panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 200px;
  padding: 0;
}
.wp-color-field__row { display: flex; gap: 6px; align-items: center; }
.wp-color-field__hex {
  flex: 1;
  min-width: 0;
  height: var(--wp-control-h-sm, 24px);
  padding: 0 6px;
  background: var(--wp-bg-1);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font: 11px var(--wp-font-mono, monospace);
  outline: none;
}
.wp-color-field__hex:focus { border-color: var(--wp-border-focus); }
.wp-color-field__alpha { width: 72px; flex: none; }
</style>
