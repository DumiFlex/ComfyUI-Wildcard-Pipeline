<script setup lang="ts">
/**
 * Tag input: type a word and press Enter (or a comma) to add it as a chip;
 * Backspace in the empty box takes the last chip off; each chip's ✕ removes
 * it. Suggestions open under the box as you type and follow it on scroll
 * (a kit Popover). Pasting "a, b, c" adds three. Works on the canvas
 * (`size="sm"`) and in the manager (`md`).
 *
 *   <TagInput v-model="tags" :suggestions="libraryTags" aria-label="Tags" />
 *   <TagInput v-model="axes" :suggestions="known" :allow-new="false" :normalize="(t) => t.toLowerCase()" />
 *
 * APG combobox with a list: the arrows move through the suggestions, Enter
 * takes the lit one (or the typed text), Escape closes the list. A tag that
 * is already there isn't added twice; a polite live line says what
 * happened.
 */
import { computed, nextTick, ref, useId } from "vue";
import Popover from "./Popover.vue";

const props = withDefaults(defineProps<{
  modelValue: string[];
  suggestions?: string[];
  /** Take words that aren't in `suggestions`. */
  allowNew?: boolean;
  /** At most this many tags. */
  max?: number;
  /** Clean a tag before it is added (trim by default). Return "" to refuse it. */
  normalize?: (t: string) => string;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
  /** How many suggestions to show at once. */
  limit?: number;
}>(), {
  suggestions: () => [], allowNew: true, max: undefined,
  placeholder: "Add a tag", size: "md", ariaLabel: "Tags", limit: 8,
});

const emit = defineEmits<{ (e: "update:modelValue", v: string[]): void }>();

const uid = useId();
const listId = `wp-tag-input-list-${uid}`;
const inputEl = ref<HTMLInputElement | null>(null);
const query = ref("");
/** The list may show: the box has focus and nobody closed the list since the last key. */
const wanted = ref(false);
const active = ref(-1);
const said = ref("");

const clean = (t: string): string => (props.normalize ? props.normalize(t) : t.trim());
const has = (t: string): boolean => props.modelValue.some((x) => x.toLowerCase() === t.toLowerCase());
const full = computed(() => props.max !== undefined && props.modelValue.length >= props.max);

const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  const pool = props.suggestions.filter((s) => !has(s));
  const hit = q ? pool.filter((s) => s.toLowerCase().includes(q)) : pool;
  // Words that start with the query first, then the rest.
  return [...hit.filter((s) => s.toLowerCase().startsWith(q)), ...hit.filter((s) => !s.toLowerCase().startsWith(q))].slice(0, props.limit);
});
const open = computed(() => wanted.value && !full.value && !props.disabled && matches.value.length > 0);
const activeId = computed(() => (open.value && active.value >= 0 ? `${listId}-${active.value}` : undefined));

function announce(text: string): void {
  said.value = "";
  void nextTick(() => { said.value = text; });
}

function add(raw: string): boolean {
  const t = clean(raw);
  if (!t) return false;
  if (has(t)) { announce(`${t} is already added`); return false; }
  if (full.value) { announce(`At most ${props.max} tags`); return false; }
  const known = props.suggestions.find((s) => s.toLowerCase() === t.toLowerCase());
  if (!props.allowNew && !known) { announce(`${t} is not one of the choices`); return false; }
  emit("update:modelValue", [...props.modelValue, known ?? t]);
  announce(`Added ${known ?? t}`);
  return true;
}

function addMany(parts: string[]): void {
  let list = [...props.modelValue];
  const added: string[] = [];
  for (const p of parts) {
    const t = clean(p);
    if (!t || list.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    if (props.max !== undefined && list.length >= props.max) break;
    const known = props.suggestions.find((s) => s.toLowerCase() === t.toLowerCase());
    if (!props.allowNew && !known) continue;
    list = [...list, known ?? t];
    added.push(known ?? t);
  }
  if (added.length) {
    emit("update:modelValue", list);
    announce(`Added ${added.join(", ")}`);
  }
}

function remove(i: number, refocus = false): void {
  const t = props.modelValue[i];
  if (t === undefined || props.disabled) return;
  emit("update:modelValue", props.modelValue.filter((_, j) => j !== i));
  announce(`Removed ${t}`);
  if (refocus) inputEl.value?.focus();
}

function commit(): void {
  if (open.value && active.value >= 0 && matches.value[active.value]) {
    if (add(matches.value[active.value])) query.value = "";
  } else if (query.value.trim() && add(query.value)) {
    query.value = "";
  }
  active.value = -1;
}

function onKeydown(ev: KeyboardEvent): void {
  if (props.disabled) return;
  switch (ev.key) {
    case "Enter":
      if (!query.value.trim() && active.value < 0) return;
      ev.preventDefault();
      commit();
      return;
    case ",":
      ev.preventDefault();
      if (query.value.trim() && add(query.value)) query.value = "";
      return;
    case "ArrowDown":
      if (!matches.value.length) return;
      ev.preventDefault();
      if (!wanted.value) { wanted.value = true; active.value = 0; return; }
      active.value = (active.value + 1) % matches.value.length;
      return;
    case "ArrowUp":
      if (!matches.value.length) return;
      ev.preventDefault();
      active.value = active.value <= 0 ? matches.value.length - 1 : active.value - 1;
      return;
    case "Backspace":
      if (query.value === "" && props.modelValue.length) {
        ev.preventDefault();
        remove(props.modelValue.length - 1);
      }
      return;
    default:
  }
}

function onInput(): void {
  wanted.value = true;
  if (query.value.includes(",")) {
    const parts = query.value.split(",");
    query.value = parts.pop() ?? "";
    addMany(parts);
  }
  active.value = -1;
}

function onPaste(ev: ClipboardEvent): void {
  const text = ev.clipboardData?.getData("text") ?? "";
  if (!/[,\n]/.test(text)) return;
  ev.preventDefault();
  addMany(text.split(/[,\n]/));
}

function pick(s: string): void {
  if (add(s)) query.value = "";
  active.value = -1;
  inputEl.value?.focus();
}

function setOpen(v: boolean): void {
  // The list closes itself on Escape or a click outside; reopen on typing.
  if (!v) { wanted.value = false; active.value = -1; }
}
</script>

<!-- Popover's autofocus prop is off here: focus stays in the box you type in. -->
<!-- eslint-disable vuejs-accessibility/no-autofocus -->
<template>
  <Popover :open="open" role="group" match-width :autofocus="false" :label="`${ariaLabel} suggestions`" @update:open="setOpen">
    <template #trigger>
      <!-- A click on the box's padding focuses the text field, which has the keys. -->
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
      <div
        class="wp-tag-input"
        :data-size="size"
        :data-disabled="disabled || undefined"
        :data-invalid="invalid || undefined"
        @click="inputEl?.focus()"
      >
        <span v-for="(t, i) in modelValue" :key="t" class="wp-tag-input__chip">
          <span class="wp-tag-input__chip-text">{{ t }}</span>
          <button
            type="button"
            class="wp-tag-input__remove"
            :aria-label="`Remove ${t}`"
            :disabled="disabled"
            @click.stop="remove(i, true)"
          ><i class="pi pi-times" aria-hidden="true" /></button>
        </span>
        <input
          ref="inputEl"
          v-model="query"
          class="wp-tag-input__field"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          :aria-label="ariaLabel"
          :aria-expanded="open"
          :aria-controls="open ? listId : undefined"
          :aria-activedescendant="activeId"
          :aria-invalid="invalid || undefined"
          :placeholder="full ? '' : placeholder"
          :disabled="disabled || full"
          autocomplete="off"
          @focus="wanted = true"
          @blur="wanted = false"
          @keydown="onKeydown"
          @input="onInput"
          @paste="onPaste"
        >
        <span class="wp-tag-input__sr" aria-live="polite">{{ said }}</span>
      </div>
    </template>
    <ul :id="listId" class="wp-tag-input__list" role="listbox" :aria-label="`${ariaLabel} suggestions`">
      <!-- Options are lit with aria-activedescendant; the text field keeps focus and the keys. -->
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/interactive-supports-focus -->
      <li
        v-for="(s, i) in matches"
        :id="`${listId}-${i}`"
        :key="s"
        class="wp-tag-input__opt"
        role="option"
        :aria-selected="i === active"
        :data-active="i === active || undefined"
        @mousedown.prevent
        @click="pick(s)"
      >{{ s }}</li>
    </ul>
  </Popover>
</template>

<style scoped>
.wp-tag-input {
  --_h: var(--wp-control-h-md);
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px; box-sizing: border-box;
  width: 100%; min-height: var(--_h); padding: 3px var(--wp-space-3);
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  background: var(--wp-bg-1); color: var(--wp-text); cursor: text;
  font: 400 var(--wp-text-sm)/1 var(--wp-font-sans);
  transition: border-color var(--wp-motion-hover), box-shadow var(--wp-motion-hover);
}
.wp-tag-input[data-size="sm"] { --_h: var(--wp-control-h-sm); padding: 2px var(--wp-space-2); border-radius: var(--wp-radius-sm); font-size: var(--wp-text-xs); gap: 3px; }
.wp-tag-input[data-size="lg"] { --_h: var(--wp-control-h-lg); padding: 5px var(--wp-space-4); }
.wp-tag-input:hover { border-color: var(--wp-border-strong); }
.wp-tag-input:focus-within { border-color: var(--wp-border-focus); box-shadow: 0 0 0 3px var(--wp-focus-ring); }
.wp-tag-input[data-invalid] { border-color: var(--wp-error-border); }
.wp-tag-input[data-disabled] { opacity: 0.45; cursor: not-allowed; }
.wp-tag-input__chip {
  display: inline-flex; align-items: center; gap: 2px; max-width: 100%; box-sizing: border-box;
  height: 20px; padding: 0 2px 0 7px;
  border: 1px solid var(--wp-border-strong); border-radius: var(--wp-radius-cap, 999px); background: var(--wp-bg-3);
  color: var(--wp-text); font-size: var(--wp-text-xs); line-height: 1;
}
.wp-tag-input[data-size="sm"] .wp-tag-input__chip { height: 16px; padding-left: 5px; font-size: 10.5px; }
.wp-tag-input__chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Plain ✕: no background zone, the chip keeps its height; the hit area is 20 px. */
.wp-tag-input__remove {
  display: inline-grid; place-items: center; width: 16px; height: 16px; margin: -2px 0; padding: 0;
  border: 0; border-radius: min(50%, var(--wp-radius-cap, 999px)); background: transparent; color: var(--wp-text-muted); cursor: pointer;
  position: relative;
}
.wp-tag-input__remove::before { content: ""; position: absolute; inset: -2px; }
.wp-tag-input__remove .pi { font-size: 8px; }
.wp-tag-input__remove:hover:not(:disabled) { color: var(--wp-text); }
.wp-tag-input__remove:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-tag-input__field {
  flex: 1 0 6ch; min-width: 6ch; height: calc(var(--_h) - 8px); margin: 0; padding: 0 2px;
  border: 0; outline: none; background: transparent; color: inherit; font: inherit;
}
.wp-tag-input__field::placeholder { color: var(--wp-text-dim); }
.wp-tag-input__field:disabled { cursor: not-allowed; }
.wp-tag-input__sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.wp-tag-input__list { margin: calc(var(--wp-space-2) * -1); padding: 0; list-style: none; }
.wp-tag-input__opt {
  padding: 6px var(--wp-space-4); border-radius: var(--wp-radius-sm);
  color: var(--wp-text); font-size: var(--wp-text-sm); cursor: pointer;
}
.wp-tag-input__opt:hover, .wp-tag-input__opt[data-active] { background: var(--wp-row-hover); }
.wp-tag-input__opt[data-active] { box-shadow: inset 2px 0 0 var(--wp-accent); }
@media (prefers-reduced-motion: reduce) {
  .wp-tag-input { transition: none; }
}
</style>
