<script setup lang="ts">
/**
 * RichTextInput
 *
 * A textarea/input replacement that renders a syntax-highlight overlay for
 * Wildcard Pipeline expression syntax (`$var`, `@ref`, `{a|b|c}`, `N#$var`,
 * `# comment`, `$$`/`@@` escapes). The user-visible glyphs come from a
 * mirrored `<div>` painted behind a transparent textarea — see the
 * focused/rest dual mode comments below for why this gymnastic is needed.
 *
 * Reference: docs/design-handoff/wildcardpipeline/project/rich-input.jsx.
 */
import { computed, nextTick, ref, watch } from "vue";
import { tokenizeRich, mirrorHtmlWithIdx } from "../utils/richTokenize";

interface Props {
  modelValue: string;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  varSuggestions?: string[];
  refSuggestions?: string[];
  ariaLabel?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  multiline: false,
  rows: 4,
  placeholder: "",
  varSuggestions: () => [],
  refSuggestions: () => [],
  ariaLabel: undefined,
  disabled: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

// --- Refs ---
const inputEl = ref<HTMLTextAreaElement | HTMLInputElement | null>(null);
const mirrorEl = ref<HTMLDivElement | null>(null);
const popoverEl = ref<HTMLDivElement | null>(null);
const focused = ref(false);

// Autocomplete state.
const acOpen = ref(false);
const acQuery = ref("");
const acTrigger = ref<"$" | "@">("$");
const acStart = ref(-1);
const acActive = ref(0);
const acFlipUp = ref(false);

// --- Tokenize + mirror HTML (pre-escaped — see richTokenize.ts). ---
const tokens = computed(() => tokenizeRich(props.modelValue || ""));
// SAFE: `mirrorHtmlWithIdx` HTML-escapes every `raw` payload before
// concatenation. The resulting string only contains tags we generated, so
// `v-html` cannot inject user-controlled markup.
const mirrorHtml = computed(() => mirrorHtmlWithIdx(tokens.value));

// --- Suggestion list filtering. ---
const acItems = computed(() => {
  if (!acOpen.value) return [];
  const pool = acTrigger.value === "@" ? props.refSuggestions : props.varSuggestions;
  const q = acQuery.value.toLowerCase();
  return pool
    .filter((label) => label.toLowerCase().includes(q))
    .slice(0, 8);
});

watch(acItems, (items) => {
  if (acActive.value >= items.length) acActive.value = 0;
});

// --- Mirror/textarea scroll sync (multi-line scrolling alignment). ---
function syncScroll(): void {
  const ta = inputEl.value;
  const mirror = mirrorEl.value;
  if (!ta || !mirror) return;
  mirror.scrollTop = ta.scrollTop;
  mirror.scrollLeft = ta.scrollLeft;
}
watch(() => props.modelValue, () => { void nextTick(syncScroll); });

// --- Autocomplete probe: scan back from caret through `[a-zA-Z0-9_]` until
//     we hit a `$` or `@` trigger (and bail if it's a `$$` / `@@` escape). ---
function probeAutocomplete(str: string, caret: number): {
  start: number;
  query: string;
  trigger: "$" | "@";
} | null {
  let i = caret - 1;
  while (i >= 0 && /[a-zA-Z0-9_]/.test(str[i])) i--;
  if (i < 0) return null;
  const trigger = str[i];
  if (trigger !== "$" && trigger !== "@") return null;
  if (i > 0 && str[i - 1] === trigger) return null;       // mid-escape `$$x`
  if (str[i + 1] === trigger) return null;                 // immediate `$$`
  return { start: i, query: str.slice(i + 1, caret), trigger };
}

function maybeFlipUp(): void {
  // Open downwards by default; flip if there isn't enough room below.
  const wrap = inputEl.value?.parentElement;
  if (!wrap) { acFlipUp.value = false; return; }
  const rect = wrap.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  acFlipUp.value = spaceBelow < 200 && rect.top > 200;
}

// --- Handlers ---
function onInput(e: Event): void {
  const target = e.target as HTMLTextAreaElement | HTMLInputElement;
  const next = target.value;
  emit("update:modelValue", next);
  const caret = target.selectionStart ?? next.length;
  const hit = probeAutocomplete(next, caret);
  if (hit) {
    acOpen.value = true;
    acStart.value = hit.start;
    acQuery.value = hit.query;
    acTrigger.value = hit.trigger;
    acActive.value = 0;
    maybeFlipUp();
  } else {
    acOpen.value = false;
  }
}

function refreshAutocompleteFromCaret(): void {
  const el = inputEl.value;
  if (!el) return;
  const caret = el.selectionStart ?? 0;
  const hit = probeAutocomplete(props.modelValue || "", caret);
  if (hit) {
    acOpen.value = true;
    acStart.value = hit.start;
    acQuery.value = hit.query;
    acTrigger.value = hit.trigger;
  } else {
    acOpen.value = false;
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (acOpen.value && acItems.value.length > 0) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      acActive.value = (acActive.value + 1) % acItems.value.length;
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      acActive.value = (acActive.value - 1 + acItems.value.length) % acItems.value.length;
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applyAutocomplete(acItems.value[acActive.value]);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      acOpen.value = false;
      return;
    }
  }
}

function onSelect(): void {
  // `select` fires on caret moves too in modern browsers; refresh AC state
  // so e.g. arrow-key navigation into a `$tok` opens the menu correctly.
  if (focused.value) refreshAutocompleteFromCaret();
}

function applyAutocomplete(label: string | undefined): void {
  if (!label) return;
  const el = inputEl.value;
  if (!el) return;
  const value = props.modelValue || "";
  const caret = el.selectionStart ?? value.length;
  const before = value.slice(0, acStart.value);
  const after = value.slice(caret);
  const inserted = acTrigger.value + label;
  const next = before + inserted + after;
  emit("update:modelValue", next);
  acOpen.value = false;
  void nextTick(() => {
    const pos = (before + inserted).length;
    el.focus();
    el.setSelectionRange(pos, pos);
  });
}

function onFocus(): void {
  focused.value = true;
}
function onBlur(e: FocusEvent): void {
  // Keep autocomplete open if focus moved into the popover (mousedown on
  // an item is dispatched before the textarea blur event in some browsers).
  const next = e.relatedTarget as Node | null;
  if (next && popoverEl.value?.contains(next)) return;
  focused.value = false;
  // Slight delay so a mousedown on a suggestion still fires before close.
  window.setTimeout(() => {
    acOpen.value = false;
  }, 120);
}

function onSuggestionMouseDown(e: MouseEvent, label: string): void {
  // `mousedown` (not click) so we beat the textarea blur.
  e.preventDefault();
  applyAutocomplete(label);
}
</script>

<template>
  <div
    class="wp-rt"
    :class="[
      multiline ? 'wp-rt--multi' : 'wp-rt--single',
      focused ? 'wp-rt--focused' : 'wp-rt--rest',
    ]"
    :data-focused="focused ? '' : null"
  >
    <!-- The mirror is read-only chrome; pointer-events:none in CSS.
         `v-html` is safe because mirrorHtmlWithIdx() escapes all token text. -->
    <div
      ref="mirrorEl"
      class="wp-rt__mirror"
      :class="multiline ? 'wp-rt__mirror--multi' : 'wp-rt__mirror--single'"
      aria-hidden="true"
      v-html="mirrorHtml"
    />

    <textarea
      v-if="multiline"
      ref="inputEl"
      class="wp-rt__input wp-rt__input--multi"
      :value="modelValue"
      :placeholder="placeholder"
      :rows="rows"
      :aria-label="ariaLabel"
      :disabled="disabled"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeyDown"
      @select="onSelect"
      @keyup="onSelect"
      @click="onSelect"
      @scroll="syncScroll"
      @focus="onFocus"
      @blur="onBlur"
    />
    <input
      v-else
      ref="inputEl"
      class="wp-rt__input wp-rt__input--single"
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
      :disabled="disabled"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeyDown"
      @select="onSelect"
      @keyup="onSelect"
      @click="onSelect"
      @scroll="syncScroll"
      @focus="onFocus"
      @blur="onBlur"
    >

    <div
      v-if="acOpen && acItems.length > 0"
      ref="popoverEl"
      class="wp-rt-suggestions"
      :class="{ 'wp-rt-suggestions--up': acFlipUp }"
      role="listbox"
    >
      <div class="wp-rt-suggestions__head">
        <span class="wp-rt-suggestions__query">{{ acTrigger }}{{ acQuery }}</span>
        <span class="wp-rt-suggestions__hint">↑↓ Enter · Esc</span>
      </div>
      <button
        v-for="(label, i) in acItems"
        :key="label"
        type="button"
        class="wp-rt-suggestions__item"
        :data-active="i === acActive ? '' : null"
        role="option"
        :aria-selected="i === acActive"
        @mousedown="(e) => onSuggestionMouseDown(e, label)"
        @mouseenter="acActive = i"
      >
        <span class="wp-rt-suggestions__trigger">{{ acTrigger }}</span>{{ label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Container ------------------------------------------------------------- */
.wp-rt {
  position: relative;
  width: 100%;
  background: var(--wp-bg-2, #15151f);
  border: 1px solid var(--wp-border, rgba(255, 255, 255, 0.08));
  border-radius: 7px;
  transition: border-color .12s, background .12s, box-shadow .12s;
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12.5px;
}
.wp-rt--focused {
  border-color: var(--wp-accent-500, #8b5cf6);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 25%, transparent);
  background: var(--wp-bg-1, #11111b);
}

/* Mirror layer — paints styled tokens behind the textarea.
   Two visual modes are toggled by the parent class:
     wp-rt--focused : while editing, chips are zero-width visual decorations
                      (background + box-shadow only, no padding/margin/border)
                      so the mirror text width matches the textarea text width
                      exactly and the native caret tracks correctly.
     wp-rt--rest    : when blurred, chips get a hair of horizontal padding
                      so they read as proper pills at a glance. */
.wp-rt__mirror {
  position: absolute;
  inset: 0;
  margin: 0;
  font-family: inherit;
  font-size: inherit;
  color: var(--wp-text, #e7e7ee);
  pointer-events: none;
  user-select: none;
  letter-spacing: 0;
  box-sizing: border-box;
  overflow: hidden;
}
.wp-rt__mirror--single {
  padding: 0 10px;
  line-height: var(--wp-input-h, 34px);
  white-space: pre;
}
.wp-rt__mirror--multi {
  padding: 8px 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Input layer — transparent text so the mirror shows through; visible caret. */
.wp-rt__input {
  position: relative;
  display: block;
  width: 100%;
  margin: 0;
  border: none;
  outline: none;
  background: transparent;
  color: transparent;
  caret-color: var(--wp-text, #e7e7ee);
  font-family: inherit;
  font-size: inherit;
  letter-spacing: 0;
  box-sizing: border-box;
  resize: none;
}
.wp-rt__input--single {
  height: var(--wp-input-h, 34px);
  padding: 0 10px;
  line-height: var(--wp-input-h, 34px);
}
.wp-rt__input--multi {
  padding: 8px 10px;
  line-height: 1.5;
  resize: vertical;
  min-height: 72px;
  white-space: pre-wrap;
  word-break: break-word;
}
.wp-rt__input::selection {
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 38%, transparent);
  color: transparent;
}
.wp-rt__input::placeholder {
  color: var(--wp-text-dim, #6e6e7c);
}

/* Token spans ----------------------------------------------------------- */
.wp-rt :deep(.wp-rt-text)     { color: var(--wp-text, #e7e7ee); }
.wp-rt :deep(.wp-rt-comment)  { color: var(--wp-text-dim, #6e6e7c); font-style: italic; }
.wp-rt :deep(.wp-rt-escape)   { color: var(--wp-text-muted, #a1a1ad); opacity: 0.7; }
.wp-rt :deep(.wp-rt-tail)     { color: transparent; }

.wp-rt :deep(.wp-rt-var) {
  color: var(--wp-accent-text-strong, var(--wp-accent-text, #c4b5fd));
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 15%, transparent);
  border-radius: 4px;
  font-weight: 500;
}
.wp-rt :deep(.wp-rt-ref) {
  color: var(--wp-kind-wildcard, #f0abfc);
  background: color-mix(in oklab, var(--wp-kind-wildcard, #c026d3) 12%, transparent);
  border-radius: 4px;
  font-weight: 500;
}
.wp-rt :deep(.wp-rt-dp-brace) { color: var(--wp-warn, #fcd34d); font-weight: 600; }
.wp-rt :deep(.wp-rt-dp-pipe)  { color: var(--wp-warn, #fcd34d); opacity: 0.65; }
.wp-rt :deep(.wp-rt-dp-multi) {
  color: var(--wp-rt-token-good);
  background: var(--wp-rt-token-good-bg);
  border-radius: 3px;
  font-weight: 500;
}
.wp-rt :deep(.wp-rt-dp-weight) {
  color: var(--wp-rt-token-mut);
  background: var(--wp-rt-token-mut-bg);
  border-radius: 3px;
  font-weight: 500;
}
.wp-rt :deep(.wp-rt-quantifier) {
  color: var(--wp-info, #60a5fa);
  background: color-mix(in oklab, var(--wp-info, #3b82f6) 14%, transparent);
  border-radius: 3px;
  font-weight: 500;
}

/* Focus / rest dual-mode chip chrome. */
.wp-rt--focused :deep(.wp-rt-var),
.wp-rt--focused :deep(.wp-rt-ref) {
  padding: 0;
  box-shadow: inset 0 0 0 1px var(--wp-accent-500, #8b5cf6);
}
.wp-rt--rest :deep(.wp-rt-var),
.wp-rt--rest :deep(.wp-rt-ref) {
  padding: 0 4px;
  border-radius: 4px;
}
.wp-rt--rest :deep(.wp-rt-dp-multi),
.wp-rt--rest :deep(.wp-rt-dp-weight),
.wp-rt--rest :deep(.wp-rt-quantifier) {
  padding: 0 3px;
}

/* Autocomplete popover -------------------------------------------------- */
.wp-rt-suggestions {
  position: absolute;
  left: 8px;
  right: 8px;
  top: calc(100% + 4px);
  z-index: 30;
  background: var(--wp-bg-1, #11111b);
  border: 1px solid var(--wp-border-strong, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  padding: 4px;
  box-shadow: var(--wp-shadow, 0 4px 16px rgba(0, 0, 0, 0.35));
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 240px;
  overflow-y: auto;
}
.wp-rt-suggestions--up {
  top: auto;
  bottom: calc(100% + 4px);
}
.wp-rt-suggestions__head {
  display: flex;
  gap: 8px;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--wp-text-muted, #a1a1ad);
  border-bottom: 1px solid var(--wp-border, rgba(255, 255, 255, 0.08));
  margin-bottom: 2px;
}
.wp-rt-suggestions__query {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  color: var(--wp-accent-text, #c4b5fd);
}
.wp-rt-suggestions__hint {
  margin-left: auto;
  opacity: 0.7;
}
.wp-rt-suggestions__item {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--wp-text, #e7e7ee);
  cursor: pointer;
}
.wp-rt-suggestions__item[data-active] {
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 22%, transparent);
}
.wp-rt-suggestions__trigger {
  color: var(--wp-accent-text, #c4b5fd);
}
</style>
