<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "./Icon.vue";

export interface SelectOption {
  value: string | number | null;
  label: string;
}

interface Props {
  modelValue: string | number | null;
  options: SelectOption[];
  placeholder?: string;
  clearable?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
}
const props = withDefaults(defineProps<Props>(), { size: "md", placeholder: "Select…" });

const emit = defineEmits<{
  (e: "update:modelValue", v: string | number | null): void;
  (e: "change", v: string | number | null): void;
}>();

const wrapRef = ref<HTMLDivElement | null>(null);
const btnRef = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const flip = ref(false);
const active = ref(0);

const selected = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null);

const btnClasses = computed(() => [
  "wp-select",
  props.size === "sm" && "wp-select--sm",
]);

function onDocClick(e: MouseEvent) {
  if (!wrapRef.value) return;
  if (!wrapRef.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
});

watch(open, (v) => {
  if (!v || !btnRef.value) return;
  // Decide if the menu should flip above the button.
  const rect = btnRef.value.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const need = Math.min(240, props.options.length * 30 + 12);
  flip.value = spaceBelow < need + 16 && spaceAbove > spaceBelow;
  // Highlight currently-selected option (or first).
  const idx = props.options.findIndex((o) => o.value === props.modelValue);
  active.value = idx >= 0 ? idx : 0;
});

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
}

function pick(opt: SelectOption) {
  emit("update:modelValue", opt.value);
  emit("change", opt.value);
  open.value = false;
  nextTick(() => btnRef.value?.focus());
}

function clear(e: MouseEvent) {
  e.stopPropagation();
  emit("update:modelValue", null);
  emit("change", null);
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return;
  if (!open.value) {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      open.value = true;
    }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    open.value = false;
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    active.value = (active.value + 1) % props.options.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    active.value = (active.value - 1 + props.options.length) % props.options.length;
  } else if (e.key === "Enter") {
    e.preventDefault();
    const opt = props.options[active.value];
    if (opt) pick(opt);
  }
}
</script>

<template>
  <div ref="wrapRef" class="wp-select-wrap">
    <button
      ref="btnRef"
      type="button"
      :class="btnClasses"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      :aria-haspopup="'listbox'"
      data-test="select-trigger"
      @click="toggle"
      @keydown="onKeydown"
    >
      <span v-if="selected">{{ selected.label }}</span>
      <span v-else class="wp-select__placeholder">{{ placeholder }}</span>
      <span class="wp-spacer" />
      <button
        v-if="clearable && selected"
        type="button"
        class="wp-chip__close"
        aria-label="Clear"
        @click="clear"
      >
        <Icon name="times" :size="10" />
      </button>
      <Icon class="wp-select__chevron" name="chevron-down" />
    </button>
    <ul
      v-if="open"
      class="wp-select__menu"
      role="listbox"
      :data-flip="flip ? 'true' : 'false'"
    >
      <li
        v-for="(opt, i) in options"
        :key="String(opt.value)"
        class="wp-select__option"
        role="option"
        tabindex="-1"
        :aria-selected="opt.value === modelValue"
        :data-active="i === active ? 'true' : 'false'"
        :data-selected="opt.value === modelValue ? 'true' : 'false'"
        @mousedown.prevent="pick(opt)"
        @mouseenter="active = i"
        @focusin="active = i"
      >
        {{ opt.label }}
        <span class="wp-spacer" />
        <Icon v-if="opt.value === modelValue" name="check" :size="11" />
      </li>
    </ul>
  </div>
</template>
