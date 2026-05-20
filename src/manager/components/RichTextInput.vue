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
import {
  deleteBackward,
  parse,
  replaceAtom,
  serialise,
  type Atom,
  type Cursor,
} from "./atomicEditorModel";
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

// --- Atom rendering — semi-controlled pattern ---
//
// `atoms` is a `ref<Atom[]>`, NOT a computed off `props.modelValue`. The
// reason is brutal: Vue re-renders every host child whenever `atoms`
// changes. The browser's caret position lives inside those children, and
// a re-render mid-keystroke wipes the selection — every typed character
// would teleport the caret back to the start of the host (we hit this in
// live QA: typing "asd" produced "asdasdasa" because each emit echoed
// back through the parent → modelValue → re-derive → re-render →
// caret-lost loop).
//
// The fix is the standard contenteditable + reactive-framework pattern:
// the host is "uncontrolled" while the user types. Vue owns rendering on
// (1) initial mount, (2) external prop changes from outside the
// component, (3) explicit programmatic ops (autocomplete insert,
// picker apply/delete). User typing into a `wp-rt__text` span mutates
// the span's `textContent` in place — we read that back via
// `readHostAsText` and emit, but we DO NOT re-derive `atoms` from the
// echoed `modelValue`. `lastEmittedValue` tracks what we last emitted so
// the `watch(props.modelValue, ...)` below can distinguish the echo
// from a genuine outside change.
/** Padded-atoms invariant.
 *
 *  The contenteditable host needs a `wp-rt__text` span at every position
 *  where the user might land their caret — otherwise browsers insert
 *  user-typed characters as raw text nodes directly under the host,
 *  bypassing Vue's render tracking. Without padding, Vue's v-for diff
 *  can't reconcile against the orphan text node and subsequent
 *  programmatic inserts fail to display.
 *
 *  Invariant after this normaliser:
 *    - list is never empty (minimum `[{text:""}]`)
 *    - first atom is a text atom
 *    - last atom is a text atom
 *    - no two adjacent chip atoms (text gaps in between)
 *
 *  `serialise` correctly drops empty text contributions, so the raw
 *  string round-trip is preserved.
 */
function padAtoms(list: Atom[]): Atom[] {
  if (list.length === 0) return [{ kind: "text", text: "" }];
  const out: Atom[] = [];
  if (list[0].kind !== "text") out.push({ kind: "text", text: "" });
  for (let i = 0; i < list.length; i++) {
    out.push(list[i]);
    const next = list[i + 1];
    const cur = list[i];
    if (cur.kind !== "text" && (!next || next.kind !== "text")) {
      out.push({ kind: "text", text: "" });
    }
  }
  return out;
}

const atoms = ref<Atom[]>(padAtoms(parse(props.modelValue || "")));
let lastEmittedValue = props.modelValue || "";

watch(() => props.modelValue, (next) => {
  if (next === lastEmittedValue) return;  // echo of our own emit — ignore
  atoms.value = padAtoms(parse(next || ""));
});

/** Emit `update:modelValue` and remember the value so the watcher
 *  above doesn't trip the echo. */
function emitValue(v: string): void {
  lastEmittedValue = v;
  emit("update:modelValue", v);
}

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

// --- Autocomplete probe driven by the contenteditable host's Selection ---
//
// Reads the live caret position out of the DOM, finds the `wp-rt__text`
// span the caret is in (autocomplete only fires inside text — typing
// inside a chip is impossible, the chip is `contenteditable=false`),
// slices that span's text up to the caret, and probes for a `$` / `@`
// trigger backwards through identifier characters. The slice-up-to-
// caret is necessary because typing `@x foo @b<caret> ar` should
// suggest matches for `b`, not for the earlier `@x`.
function refreshAutocompleteFromHost(): void {
  const host = hostEl.value;
  if (!host) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    acOpen.value = false;
    return;
  }
  const range = sel.getRangeAt(0);
  if (!host.contains(range.startContainer)) {
    acOpen.value = false;
    return;
  }
  // The caret only meaningfully sits inside a text node (chip bodies
  // are contenteditable=false so the browser bounces off them). Find
  // the text node + offset.
  let textNode: Node | null = null;
  let offset = 0;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    textNode = range.startContainer;
    offset = range.startOffset;
  } else {
    // Range may be anchored on the host or a wp-rt__text span. Walk
    // forward into text nodes when needed.
    const child = range.startContainer.childNodes[range.startOffset];
    if (child && child.nodeType === Node.TEXT_NODE) {
      textNode = child;
      offset = 0;
    }
  }
  if (!textNode) {
    acOpen.value = false;
    return;
  }
  const fullText = textNode.textContent ?? "";
  const upToCaret = fullText.slice(0, offset);
  const hit = probeAutocomplete(upToCaret, upToCaret.length);
  if (!hit) {
    acOpen.value = false;
    return;
  }
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

/** Place caret at a character offset within the host's rendered text.
 *  Walks atoms accumulating text-atom lengths; for chips, the offset
 *  ticks past the chip body as one unit (matches user expectation:
 *  the chip is one cursor stop, not its serialised length). */
function restoreCursorAtChar(targetChar: number): void {
  const host = hostEl.value;
  if (!host) return;
  // Walk meaningful children + match char offset
  const meaningful: { el: Node; len: number; kind: "text" | "chip" }[] = [];
  for (const child of host.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent ?? "";
      if (t.length > 0) meaningful.push({ el: child, len: t.length, kind: "text" });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.classList.contains("wp-rt__text")) {
        meaningful.push({ el, len: (el.textContent ?? "").length, kind: "text" });
      } else if (el.classList.contains("wp-refchip")) {
        // Chip = atomic cursor stop, counts as 1 char visually but in
        // the raw text view the chip serialises to `@{uuid:sub}` (much
        // longer). We track length as the SERIALISED length so caller
        // can pass `targetChar` from raw-string space.
        const idx = Number(el.getAttribute("data-atom-index"));
        const atom = atoms.value[idx];
        if (atom && atom.kind !== "text") {
          meaningful.push({ el, len: serialise([atom]).length, kind: "chip" });
        }
      }
    }
  }
  let acc = 0;
  const range = document.createRange();
  for (const m of meaningful) {
    if (acc + m.len >= targetChar) {
      if (m.kind === "text") {
        const el = m.el as HTMLElement | Text;
        const textNode = el.nodeType === Node.TEXT_NODE
          ? (el as Text)
          : ((el as HTMLElement).firstChild as Text | null);
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          range.setStart(textNode, Math.min(targetChar - acc, (textNode.textContent ?? "").length));
        } else {
          range.setStart(m.el, 0);
        }
      } else {
        range.setStartAfter(m.el);
      }
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      host.focus();
      return;
    }
    acc += m.len;
  }
  // Past end — land at end of host.
  const last = meaningful[meaningful.length - 1];
  if (last) {
    if (last.kind === "text") {
      const el = last.el as HTMLElement | Text;
      const textNode = el.nodeType === Node.TEXT_NODE
        ? (el as Text)
        : ((el as HTMLElement).firstChild as Text | null);
      if (textNode) range.setStart(textNode, (textNode.textContent ?? "").length);
      else range.setStartAfter(last.el);
    } else {
      range.setStartAfter(last.el);
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  host.focus();
}

/** Caret offset (in serialised raw text) where the cursor currently
 *  sits. Walks meaningful host children accumulating their serialised
 *  lengths; for a wp-rt__text span containing the cursor, adds the
 *  intra-span offset; for cursor sitting adjacent to a chip, includes
 *  the chip's full serialised length on the appropriate side. */
function currentCursorCharOffset(): number {
  const host = hostEl.value;
  if (!host) return 0;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return readHostAsText().length;
  const range = sel.getRangeAt(0);
  if (!host.contains(range.startContainer)) return readHostAsText().length;
  let acc = 0;
  for (const child of host.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent ?? "";
      if (child === range.startContainer) {
        return acc + range.startOffset;
      }
      acc += t.length;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    if (el.classList.contains("wp-refchip")) {
      // Range may be anchored ON the host with offset === child index;
      // that case is handled below. Range can't realistically land
      // inside a chip (contenteditable=false).
      const idx = Number(el.getAttribute("data-atom-index"));
      const atom = atoms.value[idx];
      if (atom && atom.kind !== "text") acc += serialise([atom]).length;
      continue;
    }
    if (el.classList.contains("wp-rt__text")) {
      const tn = el.firstChild;
      if (tn === range.startContainer) {
        return acc + range.startOffset;
      }
      if (el === range.startContainer) {
        // Range anchored on the span itself — offset is child-index
        return acc + (range.startOffset === 0 ? 0 : (el.textContent ?? "").length);
      }
      acc += (el.textContent ?? "").length;
      continue;
    }
  }
  return acc;
}

function insertChipAtCaret(chipText: string): void {
  // Operate in raw-text space — much simpler than atom-cursor surgery.
  const text = readHostAsText();
  const caret = currentCursorCharOffset();
  // Strip the typed trigger fragment (`@col`, `$per`) before inserting
  // the chip. `acStart` holds the raw-text offset of the trigger `@` /
  // `$`; the slice [acStart, caret] is the trigger + typed query text.
  const cutFrom = acStart.value >= 0 ? Math.min(acStart.value, caret) : caret;
  const before = text.slice(0, cutFrom);
  const after = text.slice(caret);
  const newText = before + chipText + after;
  atoms.value = padAtoms(parse(newText));
  emitValue(newText);
  const newCaret = (before + chipText).length;
  void nextTick(() => restoreCursorAtChar(newCaret));
}

function insertRefAtCursor(uuid: string, subCategories: string[]): void {
  const chipText = subCategories.length > 0
    ? "@{" + uuid + ":" + subCategories.join(",") + "}"
    : "@{" + uuid + "}";
  insertChipAtCaret(chipText);
}

function insertVarAtCursor(name: string): void {
  insertChipAtCaret("$" + name);
}

/** Re-place the DOM Selection after a programmatic atom-list update.
 *  Walks the same `meaningful` filter as `currentCursor` (skipping Vue
 *  fragment markers) and lands the caret either inside a wp-rt__text
 *  span (cursor offset inside text) or at a chip boundary (cursor at
 *  atom edge). Called from a `nextTick` after `atoms.value` reassign
 *  so Vue has finished its DOM patches before we touch the selection. */
function restoreCursor(cur: Cursor): void {
  const host = hostEl.value;
  if (!host) return;
  const meaningful: Node[] = [];
  for (const child of host.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent ?? "").length > 0) meaningful.push(child);
    } else {
      meaningful.push(child);
    }
  }
  const range = document.createRange();
  const target = meaningful[cur.atomIndex];
  if (!target) {
    // Past the end — land at end of host.
    const last = meaningful[meaningful.length - 1];
    if (last && last.nodeType === Node.TEXT_NODE) {
      range.setStart(last, (last.textContent ?? "").length);
    } else if (last) {
      range.setStartAfter(last);
    } else {
      range.setStart(host, 0);
    }
  } else if (target.nodeType === Node.TEXT_NODE) {
    range.setStart(target, Math.min(cur.offset, (target.textContent ?? "").length));
  } else {
    const el = target as HTMLElement;
    if (el.classList.contains("wp-rt__text")) {
      const tn = el.firstChild;
      if (tn && tn.nodeType === Node.TEXT_NODE) {
        range.setStart(tn, Math.min(cur.offset, (tn.textContent ?? "").length));
      } else {
        range.setStart(el, 0);
      }
    } else {
      // Chip — place caret BEFORE the chip element.
      range.setStartBefore(target);
    }
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  host.focus();
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
      atoms.value = padAtoms(next);
      emitValue(serialise(atoms.value));
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
    atoms.value = padAtoms(next);
    emitValue(serialise(atoms.value));
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
  // Browsers sometimes insert orphan text nodes directly as host
  // children (between Vue's wp-rt__text spans) when typing at the host
  // root, e.g. when the user clicks into an empty input. Vacuum those
  // back into the nearest wp-rt__text span so Vue's render tree stays
  // consistent with what's actually visible.
  reconcileOrphanTextNodes();
  const next = readHostAsText();
  if (next !== props.modelValue) emitValue(next);
  // After every input we re-probe the caret for autocomplete trigger
  // — covers the user typing `@` mid-text, deleting back across a
  // trigger, etc. Cheap (single text-slice + regex).
  refreshAutocompleteFromHost();
}

/** Move any direct text-node children of the host into the nearest
 *  preceding (or following) wp-rt__text span. The browser can drop
 *  user-typed text directly into the host's child list when the caret
 *  lands at a position outside any wp-rt__text span (e.g. focus on
 *  empty input, click between two chips). Without this fix, the
 *  orphan text bypasses Vue's v-for tracking and subsequent atom
 *  reassigns can't reconcile against it. */
function reconcileOrphanTextNodes(): void {
  const host = hostEl.value;
  if (!host) return;
  const orphans: Text[] = [];
  for (const child of host.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").length > 0) {
      orphans.push(child as Text);
    }
  }
  if (orphans.length === 0) return;
  // Track caret position so we can restore it after the DOM mutation.
  const sel = window.getSelection();
  let caretRel: { node: Node; offset: number } | null = null;
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    caretRel = { node: r.startContainer, offset: r.startOffset };
  }
  for (const orphan of orphans) {
    const text = orphan.textContent ?? "";
    if (!text) continue;
    let target: HTMLElement | null = null;
    let appendMode = true;
    let prev = orphan.previousSibling;
    while (prev) {
      if (
        prev.nodeType === Node.ELEMENT_NODE &&
        (prev as HTMLElement).classList.contains("wp-rt__text")
      ) {
        target = prev as HTMLElement;
        break;
      }
      prev = prev.previousSibling;
    }
    if (!target) {
      let next = orphan.nextSibling;
      while (next) {
        if (
          next.nodeType === Node.ELEMENT_NODE &&
          (next as HTMLElement).classList.contains("wp-rt__text")
        ) {
          target = next as HTMLElement;
          appendMode = false;
          break;
        }
        next = next.nextSibling;
      }
    }
    if (!target) continue;
    const before = target.textContent ?? "";
    target.textContent = appendMode ? before + text : text + before;
    // If the caret was in this orphan, redirect into the target span.
    if (caretRel && caretRel.node === orphan) {
      const tn = target.firstChild;
      if (tn && tn.nodeType === Node.TEXT_NODE) {
        const newOff = appendMode ? before.length + caretRel.offset : caretRel.offset;
        caretRel = { node: tn, offset: newOff };
      }
    }
    host.removeChild(orphan);
  }
  if (caretRel) {
    const range = document.createRange();
    try {
      range.setStart(caretRel.node, Math.min(caretRel.offset, (caretRel.node.textContent ?? "").length));
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    } catch {
      // Caret restoration is best-effort; if the saved node is gone
      // (e.g. the orphan we just removed and the restoration logic
      // didn't catch it), let the browser figure it out.
    }
  }
}

/** Intercept `beforeinput` events so we can capture user typing that
 *  the browser is ABOUT to land outside a wp-rt__text span. If the
 *  current selection isn't inside a span, redirect into one before the
 *  text gets inserted. */
function onHostBeforeInput(ev: InputEvent): void {
  if (props.disabled) return;
  if (ev.inputType !== "insertText" && ev.inputType !== "insertCompositionText") return;
  const host = hostEl.value;
  if (!host) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const target = range.startContainer;
  // If selection is already inside a wp-rt__text span (or its text
  // node), nothing to do — browser will insert correctly.
  if (target.nodeType === Node.TEXT_NODE) {
    const parent = (target as Text).parentElement;
    if (parent && parent.classList.contains("wp-rt__text")) return;
  } else if (target.nodeType === Node.ELEMENT_NODE) {
    const el = target as HTMLElement;
    if (el.classList.contains("wp-rt__text")) return;
  }
  // Otherwise, find a wp-rt__text span to redirect into. Prefer the
  // last span before the current selection; fall back to the first
  // span overall.
  const spans = host.querySelectorAll(".wp-rt__text");
  if (spans.length === 0) return;
  // Use the last span (typical "type at end" scenario).
  const span = spans[spans.length - 1] as HTMLElement;
  const newRange = document.createRange();
  const tn = span.firstChild;
  if (tn && tn.nodeType === Node.TEXT_NODE) {
    newRange.setStart(tn, (tn.textContent ?? "").length);
  } else {
    newRange.setStart(span, 0);
  }
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  // Don't preventDefault — browser will now insert at the new selection.
}

function onHostFocus(): void {
  focused.value = true;
  // If the host gets focused but the caret didn't naturally land
  // inside a wp-rt__text span (e.g. first focus on an empty input),
  // place it inside the rightmost span so typing lands somewhere
  // Vue can render against.
  void nextTick(() => {
    const host = hostEl.value;
    if (!host) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const sc = range.startContainer;
    if (sc.nodeType === Node.TEXT_NODE) {
      const parent = (sc as Text).parentElement;
      if (parent && parent.classList.contains("wp-rt__text")) return;
    } else if (sc.nodeType === Node.ELEMENT_NODE) {
      const el = sc as HTMLElement;
      if (el.classList.contains("wp-rt__text")) return;
    }
    const spans = host.querySelectorAll(".wp-rt__text");
    if (spans.length === 0) return;
    const span = spans[spans.length - 1] as HTMLElement;
    const r = document.createRange();
    const tn = span.firstChild;
    if (tn && tn.nodeType === Node.TEXT_NODE) {
      r.setStart(tn, (tn.textContent ?? "").length);
    } else {
      r.setStart(span, 0);
    }
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  });
}

// --- Atomic-chip keyboard handling ---
// Override keydown for Backspace and Arrow keys at chip boundaries so the
// browser doesn't (a) eat half a chip by collapsing into its display text
// (chips are `contenteditable=false` containers but the native caret can
// land at chip-offset 0 on Firefox), or (b) leave the caret stranded
// mid-chip after an arrow keystroke. All other keystrokes fall through to
// the native handler.
function onHostKeydown(ev: KeyboardEvent): void {
  if (props.disabled) return;
  // Enter inside a single-line input commits / closes autocomplete
  // rather than inserting a newline. Multi-line surfaces fall through.
  if (ev.key === "Enter" && acOpen.value && acItems.value.length > 0) {
    ev.preventDefault();
    applyAutocomplete(acItems.value[acActive.value]);
    return;
  }
  if (ev.key === "ArrowDown" && acOpen.value) {
    ev.preventDefault();
    acActive.value = Math.min(acItems.value.length - 1, acActive.value + 1);
    return;
  }
  if (ev.key === "ArrowUp" && acOpen.value) {
    ev.preventDefault();
    acActive.value = Math.max(0, acActive.value - 1);
    return;
  }
  if (ev.key === "Escape" && acOpen.value) {
    ev.preventDefault();
    acOpen.value = false;
    return;
  }
  if (ev.key === "Backspace") {
    // Sync atoms from live DOM before surgery — user may have typed
    // into text spans since the last reactive sync. Without this we'd
    // operate on stale atoms.value and lose trailing edits.
    const liveText = readHostAsText();
    const live = padAtoms(parse(liveText));
    const cur = currentCursor();
    // Only intercept when the cursor sits at an atom boundary where the
    // PREVIOUS atom is a chip (ref/var). Otherwise let the browser
    // handle the keystroke natively (cheaper + matches platform feel).
    if (cur.offset === 0 && cur.atomIndex > 0) {
      const prev = live[cur.atomIndex - 1];
      if (prev && (prev.kind === "ref" || prev.kind === "var")) {
        ev.preventDefault();
        const result = deleteBackward(live, cur);
        atoms.value = padAtoms(result.atoms);
        emitValue(serialise(atoms.value));
        void nextTick(() => restoreCursor(result.cursor));
      }
    }
    return;
  }
  if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    const cur = currentCursor();
    if (ev.key === "ArrowLeft" && cur.offset === 0 && cur.atomIndex > 0) {
      const prev = atoms.value[cur.atomIndex - 1];
      if (prev && prev.kind !== "text") {
        ev.preventDefault();
        moveCursorToAtomEnd(cur.atomIndex - 2);  // skip over the chip
      }
    } else if (ev.key === "ArrowRight") {
      const target = atoms.value[cur.atomIndex];
      if (
        target?.kind === "text" &&
        cur.offset === target.text.length &&
        cur.atomIndex + 1 < atoms.value.length &&
        atoms.value[cur.atomIndex + 1].kind !== "text"
      ) {
        ev.preventDefault();
        moveCursorToAtomEnd(cur.atomIndex + 1);
      }
    }
  }
}

function moveCursorToAtomEnd(atomIndex: number): void {
  // Set DOM selection to land just AFTER the atom at `atomIndex`.
  const host = hostEl.value;
  if (!host) return;
  const child = host.childNodes[atomIndex];
  if (!child) return;
  const range = document.createRange();
  if (child.nodeType === Node.TEXT_NODE) {
    range.setStart(child, (child.textContent ?? "").length);
  } else {
    range.setStartAfter(child);
  }
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
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
      @focus="onHostFocus"
      @blur="focused = false"
      @input="onHostInput"
      @keydown="onHostKeydown"
      @beforeinput="onHostBeforeInput"
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
