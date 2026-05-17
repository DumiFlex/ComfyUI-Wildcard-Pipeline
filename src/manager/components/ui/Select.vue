<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon, { ICON_SM } from "./Icon.vue";

export interface SelectOption {
  value: string | number | null;
  label: string;
  /** Optional color dot shown before the label (e.g. category color). */
  dot?: string;
  /** Optional native tooltip surfaced via `title` on the option row.
   *  Used by derivation op dropdown to explain semantics — e.g.
   *  "matches" shows "Python regex via re.search". */
  title?: string;
}

interface Props {
  modelValue: string | number | null;
  options: SelectOption[];
  placeholder?: string;
  clearable?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  error?: boolean;
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

/** Fixed-position coordinates for the teleported menu. */
const menuStyle = ref<Record<string, string>>({});

const selected = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null);

const btnClasses = computed(() => [
  "wp-select",
  props.size === "sm" && "wp-select--sm",
]);

function onDocClick(e: MouseEvent) {
  const t = e.target as Node | null;
  if (!t) return;
  // Close when click is outside the trigger button AND outside the menu.
  if (wrapRef.value?.contains(t)) return;
  open.value = false;
}

onMounted(() => {
  document.addEventListener("mousedown", onDocClick, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick, true);
  window.removeEventListener("scroll", closeOnScroll, true);
  window.removeEventListener("resize", reposition);
});

function closeOnScroll(e: Event) {
  // Capture-phase listener catches every scroll in the page so the menu
  // closes when the user scrolls the *outer* layout (their attention has
  // clearly moved). The one event we MUST ignore is the menu's own
  // overflow:auto scroll — without this guard, the first wheel/touch on
  // a long option list closes the menu on the first scroll-pixel and
  // the scrollbar appears non-functional.
  const t = e.target as Element | null;
  if (t && typeof t.closest === "function" && t.closest(".wp-select__menu")) {
    return;
  }
  open.value = false;
}
function reposition() {
  if (!open.value || !btnRef.value) return;
  computeMenuStyle();
}

function computeMenuStyle() {
  if (!btnRef.value) return;
  const rect = btnRef.value.getBoundingClientRect();
  // Ideal menu height = enough room for every option (~36px each + 12px
  // padding), capped at 240px so a huge library doesn't blanket the
  // viewport. The actual rendered height also gets capped by available
  // screen space below — see `effectiveMaxHeight` — so the menu never
  // bleeds past the viewport edge.
  const idealHeight = Math.min(240, props.options.length * 36 + 12);
  const gap = 4;       // spacing between trigger and menu
  const margin = 8;    // breathing room from the viewport edge
  const spaceBelow = window.innerHeight - rect.bottom - gap - margin;
  const spaceAbove = rect.top - gap - margin;

  // Flip above only when there isn't enough room below AND there's
  // more room above than below — otherwise the menu still grows under
  // the trigger and `effectiveMaxHeight` clamps it to whatever fits.
  flip.value = spaceBelow < idealHeight && spaceAbove > spaceBelow;

  const available = flip.value ? spaceAbove : spaceBelow;
  // Floor at 80px so a tightly-cramped row (e.g. inside a modal near the
  // viewport edge) still surfaces a usable scrolling list rather than
  // collapsing to a 1-row sliver.
  const effectiveMaxHeight = Math.max(80, Math.min(idealHeight, available));

  menuStyle.value = flip.value
    ? {
        position: "fixed",
        bottom: (window.innerHeight - rect.top + gap) + "px",
        top: "auto",
        left: rect.left + "px",
        minWidth: rect.width + "px",
        maxHeight: effectiveMaxHeight + "px",
      }
    : {
        position: "fixed",
        top: (rect.bottom + gap) + "px",
        bottom: "auto",
        left: rect.left + "px",
        minWidth: rect.width + "px",
        maxHeight: effectiveMaxHeight + "px",
      };
}

watch(open, (v) => {
  if (!v) {
    window.removeEventListener("scroll", closeOnScroll, true);
    window.removeEventListener("resize", reposition);
    return;
  }
  if (!btnRef.value) return;
  computeMenuStyle();
  // Highlight currently-selected option (or first).
  const idx = props.options.findIndex((o) => o.value === props.modelValue);
  active.value = idx >= 0 ? idx : 0;
  window.addEventListener("scroll", closeOnScroll, true);
  window.addEventListener("resize", reposition);
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
      :aria-invalid="error || undefined"
      data-test="select-trigger"
      @click="toggle"
      @keydown="onKeydown"
    >
      <!-- Selected label — optional color dot prefix. -->
      <span class="wp-select__label-wrap">
        <span v-if="selected?.dot" class="wp-select__dot" :style="{ background: selected.dot }" />
        <span v-if="selected" class="wp-select__label-text">{{ selected.label }}</span>
        <span v-else class="wp-select__placeholder">{{ placeholder }}</span>
      </span>
      <button
        v-if="clearable && selected"
        type="button"
        class="wp-chip__close"
        aria-label="Clear"
        @click="clear"
      >
        <Icon name="times" :size="ICON_SM" />
      </button>
      <Icon class="wp-select__chevron" name="chevron-down" />
    </button>

    <!-- Menu teleported to <body> so it escapes any overflow:hidden ancestor
         and renders above the sticky footer regardless of z-index stacking contexts. -->
    <Teleport to="body">
      <ul
        v-if="open"
        class="wp-select__menu"
        role="listbox"
        :style="menuStyle"
        data-test="select-menu"
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
          :title="opt.title"
          @mousedown.prevent="pick(opt)"
          @mouseenter="active = i"
          @focusin="active = i"
        >
          <span v-if="opt.dot" class="wp-select__dot" :style="{ background: opt.dot }" />
          <span class="wp-select__option-label">{{ opt.label }}</span>
          <span class="wp-spacer" />
          <Icon v-if="opt.value === modelValue" name="check" :size="ICON_SM" />
        </li>
      </ul>
    </Teleport>
  </div>
</template>
