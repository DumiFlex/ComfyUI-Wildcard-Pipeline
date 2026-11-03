<script setup lang="ts">
/**
 * VarAutocompleteInput — single-line text input with a dropdown that
 * suggests matching var names from a flat string list. Built for the
 * derivation editor's WHEN/THEN var fields where the value is a bare
 * identifier (`age`, `mood`) — not the multi-line text-with-tokens
 * shape `RichTextInput` handles.
 *
 * Visual + keyboard UX matches RichTextInput's autocomplete popover (a kit
 * Popover under the field here, the same panel there)
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
import { computed, nextTick, ref, useId, watch } from "vue";
import Input from "@/kit/Input.vue";
import Popover from "@/kit/Popover.vue";
import { inputEl as kitInputEl } from "../utils/kit-field-el";

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

/** The `<input>` inside the kit Input (set from its template ref). */
const inputEl = ref<HTMLInputElement | null>(null);
const open = ref(false);
const active = ref(0);
/** The list's panel id (the Popover panel carries it). */
const listId = `wp-var-ac-${useId()}`;
function listEl(): HTMLElement | null {
  return document.getElementById(listId);
}

/** Filter the suggestion pool by case-insensitive substring match.
 *  Empty input shows the full list (capped to 8 — same as
 *  RichTextInput) so users discover available vars when they focus a
 *  blank field. */
/** Row cap. Matches RichTextInput's `AC_MAX_ITEMS` — an 8-row cap made the
 *  popover never overflow its `max-height`, so extra matches were simply
 *  unreachable and the scrollbar appeared broken. */
const MAX_ITEMS = 50;

const filtered = computed<string[]>(() => {
  // SP2a: strip a trailing `.K` (and a lone trailing `.`) so typing
  // `$colors.0` still matches the base `colors` suggestion.
  const q = props.modelValue.trim().toLowerCase().replace(/\.\d*$/, "");
  if (!q) return props.suggestions.slice(0, MAX_ITEMS);
  return props.suggestions
    .filter((s) => s.toLowerCase().includes(q))
    .slice(0, MAX_ITEMS);
});

// Keep the keyboard-selected row visible when the list overflows.
watch(active, (i) => {
  void nextTick(() => {
    const row = listEl()?.querySelectorAll<HTMLElement>(".wp-rt-suggestions__item")[i];
    row?.scrollIntoView({ block: "nearest" });
  });
});

function openPopup(): void {
  if (open.value) return;
  open.value = true;
  active.value = 0;
}

function closePopup(): void {
  open.value = false;
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
  if (props.suggestions.length > 0) openPopup();
}

function onFocus(): void {
  if (props.suggestions.length > 0) openPopup();
}

function onBlur(ev: FocusEvent): void {
  // Keep popover open if focus moved into it (mousedown on a
  // suggestion fires blur before click). Same pattern RichTextInput
  // uses to avoid the dropdown vanishing mid-click.
  const next = ev.relatedTarget as Node | null;
  if (next && listEl()?.contains(next)) return;
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
</script>

<template>
  <Input
    :ref="(c) => (inputEl = kitInputEl(c))"
    class="dvr-var-input"
    :style="inputColor ? { color: inputColor } : undefined"
    :model-value="modelValue"
    :placeholder="placeholder"
    :aria-label="ariaLabel"
    :data-test="dataTest"
    autocomplete="off"
    @input="onInput"
    @focus="onFocus"
    @blur="onBlur"
    @keydown="onKeydown"
  />

  <!-- Under the field, at least as wide as it. Focus stays in the field;
       Escape and a press outside close it (the field itself doesn't count). -->
  <!-- The kit Popover's own prop, turning its focus move OFF. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-autofocus -->
  <Popover :id="listId" :autofocus="false"
    :open="open && filtered.length > 0"
    :anchor="inputEl"
    :max-height="240"
    match-width
    role="listbox"
    label="Variables"
    class="wp-rt-suggestions"
    :data-test="dataTest ? `${dataTest}-popover` : undefined"
    @update:open="(v: boolean) => { if (!v) closePopup(); }"
  >
    <div class="wp-rt-suggestions__head">
      <span class="wp-rt-suggestions__query">{{ modelValue || "(any)" }}</span>
      <span class="wp-rt-suggestions__hint">↑↓ Enter · Esc</span>
    </div>
    <!-- Listbox options: focus stays in the input and the arrows move the
         highlight, so an option is never a Tab stop. -->
    <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
    <div
      v-for="(label, i) in filtered"
      :key="label"
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
    </div>
  </Popover>
</template>

<style scoped>
/* The kit Input as a bare field inside the row's own box. */
.dvr-var-input {
  flex: 1;
  height: auto;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  padding: var(--wp-space-3) var(--wp-space-5);
  font: 600 11px var(--wp-font-mono, ui-monospace, monospace); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
  min-width: 0;
  color: var(--wp-kind-derivation);
}
.dvr-var-input:focus { outline: none; box-shadow: none; background: transparent; }
</style>
