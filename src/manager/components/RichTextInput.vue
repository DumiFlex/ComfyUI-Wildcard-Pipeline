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
import { insertAtom, parse, replaceAtom, serialise, type Atom, type Cursor } from "./atomicEditorModel";
import RefChip from "./RefChip.vue";
import SubcategoryFilterPicker from "./SubcategoryFilterPicker.vue";
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
  /** Map from wildcard UUID → its declared sub_categories. Used by the
   *  step-2 picker so the user sees the correct sub-cat chips for the
   *  wildcard they picked. */
  uuidToSubCategories?: Map<string, string[]>;
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
  uuidToSubCategories: () => new Map(),
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

// --- Step-2 SubcategoryFilterPicker state ---
// Opened after picking an `@` ref that has declared sub_categories. Both the
// insert flow (Task 7) and the click-to-edit flow (Task 8) drive the same
// picker — `pickerMode` distinguishes them.
const pickerOpen = ref(false);
const pickerSubCats = ref<string[]>([]);
const pickerInitial = ref<string[]>([]);
const pickerMode = ref<"insert" | "edit">("insert");
// The atom-index this picker is editing — null when inserting fresh.
const pickerTargetAtomIndex = ref<number | null>(null);
// During insert flow we stash the uuid + the insertion cursor so the
// apply/skip handlers can build the right atom + put it in the right
// place after the picker closes.
const pendingInsert = ref<{ uuid: string; cursor: Cursor } | null>(null);

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

function onChipClick(idx: number): void {
  const atom = atoms.value[idx];
  if (!atom || atom.kind !== "ref") return;
  // Unresolved refs have no edit affordance — RefChip already gates the click
  // emit but be defensive in case a future caller routes here directly.
  if (!props.uuidToName.has(atom.uuid)) return;
  pickerSubCats.value = props.uuidToSubCategories.get(atom.uuid) ?? [];
  pickerInitial.value = atom.subCategories;
  pickerMode.value = "edit";
  pickerTargetAtomIndex.value = idx;
  pendingInsert.value = null;
  pickerOpen.value = true;
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
// NOTE: `refreshAutocompleteFromCaret` is preserved verbatim because Task 9
// rewires it to the contenteditable host's Selection API. It currently
// targets the transitional `inputEl` ref (always null after the Task 5
// rewrite) and so is effectively a no-op until then. The autocomplete-
// apply path (`applyAutocomplete`) below is the live path driven by
// Task 7's test seams (`__triggerAutocompleteForTest`, etc.) and by the
// suggestion popover's mousedown.
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
  if (acTrigger.value === "@") {
    const subCats = props.uuidToSubCategories.get(label) ?? [];
    if (subCats.length === 0) {
      // No sub-categories declared — insert plain ref immediately.
      insertRefAtCursor(label, []);
    } else {
      // Open step-2 picker so the user can multi-select sub-categories.
      pendingInsert.value = { uuid: label, cursor: currentCursor() };
      pickerSubCats.value = subCats;
      pickerInitial.value = [];
      pickerMode.value = "insert";
      pickerTargetAtomIndex.value = null;
      pickerOpen.value = true;
    }
  } else {
    // `$var` trigger — insert var atom directly (no step-2 picker for vars).
    insertVarAtCursor(label);
  }
  acOpen.value = false;
}

function insertRefAtCursor(uuid: string, subCategories: string[]): void {
  const atom: Atom = { kind: "ref", uuid, subCategories };
  const cur = currentCursor();
  const result = insertAtom(atoms.value, cur, atom);
  emit("update:modelValue", serialise(result.atoms));
}

function insertVarAtCursor(name: string): void {
  const atom: Atom = { kind: "var", name };
  const cur = currentCursor();
  const result = insertAtom(atoms.value, cur, atom);
  emit("update:modelValue", serialise(result.atoms));
}

function currentCursor(): Cursor {
  const host = hostEl.value;
  if (!host) return { atomIndex: atoms.value.length, offset: 0 };
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { atomIndex: atoms.value.length, offset: 0 };
  const range = sel.getRangeAt(0);
  if (!host.contains(range.startContainer)) {
    return { atomIndex: atoms.value.length, offset: 0 };
  }
  // Walk the host's child list to find which atom the range start lives in.
  // The host children are 1:1 with `atoms` in render order — BUT Vue's
  // `<template v-for>` injects fragment-marker text nodes (empty
  // textContent) around each rendered child. We need to map DOM child
  // index → atom index by counting only the meaningful children
  // (RefChip elements + .wp-rt__text spans), skipping fragment markers.
  const meaningful: Node[] = [];
  for (const child of host.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      // Vue fragment markers are empty text nodes — skip those, but
      // keep user-inserted text nodes (which have non-empty content).
      if ((child.textContent ?? "").length > 0) meaningful.push(child);
    } else {
      meaningful.push(child);
    }
  }

  for (let i = 0; i < meaningful.length; i++) {
    const node = meaningful[i];
    if (node === range.startContainer) {
      // The range start IS this child — cursor sits AT this atom boundary.
      return { atomIndex: i + range.startOffset, offset: 0 };
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).contains(range.startContainer)) {
      const el = node as HTMLElement;
      if (el.classList.contains("wp-rt__text")) {
        return { atomIndex: i, offset: range.startOffset };
      }
      // Range inside a chip — treat as cursor at the END of that chip.
      return { atomIndex: i + 1, offset: 0 };
    }
  }
  return { atomIndex: atoms.value.length, offset: 0 };
}

// --- SubcategoryFilterPicker handlers ---
function onPickerApply(subCats: string[]): void {
  if (pickerMode.value === "insert" && pendingInsert.value) {
    insertRefAtCursor(pendingInsert.value.uuid, subCats);
    pendingInsert.value = null;
  } else if (pickerMode.value === "edit" && pickerTargetAtomIndex.value !== null) {
    const target = atoms.value[pickerTargetAtomIndex.value];
    if (target && target.kind === "ref") {
      const next = replaceAtom(atoms.value, pickerTargetAtomIndex.value, {
        ...target,
        subCategories: subCats,
      });
      emit("update:modelValue", serialise(next));
    }
  }
  pickerOpen.value = false;
}

function onPickerSkip(): void {
  if (pickerMode.value === "insert" && pendingInsert.value) {
    insertRefAtCursor(pendingInsert.value.uuid, []);
    pendingInsert.value = null;
  }
  pickerOpen.value = false;
}

function onPickerDelete(): void {
  if (pickerTargetAtomIndex.value !== null) {
    const idx = pickerTargetAtomIndex.value;
    const next = atoms.value.filter((_, i) => i !== idx);
    emit("update:modelValue", serialise(next));
  }
  pickerOpen.value = false;
}

function cancelPicker(): void {
  // Backdrop dismiss is a clean cancel — drop pending state, do NOT
  // insert anything. Use Skip inside the picker to insert without
  // filter.
  pendingInsert.value = null;
  pickerTargetAtomIndex.value = null;
  pickerOpen.value = false;
}

function onPickerEscape(ev: KeyboardEvent): void {
  if (ev.key === "Escape") cancelPicker();
}

watch(pickerOpen, (open) => {
  if (open) {
    window.addEventListener("keydown", onPickerEscape);
  } else {
    window.removeEventListener("keydown", onPickerEscape);
  }
});

// --- Test seams ---
// Only used by Vitest, not user-facing. Exposed via defineExpose so test
// scripts can drive the autocomplete state machine without faking keyboard
// events (which are flaky under jsdom).
function __triggerAutocompleteForTest(trigger: "@" | "$"): void {
  acOpen.value = true;
  acTrigger.value = trigger;
}

function __applyAutocompleteForTest(label: string): void {
  applyAutocomplete(label);
}

defineExpose({ __triggerAutocompleteForTest, __applyAutocompleteForTest });

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
  window.removeEventListener("keydown", onPickerEscape);
});

// `refreshAutocompleteFromCaret` is currently orphaned because the `@input`
// / `@select` / `@keyup` / `@click` handlers that used to call it lived on
// the now-removed <textarea>/<input>. Preserve the function shape for Task 6
// to wire up against the contenteditable host's selection events without
// having to reimplement the probe-from-caret logic. Reference it here so
// strict noUnusedLocals doesn't strip it.
void refreshAutocompleteFromCaret;

// --- Host DOM → raw text serialisation ---
// Walks the contenteditable host's children and rebuilds the raw expression
// string. Text nodes contribute their text directly (Vue's `<template
// v-for>` inserts empty text-node fragment markers around each entry —
// those are harmless empty strings here). `.wp-refchip` children are
// atomic — we read the underlying atom (via `data-atom-index`) and
// reconstruct the canonical syntax (`@{uuid}` / `@{uuid:sub}` / `$name`),
// NOT the chip's rendered display text (e.g. `@color` for a resolved UUID).
// `.wp-rt__text` spans hold the live text — user typing modifies the span's
// textContent in place (browsers extend the existing span's content rather
// than inserting sibling text nodes), so we read whatever's there now.
function readHostAsText(): string {
  const host = hostEl.value;
  if (!host) return "";
  let out = "";
  for (const node of host.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    if (el.classList.contains("wp-refchip")) {
      // Chips are atomic — read the underlying atom (via data-atom-index)
      // and reconstruct canonical syntax (`@{uuid}` / `@{uuid:sub}` /
      // `$name`), NOT the chip's rendered display text.
      const idx = Number(el.getAttribute("data-atom-index"));
      const atom = atoms.value[idx];
      if (!atom) continue;
      if (atom.kind === "ref") {
        out += "@{" + atom.uuid;
        if (atom.subCategories.length > 0) out += ":" + atom.subCategories.join(",");
        out += "}";
      } else if (atom.kind === "var") {
        out += "$" + atom.name;
      }
      continue;
    }
    if (el.classList.contains("wp-rt__text")) {
      // wp-rt__text spans hold the live text — user typing modifies the
      // span's textContent in place, so we read whatever's there now.
      out += el.textContent ?? "";
      continue;
    }
    // Defensive fallback for any other element (shouldn't happen in
    // practice — host children are chips + text spans + fragment markers).
    out += el.textContent ?? "";
  }
  return out;
}

function onHostInput(): void {
  const next = readHostAsText();
  if (next !== props.modelValue) emit("update:modelValue", next);
}
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
      @input="onHostInput"
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

    <!-- Backdrop click cancels the picker without inserting anything. To
         insert an unfiltered @{uuid}, use the Skip button inside the
         picker. -->
    <Teleport to="body" v-if="pickerOpen">
      <div class="wp-subcat-picker__overlay" @click="cancelPicker">
        <div @click.stop>
          <SubcategoryFilterPicker
            :sub-categories="pickerSubCats"
            :initial-selection="pickerInitial"
            :mode="pickerMode"
            @apply="onPickerApply"
            @skip="onPickerSkip"
            @delete="onPickerDelete"
          />
        </div>
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

/* Step-2 SubcategoryFilterPicker overlay — fixed, full-viewport backdrop
   teleported to <body> so it escapes ancestor overflow/transform contexts.
   Centred picker; backdrop click cancels the picker (no insert). Escape
   key dismisses with the same cancel semantics. */
.wp-subcat-picker__overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
