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
/** Type-to-filter query, built from printable keystrokes while the menu
 *  is open. Reset every time the menu opens or closes. */
const query = ref("");

/** Fixed-position coordinates for the teleported menu. */
const menuStyle = ref<Record<string, string>>({});

const selected = computed(() => props.options.find((o) => o.value === props.modelValue) ?? null);

/** Options narrowed by `query` (case-insensitive substring on the label).
 *  Empty query → all options, so every dropdown is type-to-filter. */
const filtered = computed<SelectOption[]>(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.options;
  return props.options.filter((o) => o.label.toLowerCase().includes(q));
});

const btnClasses = computed(() => [
  "wp-select",
  props.size === "sm" && "wp-select--sm",
]);

/** Surface an aria-label only when there's no visible selected text —
 *  otherwise the visible label IS the accessible name and an aria-label
 *  override would just disagree with the visible text (axe rule
 *  label-content-name-mismatch). When the trigger shows a placeholder
 *  with no selection, fall through to the ariaLabel prop. */
const composedAriaLabel = computed<string | undefined>(() => {
  if (selected.value) return undefined;
  return props.ariaLabel;
});

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
    query.value = "";
    window.removeEventListener("scroll", closeOnScroll, true);
    window.removeEventListener("resize", reposition);
    return;
  }
  if (!btnRef.value) return;
  query.value = "";
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
  const list = filtered.value;
  if (e.key === "Escape") {
    e.preventDefault();
    open.value = false;
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (list.length) active.value = (active.value + 1) % list.length;
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (list.length) active.value = (active.value - 1 + list.length) % list.length;
  } else if (e.key === "Enter") {
    e.preventDefault();
    const opt = list[active.value];
    if (opt) pick(opt);
  } else if (e.key === "Backspace") {
    e.preventDefault();
    query.value = query.value.slice(0, -1);
    active.value = 0;
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Printable key → type-to-filter; jump the highlight back to the top.
    e.preventDefault();
    query.value += e.key;
    active.value = 0;
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
      :aria-label="composedAriaLabel"
      :aria-expanded="open"
      :aria-haspopup="'listbox'"
      :aria-invalid="error || undefined"
      data-test="select-trigger"
      @click="toggle"
      @keydown="onKeydown"
    >
      <!-- Selected label — optional color dot prefix. Consumers can
           override the label text rendering via the `#label` scoped
           slot (e.g. to render `@{uuid}` ref chips instead of raw text). -->
      <span class="wp-select__label-wrap">
        <span v-if="selected?.dot" class="wp-select__dot" :style="{ background: selected.dot }" />
        <span v-if="selected" class="wp-select__label-text">
          <slot name="label" :option="selected">{{ selected.label }}</slot>
        </span>
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
          v-if="query"
          class="wp-select__filter"
          aria-hidden="true"
          data-test="select-filter"
          style="display:flex;align-items:center;padding:4px 12px;font-size:11px;opacity:0.6;"
        >Filtering: {{ query }}</li>
        <li
          v-for="(opt, i) in filtered"
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
          <span class="wp-select__option-label">
            <slot name="option" :option="opt">{{ opt.label }}</slot>
          </span>
          <span class="wp-spacer" />
          <Icon v-if="opt.value === modelValue" name="check" :size="ICON_SM" />
        </li>
        <li
          v-if="!filtered.length"
          class="wp-select__empty"
          aria-disabled="true"
          data-test="select-empty"
          style="padding:6px 12px;opacity:0.55;"
        >No matches</li>
      </ul>
    </Teleport>
  </div>
</template>

<!--
  Self-contained styles so <Select> works everywhere it's used — including the
  ComfyUI CANVAS widget bundle, which does NOT load the manager-global
  tokens.css (that's why an unstyled Select rendered behind the modal there).
  Class names stay wp-select* (global-namespaced, no collision); the menu is
  teleported to <body>, so these are UNSCOPED — same pattern as the
  RichTextInput autocomplete (wp-rt-suggestions), whose z-index:9999 already
  renders above the canvas modals. Vars fall back to literals for the few the
  canvas theme doesn't define (--wp-input-h[-sm], --wp-focus-ring). In the SPA
  these duplicate tokens.css with identical rules — harmless.
-->
<style>
.wp-select-wrap { position: relative; display: inline-block; width: 100%; }

/* Trigger button — the manager .wp-input base (height/bg/border/…) inlined
 * here + flex layout for label · spacer · chevron. */
.wp-select {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: var(--wp-input-h, 34px);
  box-sizing: border-box;
  padding: 0 10px;
  text-align: left;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background: var(--wp-bg-2);
  color: var(--wp-text);
  border: 1px solid var(--wp-border, rgba(255, 255, 255, 0.08));
  border-radius: var(--wp-radius-sm);
  font-size: 12.5px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
}
.wp-select--sm { height: var(--wp-input-h-sm, 28px); font-size: 12px; padding: 0 8px; }
.wp-select:focus-visible,
.wp-select:focus {
  border-color: var(--wp-accent-500);
  box-shadow: var(--wp-focus-ring, 0 0 0 3px color-mix(in oklab, var(--wp-accent-500) 25%, transparent));
  background: var(--wp-bg-1);
}
.wp-select[aria-invalid="true"] { border-color: var(--wp-error-border, var(--wp-danger, #ef4444)); }
.wp-select:disabled { opacity: 0.6; cursor: default; }

.wp-select__label-wrap {
  display: flex; align-items: center; gap: 6px;
  flex: 1; min-width: 0; overflow: hidden;
}
.wp-select__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.wp-select__label-text,
.wp-select__placeholder {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wp-select__placeholder { color: var(--wp-text-dim); }
.wp-select__chevron { color: var(--wp-text-dim); font-size: 11px; margin-left: 6px; flex-shrink: 0; }
.wp-spacer { flex: 1 1 auto; }

/* Menu — teleported to <body>. z-index 9999 matches wp-rt-suggestions, which
 * already renders above the canvas modals. */
.wp-select__menu {
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border-strong);
  border-radius: 7px;
  box-shadow: var(--wp-shadow-lg);
  z-index: 9999;
  padding: 4px;
  max-height: 240px;
  overflow: auto;
  list-style: none;
  margin: 0;
}
.wp-select__option {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 12.5px;
  user-select: none;
}
.wp-select__option:hover { background: var(--wp-bg-4); color: var(--wp-text); }
.wp-select__option[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 20%, transparent);
  color: var(--wp-text);
}
.wp-select__option[data-selected="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  color: var(--wp-text);
}
.wp-select__option-label { flex: 1; white-space: nowrap; }
.wp-select__filter { display: flex; align-items: center; padding: 4px 12px; font-size: 11px; opacity: 0.6; }
.wp-select__empty { padding: 6px 12px; opacity: 0.55; }

/* Rich content (RichTextPreview / chips) rendered in the trigger label or an
 * option row via the #label / #option slots defaults to pre-wrap (that's
 * RichTextPreview's own scoped rule) and WRAPS. Force single-line so:
 *   (a) a long picked value ellipsis-clips in the fixed-height trigger instead
 *       of wrapping + blowing up the surrounding row, and
 *   (b) dropdown options stay on one line, letting the menu grow to fit the
 *       widest (min-width = trigger; max-width caps it inside the viewport).
 * `!important` is needed to beat RichTextPreview's scoped `.wp-rtp` rule from
 * outside the component; white-space then inherits down to the inner spans. */
.wp-select__label-text .wp-rtp,
.wp-select__label-text .wp-rtp__text,
.wp-select__option-label .wp-rtp,
.wp-select__option-label .wp-rtp__text {
  white-space: nowrap !important;
}
.wp-select__menu { max-width: min(620px, 92vw); }
</style>
