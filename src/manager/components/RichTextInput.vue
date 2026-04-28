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
 * The `$` / `@` autocomplete popover is teleported to <body> and positioned
 * with `position: fixed` so it escapes any ancestor `overflow: hidden`
 * (e.g. the `.wp-rt` wrapper itself, scroll containers in editor tables).
 *
 * Reference: docs/design-handoff/wildcardpipeline/project/rich-input.jsx.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { tokenizeRich } from "../utils/richTokenize";
import type { SurfaceKind, ResolveWarning } from "../utils/resolveTokens";

interface Props {
  modelValue: string;
  surface?: SurfaceKind;
  warnings?: ResolveWarning[];
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  varSuggestions?: string[];
  refSuggestions?: string[];
  /** Map from UUID to display name; used to render `@{uuid}` refs as human labels. */
  uuidToName?: Map<string, string>;
  ariaLabel?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  surface: "wildcard",
  warnings: () => [],
  multiline: false,
  rows: 4,
  placeholder: "",
  varSuggestions: () => [],
  refSuggestions: () => [],
  uuidToName: () => new Map(),
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
// Popup geometry — `position: fixed` viewport coordinates so the teleported
// popover lands directly under the input regardless of ancestor overflow.
const popupPos = ref<{ top: number; left: number; width: number; flipped: boolean }>({
  top: 0,
  left: 0,
  width: 240,
  flipped: false,
});

// --- Tokenize + mirror HTML (pre-escaped — see richTokenize.ts). ---
const tokens = computed(() => tokenizeRich(props.modelValue || ""));
// SAFE: `mirrorHtmlWithIdx` HTML-escapes every `raw` payload before
// concatenation. The resulting string only contains tags we generated, so
// `v-html` cannot inject user-controlled markup.
// When `surface !== "wildcard"`, ref tokens get an extra "ignored" class
// so they render with muted styling.
const mirrorHtml = computed(() => {
  const toks = tokens.value;
  const isWildcard = props.surface === "wildcard";
  const map = props.uuidToName;
  let html = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    let cls = `wp-rt-${t.kind}`;
    let display = t.raw;
    if (t.kind === "ref") {
      if (!isWildcard) cls += " wp-rt-ref--ignored";
      // Replace `@{uuid}` with `@name` display form when name is known.
      const uuid = t.meta?.uuid;
      if (uuid && map.has(uuid)) {
        const name = map.get(uuid)!;
        // Escape the name portion (uuid chars are hex-safe but name may not be).
        display = "@" + name.replace(/[&<>"']/g, (c) => (
          { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c
        ));
      } else {
        // Fall back to escaped raw form.
        display = t.raw.replace(/[&<>"']/g, (c) => (
          { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c
        ));
      }
      html += `<span class="${cls}" data-idx="${i}">${display}</span>`;
    } else {
      html += `<span class="${cls}" data-idx="${i}">${t.raw.replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c
      ))}</span>`;
    }
  }
  html += '<span class="wp-rt-tail">&#x200B;</span>';
  return html;
});

// --- Suggestion list filtering. ---
// `@` autocomplete is only available in the "wildcard" surface.
//
// For the `@` trigger, `refSuggestions` contains UUIDs (canonical stored
// form per syntax spec) and we filter on the human display name resolved
// through `uuidToName` so the user types `@col` and matches a wildcard
// named "color". The inserted token is still the UUID — see
// `applyAutocomplete`. Falling back to the raw UUID keeps filtering useful
// even before `uuidToName` is hydrated.
const acItems = computed(() => {
  if (!acOpen.value) return [];
  if (acTrigger.value === "@" && props.surface !== "wildcard") return [];
  const pool = acTrigger.value === "@" ? props.refSuggestions : props.varSuggestions;
  const q = acQuery.value.toLowerCase();
  const labelOf = acTrigger.value === "@"
    ? (uuid: string) => (props.uuidToName.get(uuid) ?? uuid).toLowerCase()
    : (name: string) => name.toLowerCase();
  return pool.filter((id) => labelOf(id).includes(q)).slice(0, 8);
});

// Display label for a popover row: name for `@` (UUID → name lookup),
// raw token for `$`. Used by the template binding below so the popover
// stays consistent with the textarea even when refSuggestions are UUIDs.
function suggestionLabel(token: string): string {
  if (acTrigger.value === "@") return props.uuidToName.get(token) ?? token;
  return token;
}

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

// --- Popup placement ---
// Anchor to the wrapper's bounding box. We use the input's parent (`.wp-rt`)
// rect rather than caret pixel coordinates for robustness — caret-pixel
// math against a textarea is error-prone and the prototype ships the same
// "below-the-input" behaviour. Flips above when there's no room below.
function positionPopup(): void {
  const ta = inputEl.value;
  if (!ta) return;
  const wrap = ta.parentElement;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const POPUP_H = 240; // matches max-height in CSS (keep in sync)
  const spaceBelow = window.innerHeight - rect.bottom;
  const flipped = spaceBelow < POPUP_H && rect.top > POPUP_H;
  popupPos.value = {
    top: flipped ? rect.top - 4 : rect.bottom + 4,
    left: rect.left,
    width: Math.max(200, rect.width),
    flipped,
  };
}

// --- Handlers ---
function onInput(e: Event): void {
  const target = e.target as HTMLTextAreaElement | HTMLInputElement;
  const next = target.value;
  emit("update:modelValue", next);
  const caret = target.selectionStart ?? next.length;
  const hit = probeAutocomplete(next, caret);
  if (hit) {
    // Gate `@` autocomplete — only available in the "wildcard" surface.
    if (hit.trigger === "@" && props.surface !== "wildcard") {
      acOpen.value = false;
      return;
    }
    acOpen.value = true;
    acStart.value = hit.start;
    acQuery.value = hit.query;
    acTrigger.value = hit.trigger;
    acActive.value = 0;
    positionPopup();
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
    // Gate `@` autocomplete — only available in the "wildcard" surface.
    if (hit.trigger === "@" && props.surface !== "wildcard") {
      acOpen.value = false;
      return;
    }
    acOpen.value = true;
    acStart.value = hit.start;
    acQuery.value = hit.query;
    acTrigger.value = hit.trigger;
    positionPopup();
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
  // For `@` trigger in wildcard surface, `label` is a UUID; wrap it in `@{uuid}`.
  // For `$` trigger, insert `$name` as before.
  const inserted = acTrigger.value === "@"
    ? `@{${label}}`
    : acTrigger.value + label;
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

// --- Global listeners: close popup on outside-click / scroll / resize.
//     We attach lazily (only while open) so non-editing inputs cost nothing.
function onDocumentMouseDown(e: MouseEvent): void {
  const t = e.target as Node | null;
  if (!t) return;
  if (inputEl.value?.contains(t)) return;
  if (popoverEl.value?.contains(t)) return;
  acOpen.value = false;
}
function onWindowScroll(): void {
  // Scrolls outside the textarea move the anchor → easier to just close.
  acOpen.value = false;
}
function onWindowResize(): void {
  if (acOpen.value) positionPopup();
}

watch(acOpen, (open) => {
  if (open) {
    void nextTick(positionPopup);
    window.addEventListener("mousedown", onDocumentMouseDown, true);
    window.addEventListener("scroll", onWindowScroll, true);
    window.addEventListener("resize", onWindowResize);
  } else {
    window.removeEventListener("mousedown", onDocumentMouseDown, true);
    window.removeEventListener("scroll", onWindowScroll, true);
    window.removeEventListener("resize", onWindowResize);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("mousedown", onDocumentMouseDown, true);
  window.removeEventListener("scroll", onWindowScroll, true);
  window.removeEventListener("resize", onWindowResize);
});
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
         `v-html` is safe because the computed mirrorHtml escapes all token text. -->
    <div
      ref="mirrorEl"
      class="wp-rt__mirror"
      :class="multiline ? 'wp-rt__mirror--multi' : 'wp-rt__mirror--single'"
      aria-hidden="true"
      v-html="mirrorHtml"
    />

    <!-- Warning markers overlay. Each marker is a zero-width inline element
         anchored at the UTF-16 offset corresponding to the warning position.
         `data-warning-position` records the original code-point index for tests. -->
    <div
      v-if="warnings.length > 0"
      class="wp-rt__warnings"
      aria-hidden="true"
    >
      <span
        v-for="w in warnings"
        :key="`${w.position}-${w.severity}`"
        class="wp-rt-warn-marker"
        :class="`wp-rt-warn-${w.severity}`"
        :data-warning-position="w.position"
        :title="w.message"
      />
    </div>

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

    <!-- Teleport so the popover escapes ancestor overflow:hidden /
         transformed scroll containers / table cells. -->
    <Teleport to="body">
      <div
        v-if="acOpen && acItems.length > 0"
        ref="popoverEl"
        class="wp-rt-suggestions"
        :class="{ 'wp-rt-suggestions--up': popupPos.flipped }"
        :style="{
          top: popupPos.top + 'px',
          left: popupPos.left + 'px',
          minWidth: popupPos.width + 'px',
        }"
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
          <span class="wp-rt-suggestions__label">
            <span class="wp-rt-suggestions__trigger">{{ acTrigger }}</span>{{ suggestionLabel(label) }}
          </span>
        </button>
      </div>
    </Teleport>
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

/* Token span chrome (.wp-rt-var / .wp-rt-ref / .wp-rt-dp-* / quantifier
   colour + chip backgrounds + focus/rest padding) lives in the global
   styles/rich-text.css so RichTextInput and RichTextPreview stay in sync. */

/* Warning markers overlay — sits atop the mirror, pointer-events: none so
   it does not block textarea interaction. */
.wp-rt__warnings {
  position: absolute;
  inset: 0;
  pointer-events: none;
  user-select: none;
}
</style>

<style>
/* Autocomplete popover -------------------------------------------------- *
 * NOT scoped — the popover is teleported to <body>, so a scoped selector
 * (which adds a `[data-v-…]` attribute) wouldn't match. The class names
 * are component-specific (`wp-rt-suggestions*`) so global is fine.
 * ------------------------------------------------------------------------ */
.wp-rt-suggestions {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  max-width: 360px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--wp-bg-2, #15151f);
  border: 1px solid var(--wp-border-strong, rgba(255, 255, 255, 0.14));
  border-radius: 8px;
  padding: 0 4px 4px;
  box-shadow: var(--wp-shadow-lg, var(--wp-shadow, 0 10px 30px rgba(0, 0, 0, 0.45)));
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  animation: wp-rt-suggestions-in 0.12s ease-out;
}
.wp-rt-suggestions--up {
  transform: translateY(-100%);
  animation-name: wp-rt-suggestions-in-up;
}
@keyframes wp-rt-suggestions-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes wp-rt-suggestions-in-up {
  from { opacity: 0; transform: translateY(calc(-100% + 4px)); }
  to   { opacity: 1; transform: translateY(-100%); }
}
.wp-rt-suggestions__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--wp-text-dim, #6e6e7c);
  background: var(--wp-bg-3, #1e1e2a);
  border-bottom: 1px solid var(--wp-border, rgba(255, 255, 255, 0.08));
  margin: 0 -4px 4px;
  border-radius: 7px 7px 0 0;
}
.wp-rt-suggestions__query {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  color: var(--wp-accent-text, #c4b5fd);
}
.wp-rt-suggestions__hint {
  margin-left: auto;
  opacity: 0.6;
  font-family: var(--wp-font, system-ui, sans-serif);
}
.wp-rt-suggestions__item {
  display: flex;
  align-items: center;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 4px;
  padding: 7px 10px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  color: var(--wp-text, #e7e7ee);
  cursor: pointer;
}
.wp-rt-suggestions__item[data-active] {
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 22%, transparent);
}
.wp-rt-suggestions__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-rt-suggestions__trigger {
  color: var(--wp-accent-text, #c4b5fd);
}
</style>
