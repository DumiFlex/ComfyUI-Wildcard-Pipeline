<script setup lang="ts">
/**
 * VarAutocompleteInput — single-line text input with a dropdown that
 * suggests matching var names from a flat string list. Built for the
 * derivation editor's WHEN/THEN var fields where the value is a bare
 * identifier (`age`, `mood`) — not the multi-line text-with-tokens
 * shape `RichTextInput` handles.
 *
 * Visual + keyboard UX matches RichTextInput's autocomplete popover
 * (same `wp-rt-suggestions*` classes — those styles are unscoped so
 * we re-use them globally) so the user sees a consistent dropdown
 * across both rich-text fields and var fields.
 *
 * Differences from RichTextInput:
 *   - No mirror layer / token rendering — single bare identifier only.
 *   - No `$` / `@` trigger — every keystroke filters the suggestion
 *     list against the current value as a prefix.
 *   - Empty input still shows the full suggestion list when focused
 *     so a brand-new field discloses what's available.
 */
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

defineOptions({ name: "VarAutocompleteInput" });

const props = withDefaults(
  defineProps<{
    modelValue: string;
    suggestions?: string[];
    placeholder?: string;
    /** Visual color hint applied to the input text (e.g. amber for
     *  source vars, green for action targets). Optional. */
    inputColor?: string;
    /** Forwarded to the rendered <input> element. */
    ariaLabel?: string;
    /** Forwarded as `data-test=` so test selectors stay stable. */
    dataTest?: string;
  }>(),
  { suggestions: () => [], placeholder: "" },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const inputEl = ref<HTMLInputElement | null>(null);
const popoverEl = ref<HTMLDivElement | null>(null);
const open = ref(false);
const active = ref(0);

// Floating-popover position. Computed once on open + on input changes
// so dropdown tracks the input's screen position regardless of
// ancestor overflow / transforms (matches RichTextInput's strategy).
const popupPos = ref<{ top: number; left: number; width: number; flipped: boolean }>({
  top: 0,
  left: 0,
  width: 200,
  flipped: false,
});

/** Filter the suggestion pool by case-insensitive substring match.
 *  Empty input shows the full list (capped to 8 — same as
 *  RichTextInput) so users discover available vars when they focus a
 *  blank field. */
const filtered = computed<string[]>(() => {
  const q = props.modelValue.trim().toLowerCase();
  if (!q) return props.suggestions.slice(0, 8);
  return props.suggestions
    .filter((s) => s.toLowerCase().includes(q))
    .slice(0, 8);
});

function positionPopup(): void {
  const ta = inputEl.value;
  if (!ta) return;
  const rect = ta.getBoundingClientRect();
  const POPUP_H = 240;
  const margin = 8;
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const flipped = spaceBelow < POPUP_H && rect.top > spaceBelow;
  popupPos.value = {
    top: flipped ? rect.top - 4 : rect.bottom + 4,
    left: rect.left,
    width: rect.width,
    flipped,
  };
}

function openPopup(): void {
  if (open.value) return;
  open.value = true;
  active.value = 0;
  void nextTick(() => {
    positionPopup();
    window.addEventListener("scroll", positionPopup, true);
    window.addEventListener("resize", positionPopup);
  });
}

function closePopup(): void {
  if (!open.value) return;
  open.value = false;
  window.removeEventListener("scroll", positionPopup, true);
  window.removeEventListener("resize", positionPopup);
}

function onInput(ev: Event): void {
  const next = (ev.target as HTMLInputElement).value;
  emit("update:modelValue", next);
  active.value = 0;
  // Reopen popup whenever the user types — covers two cases:
  //   1. User pressed Enter to select a suggestion (which closes the
  //      popup) and then keeps typing to refine. Without this, the
  //      dropdown stays closed forever after one Enter.
  //   2. User pressed Escape to dismiss the popup and starts typing
  //      again expecting suggestions to reappear.
  // Reposition when already open so the popup tracks the input as
  // text width shifts past placeholder rendering.
  if (props.suggestions.length > 0) {
    if (!open.value) openPopup();
    else void nextTick(positionPopup);
  }
}

function onFocus(): void {
  if (props.suggestions.length > 0) openPopup();
}

function onBlur(ev: FocusEvent): void {
  // Keep popover open if focus moved into it (mousedown on a
  // suggestion fires blur before click). Same pattern RichTextInput
  // uses to avoid the dropdown vanishing mid-click.
  const next = ev.relatedTarget as Node | null;
  if (next && popoverEl.value?.contains(next)) return;
  closePopup();
}

function selectIndex(i: number): void {
  const item = filtered.value[i];
  if (!item) return;
  emit("update:modelValue", item);
  closePopup();
  void nextTick(() => inputEl.value?.focus());
}

function onKeydown(ev: KeyboardEvent): void {
  if (!open.value) {
    if (ev.key === "ArrowDown" && filtered.value.length > 0) {
      ev.preventDefault();
      openPopup();
    }
    return;
  }
  if (ev.key === "Escape") {
    ev.preventDefault();
    closePopup();
  } else if (ev.key === "ArrowDown") {
    ev.preventDefault();
    active.value = (active.value + 1) % filtered.value.length;
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    active.value =
      (active.value - 1 + filtered.value.length) % filtered.value.length;
  } else if (ev.key === "Enter") {
    if (filtered.value[active.value]) {
      ev.preventDefault();
      selectIndex(active.value);
    }
  }
}

function onSuggestionMouseDown(ev: MouseEvent, label: string): void {
  // mousedown.prevent so the input doesn't lose focus mid-click and
  // unmount the popover before the click event fires.
  ev.preventDefault();
  void label; // selectIndex uses the active index to stay consistent
  const idx = filtered.value.indexOf(label);
  if (idx >= 0) selectIndex(idx);
}

onBeforeUnmount(() => {
  window.removeEventListener("scroll", positionPopup, true);
  window.removeEventListener("resize", positionPopup);
});
</script>

<template>
  <input
    ref="inputEl"
    type="text"
    class="dvr-var-input"
    :style="inputColor ? { color: inputColor } : undefined"
    :value="modelValue"
    :placeholder="placeholder"
    :aria-label="ariaLabel"
    :data-test="dataTest"
    autocomplete="off"
    @input="onInput"
    @focus="onFocus"
    @blur="onBlur"
    @keydown="onKeydown"
  />

  <Teleport to="body">
    <div
      v-if="open && filtered.length > 0"
      ref="popoverEl"
      class="wp-rt-suggestions"
      :class="{ 'wp-rt-suggestions--up': popupPos.flipped }"
      :style="{
        top: popupPos.top + 'px',
        left: popupPos.left + 'px',
        minWidth: popupPos.width + 'px',
      }"
      role="listbox"
      :data-test="dataTest ? `${dataTest}-popover` : undefined"
    >
      <div class="wp-rt-suggestions__head">
        <span class="wp-rt-suggestions__query">{{ modelValue || "(any)" }}</span>
        <span class="wp-rt-suggestions__hint">↑↓ Enter · Esc</span>
      </div>
      <button
        v-for="(label, i) in filtered"
        :key="label"
        type="button"
        class="wp-rt-suggestions__item"
        :data-active="i === active ? '' : null"
        role="option"
        :aria-selected="i === active"
        @mousedown="(e) => onSuggestionMouseDown(e, label)"
        @mouseenter="active = i"
      >
        <span class="wp-rt-suggestions__label">
          <span class="wp-rt-suggestions__trigger">$</span>{{ label }}
        </span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.dvr-var-input {
  flex: 1;
  background: transparent;
  border: 0;
  padding: var(--wp-space-3) var(--wp-space-5); /* audit-exempt: was 10px horiz; rounded to 12px; mirrors DerivationRuleCard */
  font: 600 11px var(--wp-font-mono, ui-monospace, monospace);
  min-width: 0;
  color: var(--wp-kind-derivation, #fbbf24);
}
.dvr-var-input:focus { outline: none; }
</style>
