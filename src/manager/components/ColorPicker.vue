<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Input from "./ui/Input.vue";
import HsvPicker from "./HsvPicker.vue";

interface Props {
  modelValue: string;
  presets?: string[];
  ariaLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  presets: () => [
    "#7c3aed", "#a78bfa", "#22d3ee", "#34d399",
    "#fbbf24", "#f472b6", "#fb7185", "#ef4444",
    "#6366f1", "#10b981", "#f59e0b", "#8b5cf6",
  ],
  ariaLabel: undefined,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const open = ref(false);
const root = ref<HTMLDivElement | null>(null);
const hexDraft = ref(props.modelValue);

watch(() => props.modelValue, (v) => {
  hexDraft.value = v;
});

const swatchColor = computed(() => (HEX_RE.test(props.modelValue) ? props.modelValue : "#ffffff"));

const swatchAriaLabel = computed(
  () => props.ariaLabel ?? `Pick color, current ${props.modelValue}`,
);

function toggleOpen(event: Event) {
  event.stopPropagation();
  open.value = !open.value;
  if (open.value) {
    hexDraft.value = props.modelValue;
    // Listen for outside clicks once the popover is shown.
    setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
    }, 0);
  } else {
    document.removeEventListener("mousedown", handleOutsideClick);
  }
}

function close() {
  open.value = false;
  document.removeEventListener("mousedown", handleOutsideClick);
}

function handleOutsideClick(e: MouseEvent) {
  const el = root.value;
  if (el && !el.contains(e.target as Node)) close();
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    close();
  }
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

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", handleOutsideClick);
});

function isActivePreset(preset: string): boolean {
  return preset.toLowerCase() === props.modelValue.toLowerCase();
}
</script>

<template>
  <div ref="root" class="wp-color-picker" @keydown="handleKeydown">
    <button
      type="button"
      class="wp-color-picker__swatch"
      :style="{ background: swatchColor }"
      :aria-label="swatchAriaLabel"
      :aria-expanded="open"
      aria-haspopup="dialog"
      data-test="color-swatch"
      @click="toggleOpen"
    />

    <div
      v-if="open"
      class="wp-color-picker__popover"
      role="dialog"
      :aria-label="swatchAriaLabel"
    >
      <div class="wp-color-picker__row">
        <Input
          :model-value="hexDraft"
          aria-label="Hex color value"
          class="wp-color-picker__hex font-mono"
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
  </div>
</template>

<style scoped>
.wp-color-picker {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.wp-color-picker__swatch {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--wp-border-strong);
  cursor: pointer;
  padding: 0;
  outline: none;
  transition: transform 0.08s, box-shadow 0.12s;
}
.wp-color-picker__swatch:hover { transform: scale(1.05); }
.wp-color-picker__swatch:focus-visible {
  box-shadow: 0 0 0 2px var(--wp-bg-1), 0 0 0 4px var(--wp-accent-500);
}

.wp-color-picker__popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg);
  padding: var(--wp-space-5);
  width: 220px;
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
  font-size: 12px;
}

.wp-color-picker__palette {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--wp-space-3);
}

.wp-color-picker__chip {
  width: 32px;
  height: 32px;
  border-radius: 6px;
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
