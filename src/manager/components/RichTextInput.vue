<script setup lang="ts">
/**
 * RichTextInput
 *
 * Atomic-chip editor host for Wildcard Pipeline expression syntax
 * (`$var`, `@ref`, `{a|b|c}`). The bound `modelValue` is parsed via
 * `atomicEditorModel.parse(...)` into an `Atom[]` list and each atom is
 * rendered either as a `RefChip` (for ref/var atoms) or a plain text
 * span. The host element is `contenteditable` so the native caret lives
 * inside the chip stream, but THIS TASK ships READ rendering only —
 * input handling (typing, deletion, autocomplete insertion, click-to-
 * edit) is wired up in Tasks 6/7/8.
 *
 * The `$` / `@` autocomplete popover is teleported to <body> and
 * positioned with `position: fixed` so it escapes any ancestor
 * `overflow: hidden` (e.g. the `.wp-rt` wrapper itself, scroll
 * containers in editor tables). The popover state is preserved here
 * verbatim from the previous implementation; the input plumbing that
 * drives it (`probeAutocomplete`, `onInput`, etc.) is currently
 * dormant because the textarea it used to read from is gone. Task 6
 * rewires those handlers against the contenteditable host + selection
 * API.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { parse, type Atom } from "./atomicEditorModel";
import RefChip from "./RefChip.vue";
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
// `inputEl` is a transitional dead ref. The original textarea/input it
// pointed at was removed in this task; the autocomplete machinery
// below still references it because Task 6 rewires that machinery
// against `hostEl` + the Selection API. Until then, the popover-state
// code path runs but produces no UI because nothing dispatches `@input`.
const inputEl = ref<HTMLTextAreaElement | HTMLInputElement | null>(null);
const hostEl = ref<HTMLDivElement | null>(null);
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

// --- Atom rendering ---
// `parse(modelValue)` collapses text/escape/dp-* tokens into plain text
// atoms and lifts only var/ref tokens out as chip atoms. Brace
// alternation `{a|b|c}` stays as text in this model — chips are reserved
// for tokens with structured identity (UUIDs, variable names).
const atoms = computed<Atom[]>(() => parse(props.modelValue || ""));

function atomIsResolved(atom: Atom): boolean {
  if (atom.kind === "var") {
    return props.varSuggestions.includes(atom.name);
  }
  if (atom.kind === "ref") {
    return props.uuidToName.has(atom.uuid);
  }
  return true;
}

function onChipClick(_idx: number): void {
  // Wired up in Task 8 — click-to-edit picker integration.
}

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
// Anchor to the wrapper's bounding box. We use the host's parent (`.wp-rt`)
// rect rather than caret pixel coordinates for robustness — caret-pixel
// math against a contenteditable is error-prone and the prototype ships
// the same "below-the-input" behaviour. Flips above when there's no room
// below.
function positionPopup(): void {
  const host = hostEl.value;
  if (!host) return;
  const wrap = host.parentElement;
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
// NOTE: `onInput` / `refreshAutocompleteFromCaret` / `onKeyDown` /
// `onSelect` / `applyAutocomplete` are preserved verbatim because Task 6
// rewires them to the contenteditable host. They currently target the
// transitional `inputEl` ref (always null after this rewrite) and so
// are effectively no-ops until then.
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
  if (hostEl.value?.contains(t)) return;
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

// `refreshAutocompleteFromCaret` is currently orphaned because the `@input`
// / `@select` / `@keyup` / `@click` handlers that used to call it lived on
// the now-removed <textarea>/<input>. Preserve the function shape for Task 6
// to wire up against the contenteditable host's selection events without
// having to reimplement the probe-from-caret logic. Reference it here so
// strict noUnusedLocals doesn't strip it.
void refreshAutocompleteFromCaret;
</script>

<template>
  <div
    class="wp-rt"
    :class="[
      multiline ? 'wp-rt--multi' : 'wp-rt--single',
      focused ? 'wp-rt--focused' : 'wp-rt--rest',
      disabled ? 'wp-rt--disabled' : null,
    ]"
    :data-focused="focused ? '' : null"
  >
    <!-- Contenteditable host. Children are RefChip atoms (for ref/var
         atoms) and plain text spans (for everything else). The native
         caret lives inside this element; chips are `contenteditable=
         false` so the caret skips over them as atomic units.
         Input handling lands in Task 6. -->
    <div
      ref="hostEl"
      class="wp-rt__host"
      :class="multiline ? 'wp-rt__host--multi' : 'wp-rt__host--single'"
      :contenteditable="!disabled"
      :aria-label="ariaLabel"
      :data-placeholder="placeholder"
      :data-multiline="multiline"
      role="textbox"
      :aria-multiline="multiline"
      spellcheck="false"
      @focus="focused = true"
      @blur="focused = false"
    >
      <template v-for="(atom, idx) in atoms" :key="idx">
        <RefChip
          v-if="atom.kind === 'ref' || atom.kind === 'var'"
          :kind="atom.kind"
          :name="atom.kind === 'var' ? atom.name : (uuidToName.get(atom.uuid) ?? '')"
          :uuid="atom.kind === 'ref' ? atom.uuid : ''"
          :sub-categories="atom.kind === 'ref' ? atom.subCategories : []"
          :resolved="atomIsResolved(atom)"
          :data-atom-index="idx"
          @click="onChipClick(idx)"
        />
        <span v-else :data-atom-index="idx" class="wp-rt__text">{{ atom.text }}</span>
      </template>
    </div>

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
  border-radius: var(--wp-radius);
  transition: border-color .12s, background .12s, box-shadow .12s;
  overflow: hidden;
  box-sizing: border-box;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: var(--wp-text-sm);
}
.wp-rt--focused {
  border-color: var(--wp-accent-500, #8b5cf6);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 25%, transparent);
  background: var(--wp-bg-1, #11111b);
}
.wp-rt--disabled {
  opacity: 0.6;
  pointer-events: none;
}

/* Contenteditable host. Chips are atomic (contenteditable=false on the
   chip root) so the caret skips them. Text atoms are regular spans —
   the caret enters them like ordinary characters. */
.wp-rt__host {
  display: block;
  width: 100%;
  margin: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--wp-text, #e7e7ee);
  font-family: inherit;
  font-size: inherit;
  letter-spacing: 0;
  box-sizing: border-box;
}
.wp-rt__host--single {
  height: var(--wp-input-h, 34px);
  padding: 0 var(--wp-space-5);
  line-height: var(--wp-input-h, 34px);
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
}
.wp-rt__host--multi {
  padding: var(--wp-space-4) var(--wp-space-5);
  line-height: 1.5;
  min-height: 72px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Placeholder ghost — fires only when the host is empty AND not focused.
   Modern selector parity with `<input placeholder>`. */
.wp-rt__host:empty::before {
  content: attr(data-placeholder);
  color: var(--wp-text-dim, #6e6e7c);
  pointer-events: none;
}

/* Plain text atom — inherits host typography. Inline so it flows with
   sibling chips on the same line. */
.wp-rt__text {
  white-space: pre-wrap;
}

/* Warning markers overlay — sits atop the host, pointer-events: none so
   it does not block typing. */
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
  border-radius: var(--wp-radius);
  padding: 0 var(--wp-space-2) var(--wp-space-2);
  box-shadow: var(--wp-shadow-lg, var(--wp-shadow, 0 10px 30px rgba(0, 0, 0, 0.45)));
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: var(--wp-text-sm);
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
  gap: var(--wp-space-4);
  padding: var(--wp-space-3) var(--wp-space-5);
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim, #6e6e7c);
  background: var(--wp-bg-3, #1e1e2a);
  border-bottom: 1px solid var(--wp-border, rgba(255, 255, 255, 0.08));
  margin: 0 -4px var(--wp-space-2); /* audit-exempt: -4px negative margin bleeds header to popover edges */
  border-radius: var(--wp-radius) var(--wp-radius) 0 0;
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
  border-radius: var(--wp-radius-sm);
  padding: 7px var(--wp-space-5); /* audit-exempt: 7px vertical hairline keeps items compact */
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: var(--wp-text-sm);
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
