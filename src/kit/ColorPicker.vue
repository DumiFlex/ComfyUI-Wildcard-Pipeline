<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Popover from "./Popover.vue";
import Input from "./Input.vue";
import HsvPicker from "./HsvPicker.vue";

interface Props {
  modelValue: string;
  presets?: string[];
  ariaLabel?: string;
  /** Swatch and chevron only, for a tight spot such as a name row. */
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  presets: () => [
    "#7c3aed", "#a78bfa", "#22d3ee", "#34d399",
    "#fbbf24", "#f472b6", "#fb7185", "#ef4444",
    "#6366f1", "#10b981", "#f59e0b", "#8b5cf6",
  ],
  ariaLabel: undefined,
  compact: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const open = ref(false);
const hexDraft = ref(props.modelValue);

watch(() => props.modelValue, (v) => {
  hexDraft.value = v;
});
// A fresh draft each time it opens, so a half-typed hex doesn't linger.
watch(open, (v) => { if (v) hexDraft.value = props.modelValue; });

const swatchColor = computed(() => (HEX_RE.test(props.modelValue) ? props.modelValue : "transparent"));
const shownHex = computed(() => (HEX_RE.test(props.modelValue) ? props.modelValue.toLowerCase() : "No colour"));

const swatchAriaLabel = computed(
  () => props.ariaLabel ?? `Pick color, current ${props.modelValue}`,
);

function close() {
  open.value = false;
}

function selectPreset(preset: string) {
  emit("update:modelValue", preset);
  close();
}

function onHexInput(value: string) {
  hexDraft.value = value;
  if (HEX_RE.test(value)) {
    emit("update:modelValue", value);
  }
}

function isActivePreset(preset: string): boolean {
  return preset.toLowerCase() === props.modelValue.toLowerCase();
}
</script>

<template>
  <!-- A swatch button that says what it holds (colour, hex, chevron), on the
       kit Popover so the panel follows it on scroll and closes on Escape or
       a click outside. -->
  <Popover v-model:open="open" :label="swatchAriaLabel">
    <template #trigger="{ props: triggerProps }">
      <button
        v-bind="triggerProps"
        type="button"
        class="wp-color-picker__trigger"
        :class="{ 'wp-color-picker__trigger--compact': compact }"
        :aria-label="swatchAriaLabel"
        data-test="color-trigger"
      >
        <span
          class="wp-color-picker__swatch"
          :style="{ background: swatchColor }"
          data-test="color-swatch"
          aria-hidden="true"
        />
        <span v-if="!compact" class="wp-color-picker__value" aria-hidden="true">{{ shownHex }}</span>
        <i class="pi pi-chevron-down wp-color-picker__caret" aria-hidden="true" />
      </button>
    </template>
    <div class="wp-color-picker__popover">
      <div class="wp-color-picker__row">
        <Input
          :model-value="hexDraft"
          aria-label="Hex color value"
          class="wp-color-picker__hex"
          data-test="color-hex-input"
          @update:model-value="(v) => onHexInput(String(v ?? ''))"
        />
      </div>
      <HsvPicker
        :model-value="props.modelValue"
        :aria-label="swatchAriaLabel"
        @update:model-value="(v) => emit('update:modelValue', v)"
      />
      <div class="wp-color-picker__palette" role="listbox" aria-label="Preset colors">
        <button
          v-for="preset in props.presets"
          :key="preset"
          type="button"
          class="wp-color-picker__chip"
          :style="{ background: preset }"
          :title="preset"
          :data-active="isActivePreset(preset)"
          :aria-label="`Use preset ${preset}`"
          data-test="color-preset"
          @click="selectPreset(preset)"
        />
      </div>
    </div>
  </Popover>
</template>

<style scoped>
.wp-color-picker__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  height: var(--wp-control-h-md, 32px);
  min-width: 128px;
  padding: 0 var(--wp-space-4) 0 var(--wp-space-2);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font: inherit;
  cursor: pointer;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.wp-color-picker__trigger--compact { min-width: 0; padding: 0 var(--wp-space-3) 0 var(--wp-space-2); gap: var(--wp-space-2); }
.wp-color-picker__trigger:hover { border-color: var(--wp-border-strong); }
.wp-color-picker__trigger:focus-visible { outline: none; border-color: var(--wp-accent-500); box-shadow: var(--wp-focus-ring); }
.wp-color-picker__swatch {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  /* An inner ring keeps a dark swatch visible on a dark field. */
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--wp-text) 22%, transparent);
}
.wp-color-picker__value {
  flex: 1;
  text-align: left;
  font-family: var(--wp-font-mono);
  font-size: 12px;
  color: var(--wp-text-muted);
}
.wp-color-picker__caret { font-size: 9px; color: var(--wp-text-dim); }

.wp-color-picker__popover {
  width: 220px;
  padding: var(--wp-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
}
.wp-color-picker__row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
}

.wp-color-picker__hex {
  flex: 1;
  min-width: 0;
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-sm);
}

.wp-color-picker__palette {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--wp-space-3);
}

.wp-color-picker__chip {
  /* Span the grid cell instead of locking at 32px so the swatches reach
   * both edges of the popover. aspect-ratio keeps them square as the
   * cell width changes with popover size. */
  width: 100%;
  aspect-ratio: 1 / 1;
  min-width: 0;
  border-radius: var(--wp-radius-sm);
  border: 1px solid var(--wp-border);
  cursor: pointer;
  padding: 0;
  transition: transform 0.08s, box-shadow 0.12s;
}
.wp-color-picker__chip:hover { transform: scale(1.08); }
.wp-color-picker__chip[data-active="true"] {
  box-shadow: 0 0 0 2px var(--wp-bg-2), 0 0 0 4px var(--wp-accent-500);
}
</style>
