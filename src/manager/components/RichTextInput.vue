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
  parse,
  replaceAtom,
  type Atom,
  type RefAtom,
  type TextAtom,
} from "./atomicEditorModel";
import { escapeHtml, inlineTokenHtml, splitRefFilter } from "../../widgets/richTokenize";
import RefChip from "./RefChip.vue";
import SubcategoryFilterPicker from "./SubcategoryFilterPicker.vue";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import type { SurfaceKind, ResolveWarning } from "../utils/resolveTokens";
import { probeAutocomplete } from "../utils/autocompleteProbe";

// --- 4-segment nested-ref serialization (SP1, §3.2) -----------------------
//
// The canonical ref form is `@{uuid[#name][:expr][!null]}` — a boolean
// sub-category EXPRESSION after `:` (not a comma list) plus a trailing
// `!null` exclude-null marker. The shared `atomicEditorModel` /
// `richTokenize` layer still models a ref's `:`-segment as the legacy
// `subCategories: string[]` (comma-split). Rather than fork that shared
// layer, RichTextInput owns the 4-segment view locally:
//
//   - The atom STREAM (text/var/ref boundaries) still comes from
//     `atomicEditorModel.parse` — the legacy regex's `:` group is
//     `[^}]*`, so it still captures the full `expr!null` body and the
//     token boundary (`}`) stays correct. Only the INTERPRETATION of
//     that body changed.
//   - `refFilterOf` reconstructs the raw `:`-body from `subCategories`
//     (join on `,` is loss-free for the comma-OR shorthand) and peels a
//     trailing `!null` into the `excludeNull` flag, yielding `{expr,
//     excludeNull}`. A freshly-applied filter stashes those on the atom
//     directly (extra fields survive `replaceAtom`'s shallow clone), so
//     the live edit round-trips without going through the lossy
//     comma-split.
//   - `serialiseAtomsLocal` emits the 4-segment form, omitting each
//     segment when empty. It replaces `atomicEditorModel.serialise`
//     everywhere RichTextInput needs raw text (emit value + caret-length
//     math) so `!null` + multi-word expressions survive round-trips.

/** A ref's filter, lifted out of the legacy `subCategories` list. */
interface RefFilter {
  /** Boolean sub-category expression (the `:` segment). Empty = none. */
  expr: string;
  /** Exclude-null flag (the trailing `!null` segment). */
  excludeNull: boolean;
}

/** Ref atom augmented with the 4-segment filter view. The extra fields
 *  are optional so a plain `RefAtom` (e.g. fresh from `atomicEditorModel
 *  .parse`) is assignable; `refFilterOf` falls back to reconstructing
 *  them from `subCategories` when absent. */
type RefAtomX = RefAtom & Partial<RefFilter>;

/** Peel a trailing `!null` marker off a raw `:`-segment body, returning
 *  the pure expression + the exclude-null flag. `@{uuid:warm!null}` →
 *  `{ expr: "warm", excludeNull: true }`. The `!null` must be the whole
 *  trailing segment (the name/expr captures exclude `!`, so a `!` can
 *  only introduce the null marker). */
function splitColonBody(body: string): RefFilter {
  // Delegate to the single-source peel in richTokenize so the editor,
  // RefChip, and the canvas OptionRow can never drift on `!null` handling.
  return splitRefFilter(body);
}

/** The 4-segment filter for a ref atom. Prefers explicit `expr` /
 *  `excludeNull` (set by a live picker apply); otherwise reconstructs
 *  from the legacy `subCategories` body. */
function refFilterOf(atom: RefAtomX): RefFilter {
  if (atom.expr !== undefined || atom.excludeNull !== undefined) {
    return { expr: atom.expr ?? "", excludeNull: atom.excludeNull ?? false };
  }
  if (atom.subCategories.length === 0) return { expr: "", excludeNull: false };
  return splitColonBody(atom.subCategories.join(","));
}

/** Serialize one ref atom to the canonical `@{uuid[#name][:expr][!null]}`
 *  form, omitting each absent segment. */
function serialiseRefAtom(atom: RefAtomX): string {
  let out = "@{" + atom.uuid;
  if (atom.name && atom.name.length > 0) out += "#" + atom.name;
  const { expr, excludeNull } = refFilterOf(atom);
  if (expr.length > 0) out += ":" + expr;
  if (excludeNull) out += "!null";
  out += "}";
  return out;
}

/** Local replacement for `atomicEditorModel.serialise` that emits the
 *  4-segment ref form. Text / var atoms serialize identically. */
function serialiseAtomsLocal(atoms: Atom[]): string {
  let out = "";
  for (const a of atoms) {
    if (a.kind === "text") out += a.text;
    else if (a.kind === "var") out += "$" + a.name + (a.index != null ? "." + a.index : "");
    else out += serialiseRefAtom(a);
  }
  return out;
}

/** Template-safe filter accessor: returns the `{expr, excludeNull}` for
 *  a ref atom, or empty defaults for any other atom kind. Lets the
 *  RefChip binding stay terse without narrowing the union inline. */
function chipFilterOf(atom: Atom): RefFilter {
  return atom.kind === "ref"
    ? refFilterOf(atom)
    : { expr: "", excludeNull: false };
}

interface Props {
  modelValue: string;
  surface?: SurfaceKind;
  warnings?: ResolveWarning[];
  /** When set, the editor merges `warnings` with any entries in the
   *  shared `useResolveWarnings` store filtered by `module_id === moduleId`.
   *  Lets post-commit broken-ref discovery surface inline without the
   *  owning view needing to thread the prop through every editor. */
  moduleId?: string;
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
  /** Map from wildcard UUID → whether that wildcard has a null option.
   *  Drives the "Include null" checkbox in the sub-cat picker — the
   *  reserved keyword `"null"` in the filter list opts the null
   *  option into the resolved pool (engine recognises this). */
  uuidToHasNull?: Map<string, boolean>;
  /** Map from wildcard UUID → option count. Optional — when provided
   *  the `@`-trigger autocomplete row surfaces the count alongside
   *  the uuid so two same-named wildcards (e.g. duplicates from import)
   *  can be told apart at-a-glance. */
  uuidToOptionsCount?: Map<string, number>;
  /** Map from wildcard UUID → each option's sub-category tag set. Feeds
   *  the boolean-filter picker's live "N of M options match" count so
   *  the user sees how many options the typed expression keeps. */
  uuidToOptionTagSets?: Map<string, string[][]>;
  /** Map from wildcard UUID → its `tag_groups` axes (axis → member
   *  tags). Feeds the picker's grouped insert palette. */
  uuidToTagGroups?: Map<string, Record<string, string[]>>;
  ariaLabel?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  // Default = "combine" (permissive template surface allowing $vars,
  // disallowing nested @{uuid} refs). Wildcard option editor MUST
  // pass surface="wildcard" explicitly — that surface BLOCKS $vars
  // (wildcards don't expand $name substitution at runtime) and
  // ALLOWS @{uuid} nested wildcard refs. Other template surfaces
  // (combine, derivation, assembler) share the same default semantics.
  surface: "combine",
  warnings: () => [],
  moduleId: undefined,
  multiline: false,
  rows: 4,
  placeholder: "",
  varSuggestions: () => [],
  refSuggestions: () => [],
  uuidToName: () => new Map(),
  uuidToSubCategories: () => new Map(),
  uuidToHasNull: () => new Map(),
  uuidToOptionsCount: () => new Map(),
  uuidToOptionTagSets: () => new Map(),
  uuidToTagGroups: () => new Map(),
  ariaLabel: undefined,
  disabled: false,
});

// Lazy-pull store on first prop access — singleton so doesn't matter
// when we instantiate. `effectiveWarnings` merges prop + store-filtered.
const { forModule: forModuleWarnings } = useResolveWarnings();
const storeWarnings = computed<ResolveWarning[]>(() =>
  props.moduleId ? forModuleWarnings(props.moduleId).value : [],
);
const effectiveWarnings = computed<ResolveWarning[]>(() => [
  ...props.warnings,
  ...storeWarnings.value,
]);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

// --- Refs ---
const hostEl = ref<HTMLDivElement | null>(null);
const popoverEl = ref<HTMLDivElement | null>(null);
const focused = ref(false);

// Zero-width space rendered inside empty pad spans. Browsers can't reliably
// land the caret inside a span that has no child text node (the kind Vue
// emits for `{{ '' }}`) — clicking "after the last chip" then drops the
// caret BEFORE the chip and subsequent typing inserts on the wrong side.
// A single ZWSP gives the span a text node the caret can sit in, while
// staying visually invisible. The read-side paths strip it back out so it
// never reaches modelValue.
const ZWSP = "​";
const ZWSP_RE = /​/g;

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
// 4-segment filter seed for the boolean-expression picker (§4.1):
// initial expression text + exclude-null flag, replacing the legacy
// flat sub-category selection.
const pickerInitialExpr = ref<string>("");
const pickerInitialExcludeNull = ref<boolean>(false);
// Per-option tag sets (match-count denominator) + tag-group axes
// (grouped insert palette) for the picked wildcard.
const pickerOptionTagSets = ref<string[][]>([]);
const pickerTagGroups = ref<Record<string, string[]>>({});
const pickerHasNull = ref<boolean>(false);
const pickerMode = ref<"insert" | "edit">("insert");
// The atom-index this picker is editing — null when inserting fresh.
const pickerTargetAtomIndex = ref<number | null>(null);
// During insert flow we stash the uuid + the insertion cursor so the
// apply/skip handlers can build the right atom + put it in the right
// place after the picker closes.
const pendingInsert = ref<{ uuid: string } | null>(null);
/** Caret + autocomplete-trigger offsets captured when the picker
 *  opens. The picker steals focus from the contenteditable host, so by
 *  the time the user clicks Apply / Skip, `currentCursorCharOffset()`
 *  reads 0 and the chip lands at the start of the value. Capturing
 *  here lets us restore the right slice positions in `insertRefAtCursor`. */
const pendingInsertCaret = ref<{ caret: number; acStart: number } | null>(null);
// Anchor coordinates for the picker popover — relative to the chip
// being edited (click-to-edit flow) or the host element (insert
// flow). Flips above the anchor if there's no room below.
const pickerAnchor = ref<{ top: number; left: number; flipped: boolean }>({
  top: 0, left: 0, flipped: false,
});

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

/** Parse with surface-aware atom filtering.
 *
 *  Which atom kinds collapse back to literal text varies by surface:
 *
 *    - "wildcard"     → vars collapse (`$name` literal, refs chipify)
 *    - "fixed_values" → both collapse (vars + refs literal; only inline
 *      syntax like `{a|b}` colors)
 *    - other surfaces → refs collapse (`@{uuid}` literal, vars chipify)
 *
 *  Adjacent text atoms produced by the collapse are merged so the
 *  padAtoms invariant ("no adjacent text atoms") still holds. */
/** Lift a freshly-parsed ref atom into the 4-segment view (§3.2).
 *
 *  The shared tokenizer (`richTokenize`) still models the ref body as
 *  the legacy `subCategories` list and its name capture does not exclude
 *  `!`. So for the exclude-null-only form `@{uuid#name!null}` the `!null`
 *  leaks into `name` (no `:` to stop the name group), and for the
 *  `:expr!null` form the marker lands at the tail of the (comma-joined)
 *  body. Both are reconciled here: peel a trailing `!…` off whichever
 *  segment carries it, yielding a clean `name` + explicit `{expr,
 *  excludeNull}`. Storing the explicit fields means later `refFilterOf`
 *  reads them directly rather than re-deriving from the lossy body. */
function chipRefAtom(atom: RefAtom): RefAtomX {
  let name = atom.name;
  // Body the legacy parser captured for the `:` segment (loss-free for
  // the comma-OR shorthand).
  const body = atom.subCategories.join(",");
  // Exclude-null marker leaked into the name (no `:expr` present).
  if (body.length === 0 && name && name.includes("!")) {
    const bang = name.indexOf("!");
    const tail = name.slice(bang + 1);
    name = name.slice(0, bang);
    const cleaned: RefAtomX = {
      kind: "ref",
      uuid: atom.uuid,
      subCategories: [],
      expr: "",
      excludeNull: tail === "null",
    };
    if (name.length > 0) cleaned.name = name;
    return cleaned;
  }
  const { expr, excludeNull } = splitColonBody(body);
  const cleaned: RefAtomX = {
    kind: "ref",
    uuid: atom.uuid,
    subCategories: [],
    expr,
    excludeNull,
  };
  if (name && name.length > 0) cleaned.name = name;
  return cleaned;
}

function parseForSurface(text: string): Atom[] {
  const atoms = parse(text);
  const collapseSet: Set<"var" | "ref"> =
    props.surface === "wildcard"
      ? new Set(["var"])
      : props.surface === "fixed_values"
        ? new Set(["var", "ref"])
        : new Set(["ref"]);
  const out: Atom[] = [];
  for (const a of atoms) {
    if ((a.kind === "var" || a.kind === "ref") && collapseSet.has(a.kind)) {
      // Re-serialise back to raw text and merge into adjacent text.
      // Refs use the 4-segment form so a collapsed-surface round-trip
      // keeps `:expr` + `!null` intact (legacy comma body reconstructs
      // loss-free via `refFilterOf`).
      const raw = a.kind === "var" ? "$" + a.name : serialiseRefAtom(a);
      const last = out[out.length - 1];
      if (last && last.kind === "text") {
        // A collapsed arm folds into its surrounding run and inherits that
        // run's blockColor (SP2b: a brace-block arm stays block-coloured even
        // when the surface renders it as literal scaffolding text).
        out[out.length - 1] = last.blockColor
          ? { kind: "text", text: last.text + raw, blockColor: last.blockColor }
          : { kind: "text", text: last.text + raw };
      } else {
        out.push({ kind: "text", text: raw });
      }
      continue;
    }
    // Chipified ref → lift into the 4-segment `{expr, excludeNull}` view
    // so the filter survives the next round-trip without re-deriving
    // from the lossy legacy body.
    if (a.kind === "ref") {
      out.push(chipRefAtom(a));
      continue;
    }
    const last = out[out.length - 1];
    // Only merge text atoms that share a blockColor — fusing a block's
    // scaffolding ("multi"/"alt") with adjacent plain text (undefined) would
    // bleed the block colour onto prose between two blocks (`{a|b} x {c|d}`).
    if (a.kind === "text" && last && last.kind === "text" && last.blockColor === a.blockColor) {
      out[out.length - 1] = a.blockColor
        ? { kind: "text", text: last.text + a.text, blockColor: a.blockColor }
        : { kind: "text", text: last.text + a.text };
    } else {
      out.push(a);
    }
  }
  return out;
}

const atoms = ref<Atom[]>(padAtoms(parseForSurface(props.modelValue || "")));
let lastEmittedValue = props.modelValue || "";

/** Text-atom HTML: tokenises the atom's raw text and emits colored
 *  sub-spans for inline syntax (brace blocks, multi-select, weights,
 *  escapes). Empty atoms render a single ZWSP so the caret has a landing
 *  position.
 *
 *  `$name` / `@{uuid}` are ALWAYS collapsed to plain text here (both kinds
 *  passed to `inlineTokenHtml`). Rationale (user feedback 2026-06-09): an
 *  UNSETTLED token — raw text mid-edit, not yet a chip — needs no separate
 *  colour. The absence of a chip already signals "not committed"; a violet
 *  `.wp-rt-var` / magenta `.wp-rt-ref` inline highlight only competes with
 *  the settled-chip palette (RefChip is the sole var/ref colour). This is
 *  surface-independent: on every surface, a chippable token that hasn't
 *  settled reads as plain text and a settled one reads as a chip.
 *
 *  Inline `{a|b}` brace / multi / weight / escape colouring is untouched —
 *  those aren't chippable tokens, so their highlight IS the only signal. */
function textAtomHtml(text: string): string {
  if (!text) return ZWSP;
  return inlineTokenHtml(text, ["var", "ref"]);
}

/** HTML for one text atom. SP2b brace-block scaffolding (the braces, count,
 *  `$$sep$$`, pipes, and literal arms a `{…}` block decomposes into) renders
 *  its raw text ESCAPED but NOT re-tokenised — re-running the tokenizer on a
 *  fragment like `{2$$, $$` would mis-read the `$$` sep delimiters as `$$`
 *  escapes. The amber/green colour comes from the `.wp-rt-block-scaf--*`
 *  wrapper class instead. Ordinary atoms keep the inline-token colouring
 *  (weights, escapes) via `textAtomHtml`. Keeping the fast-path escape also
 *  leaves the span's `firstChild` a text node, so caret math stays correct. */
function renderTextAtom(atom: TextAtom): string {
  if (atom.blockColor) return atom.text ? escapeHtml(atom.text) : ZWSP;
  return textAtomHtml(atom.text);
}

watch(() => props.modelValue, (next) => {
  if (next === lastEmittedValue) return;  // echo of our own emit — ignore
  // External value swap from the parent — route through applyAtoms so
  // any stale user-typed text in a span (typed since the last echo)
  // gets force-synced to the new atom shape via the post-patch
  // imperative DOM-sync in `applyAtoms`. Same v-for diff pitfall as
  // programmatic edits.
  applyAtoms(parseForSurface(next || ""));
});

/** Emit `update:modelValue` and remember the value so the watcher
 *  above doesn't trip the echo. */
function emitValue(v: string): void {
  lastEmittedValue = v;
  emit("update:modelValue", v);
}

function atomIsResolved(atom: Atom): boolean {
  if (atom.kind === "var") {
    // Vars bind at runtime — a $name not in the static catalog may still
    // resolve via upstream context / derivation / runtime overrides. The
    // chip itself shouldn't gatekeep; conflict scanner emits a missing-var
    // advisory when a binding truly has no producer. Only the empty form
    // is unambiguously broken.
    return atom.name.length > 0;
  }
  if (atom.kind === "ref") {
    return props.uuidToName.has(atom.uuid);
  }
  return true;
}

/** Populate the picker's per-wildcard context (declared sub-cats, the
 *  grouped palette axes, the match-count option tag sets, and the
 *  null-option flag) from a target uuid. Shared by the insert + edit
 *  entry points so both surfaces see the same data. */
function loadPickerContext(uuid: string): void {
  pickerSubCats.value = props.uuidToSubCategories.get(uuid) ?? [];
  pickerOptionTagSets.value = props.uuidToOptionTagSets.get(uuid) ?? [];
  pickerTagGroups.value = props.uuidToTagGroups.get(uuid) ?? {};
  pickerHasNull.value = props.uuidToHasNull.get(uuid) ?? false;
}

function onChipClick(idx: number, ev?: MouseEvent): void {
  const atom = atoms.value[idx];
  if (!atom || atom.kind !== "ref") return;
  // Unresolved refs have no edit affordance — RefChip already gates the click
  // emit but be defensive in case a future caller routes here directly.
  if (!props.uuidToName.has(atom.uuid)) return;
  loadPickerContext(atom.uuid);
  const { expr, excludeNull } = refFilterOf(atom);
  pickerInitialExpr.value = expr;
  pickerInitialExcludeNull.value = excludeNull;
  pickerMode.value = "edit";
  pickerTargetAtomIndex.value = idx;
  pendingInsert.value = null;
  // Anchor picker beneath (or above) the clicked chip. Falls back to
  // the host's rect if the event target isn't a chip element.
  setPickerAnchorFromElement((ev?.currentTarget as HTMLElement | null) ?? null);
  pickerOpen.value = true;
  clampPickerIntoView();
}

// Rough first-paint bounds for the flip decision; the precise size (which
// grows with the target's palette) is measured in clampPickerIntoView(),
// which then re-anchors the popover snug against the trigger.
const PICKER_APPROX_H = 380;
const PICKER_W = 440;
// The trigger's rect (chip or host) captured at open, so the post-paint
// re-clamp can hug it using the popover's real height instead of the
// over-estimated APPROX_H (which floated it too far from the pill).
let pickerTriggerRect: { top: number; bottom: number; left: number } | null = null;

function setPickerAnchorFromElement(el: HTMLElement | null): void {
  const fallback = hostEl.value;
  const rect = (el ?? fallback)?.getBoundingClientRect();
  if (!rect) return;
  pickerTriggerRect = { top: rect.top, bottom: rect.bottom, left: rect.left };
  const spaceBelow = window.innerHeight - rect.bottom;
  const flipped = spaceBelow < PICKER_APPROX_H && rect.top > spaceBelow;
  // Clamp horizontally so the picker doesn't run off the right edge.
  const maxLeft = window.innerWidth - PICKER_W - 8;
  const left = Math.max(8, Math.min(rect.left, maxLeft));
  let top = flipped ? rect.top - PICKER_APPROX_H - 6 : rect.bottom + 6;
  // Keep both ends on-screen even before the exact measure lands.
  top = Math.max(8, Math.min(top, window.innerHeight - PICKER_APPROX_H - 8));
  pickerAnchor.value = { top, left, flipped };
}

/** Once the popover has painted, measure its real box and re-anchor it
 *  tight against the trigger (6px gap), then clamp into the viewport. The
 *  approximate constants can't know the exact height, so without this the
 *  flipped popover floats far above the pill / clips off a short viewport. */
function clampPickerIntoView(): void {
  void nextTick(() => {
    const el = document.querySelector(".wp-subcat-picker__anchor") as HTMLElement | null;
    if (!el || !pickerTriggerRect) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const t = pickerTriggerRect;
    // Sit just above (flipped) or just below the trigger using the REAL height.
    let top = pickerAnchor.value.flipped ? t.top - r.height - gap : t.bottom + gap;
    let left = pickerAnchor.value.left;
    if (r.height > 0) top = Math.max(8, Math.min(top, window.innerHeight - r.height - 8));
    if (r.width > 0) left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    pickerAnchor.value = { ...pickerAnchor.value, top, left };
  });
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

/** Right-side meta string for a `@` popover row — disambiguates rows
 *  with identical display names (e.g. two wildcards both named "test")
 *  by surfacing the option count and the uuid. Empty for `$` rows
 *  since var names are already unique. */
function suggestionMeta(token: string): string {
  if (acTrigger.value !== "@") return "";
  const count = props.uuidToOptionsCount.get(token);
  const countPart = typeof count === "number" ? `${count} opt${count === 1 ? "" : "s"}` : "";
  return countPart ? `${countPart} · ${token}` : token;
}

watch(acItems, (items) => {
  if (acActive.value >= items.length) acActive.value = 0;
});

// Autocomplete trigger probe lives in `../utils/autocompleteProbe` (pure +
// unit-tested). It scans back from the caret to the nearest `$` / `@` trigger
// and uses `$`-run parity to tell a real `$var` start from a `$$` escape /
// `$$sep$$` multi-pick delimiter.

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
  // Probe in raw-text space so `acStart` is comparable with the raw
  // offsets the insert path uses. The previous implementation read the
  // caret-local text node and reported an offset inside that node, but
  // `insertChipAtCaret` slices `readHostAsText()` (raw, includes
  // serialised chips). When chips exist before the trigger, local and
  // raw diverge and the slice nukes content between offset 0 and the
  // caret. Working in raw space throughout keeps both ends honest.
  const rawText = readHostAsText();
  const rawCaret = currentCursorCharOffset();
  const hit = probeAutocomplete(rawText, rawCaret);
  if (!hit) {
    acOpen.value = false;
    return;
  }
  // Gate `@` autocomplete — only available in the "wildcard" surface
  // (nested wildcard refs make sense only inside a wildcard option).
  if (hit.trigger === "@" && props.surface !== "wildcard") {
    acOpen.value = false;
    return;
  }
  // Gate `$` autocomplete — wildcards don't use $var substitution at
  // runtime; only template surfaces (combine, derivation, assembler)
  // do. Blocking the popover in wildcard surface stops the user from
  // typing `$name` into an option value and ending up with a chip
  // that has no engine meaning.
  if (hit.trigger === "$" && props.surface === "wildcard") {
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
    const hasNull = props.uuidToHasNull.get(label) ?? false;
    if (subCats.length === 0 && !hasNull) {
      // No sub-categories declared AND no null option — insert plain
      // ref immediately. (When the target has a null option we still
      // open the picker so the user can opt the null option in.)
      insertRefAtCursor(label, { expr: "", excludeNull: false });
    } else {
      // Open step-2 picker so the user can type a boolean filter
      // expression and/or toggle the exclude-null flag.
      //
      // Snapshot the caret + acStart BEFORE opening the picker. The
      // picker popover steals focus from the contenteditable host;
      // by the time apply/skip fires, `currentCursorCharOffset()`
      // reads 0 and the chip ends up at the start of the value with
      // the user's typed trigger left behind. We restore both in
      // `insertRefAtCursor` via `pendingInsertCaret`.
      pendingInsertCaret.value = {
        caret: currentCursorCharOffset(),
        acStart: acStart.value,
      };
      pendingInsert.value = { uuid: label };
      loadPickerContext(label);
      pickerInitialExpr.value = "";
      pickerInitialExcludeNull.value = false;
      pickerMode.value = "insert";
      pickerTargetAtomIndex.value = null;
      // Insert flow has no chip to anchor to yet — use the host's
      // rect so the picker appears under the input the user just
      // typed `@` into.
      setPickerAnchorFromElement(hostEl.value);
      pickerOpen.value = true;
      clampPickerIntoView();
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
  // Walk meaningful children + match char offset. Length accounting must
  // exclude ZWSPs so it matches the raw-text view (readHostAsText strips
  // them too).
  const visibleLen = (s: string): number => s.replace(ZWSP_RE, "").length;
  const meaningful: { el: Node; len: number; kind: "text" | "chip" }[] = [];
  for (const child of host.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent ?? "";
      const len = visibleLen(t);
      if (len > 0) meaningful.push({ el: child, len, kind: "text" });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.classList.contains("wp-rt__text")) {
        meaningful.push({ el, len: visibleLen(el.textContent ?? ""), kind: "text" });
      } else if (el.classList.contains("wp-refchip")) {
        // Chip = atomic cursor stop, counts as 1 char visually but in
        // the raw text view the chip serialises to `@{uuid:sub}` (much
        // longer). We track length as the SERIALISED length so caller
        // can pass `targetChar` from raw-string space.
        const idx = Number(el.getAttribute("data-atom-index"));
        const atom = atoms.value[idx];
        if (atom && atom.kind !== "text") {
          meaningful.push({ el, len: serialiseAtomsLocal([atom]).length, kind: "chip" });
        }
      }
    }
  }
  // Collect ALL text-node descendants of a wp-rt__text span in document
  // order. Used to land the caret inside colored sub-spans (e.g.
  // `<span class="wp-rt-dp-brace">{a|b|c}</span>`) without giving up
  // the existing single-firstChild fast path.
  const textDescendants = (root: Node): Text[] => {
    const out: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      out.push(node as Text);
      node = walker.nextNode();
    }
    return out;
  };
  const placeCaretInText = (
    range: Range,
    el: HTMLElement | Text,
    visibleOffset: number,
  ): void => {
    // Plain text-node child of host (orphan typed text) — single node.
    if (el.nodeType === Node.TEXT_NODE) {
      const raw = el.textContent ?? "";
      let pos = 0;
      let visible = 0;
      while (pos < raw.length && visible < visibleOffset) {
        if (raw[pos] !== "​") visible++;
        pos++;
      }
      while (pos < raw.length && raw[pos] === "​") pos++;
      range.setStart(el, pos);
      return;
    }
    // wp-rt__text element — descend into text-node descendants so the
    // caret lands inside whichever colored sub-span owns the offset.
    const nodes = textDescendants(el);
    if (nodes.length === 0) {
      range.setStart(el, 0);
      return;
    }
    let want = visibleOffset;
    for (const tn of nodes) {
      const raw = tn.textContent ?? "";
      let nodeVisible = 0;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== "​") nodeVisible++;
      }
      if (want <= nodeVisible) {
        let pos = 0;
        let visible = 0;
        while (pos < raw.length && visible < want) {
          if (raw[pos] !== "​") visible++;
          pos++;
        }
        while (pos < raw.length && raw[pos] === "​") pos++;
        range.setStart(tn, pos);
        return;
      }
      want -= nodeVisible;
    }
    // Past the last text node — land at end of last node.
    const last = nodes[nodes.length - 1];
    range.setStart(last, (last.textContent ?? "").length);
  };

  let acc = 0;
  const range = document.createRange();
  for (const m of meaningful) {
    if (acc + m.len >= targetChar) {
      if (m.kind === "text") {
        placeCaretInText(range, m.el as HTMLElement | Text, targetChar - acc);
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
      placeCaretInText(range, last.el as HTMLElement | Text, Number.POSITIVE_INFINITY);
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

/** Map a DOM (node, offset) pair to its position in the host's raw
 *  text (the same coordinate space `readHostAsText()` produces).
 *  Counts chars across host children, skipping ZWSPs in pad spans
 *  and adding full serialised chip length for non-text atoms. */
function rangeOffsetToRaw(targetNode: Node, targetOffset: number): number {
  const host = hostEl.value;
  if (!host || !host.contains(targetNode)) return readHostAsText().length;
  const charsBefore = (s: string, n: number): number =>
    s.slice(0, n).replace(ZWSP_RE, "").length;
  // Length contribution of a single host child to the raw-text space.
  const childRawLen = (child: ChildNode): number => {
    if (child.nodeType === Node.TEXT_NODE) {
      return (child.textContent ?? "").replace(ZWSP_RE, "").length;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return 0;
    const el = child as HTMLElement;
    if (el.classList.contains("wp-refchip")) {
      const idx = Number(el.getAttribute("data-atom-index"));
      const atom = atoms.value[idx];
      if (atom && atom.kind !== "text") return serialiseAtomsLocal([atom]).length;
      return 0;
    }
    if (el.classList.contains("wp-rt__text")) {
      return (el.textContent ?? "").replace(ZWSP_RE, "").length;
    }
    return 0;
  };
  // Special case: selection anchored ON the host itself (e.g. after
  // `range.selectNodeContents(host)` → startContainer=host,
  // startOffset=0, endContainer=host, endOffset=childCount). offset is
  // the CHILD INDEX, NOT a char offset. Sum raw lengths of children
  // up to that index. Without this, Ctrl+A-style selections collapsed
  // to total-length-for-both-endpoints, making paste-over-selection
  // append instead of replace.
  if (targetNode === host) {
    let acc = 0;
    const children = Array.from(host.childNodes);
    const stop = Math.min(targetOffset, children.length);
    for (let i = 0; i < stop; i++) acc += childRawLen(children[i]);
    return acc;
  }
  let acc = 0;
  for (const child of host.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent ?? "";
      if (child === targetNode) return acc + charsBefore(t, targetOffset);
      acc += childRawLen(child);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    if (el.classList.contains("wp-refchip")) {
      acc += childRawLen(child);
      continue;
    }
    if (el.classList.contains("wp-rt__text")) {
      // Anchor on the text span itself — `targetOffset` is the child index
      // among the span's children. Sum visible-length contributions of
      // every preceding child (which may be raw text nodes or colored
      // sub-spans for brace/escape tokens).
      if (el === targetNode) {
        let subAcc = 0;
        const children = Array.from(el.childNodes);
        const stop = Math.min(targetOffset, children.length);
        for (let i = 0; i < stop; i++) {
          subAcc += (children[i].textContent ?? "").replace(ZWSP_RE, "").length;
        }
        return acc + subAcc;
      }
      // Selection lands inside the span. Walk text-node descendants in
      // document order until we hit the target — handles caret inside a
      // colored sub-span (`<span class="wp-rt-dp-brace">{a|b|c}</span>`)
      // as well as the legacy single-firstChild text-node case.
      if (el.contains(targetNode)) {
        let subAcc = 0;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let tn: Node | null = walker.nextNode();
        while (tn) {
          if (tn === targetNode) {
            return acc + subAcc + charsBefore(tn.textContent ?? "", targetOffset);
          }
          subAcc += (tn.textContent ?? "").replace(ZWSP_RE, "").length;
          tn = walker.nextNode();
        }
        // Defensive — selection was inside the span but no matching text
        // descendant found. Treat as end of span.
        return acc + subAcc;
      }
      acc += childRawLen(child);
      continue;
    }
  }
  return acc;
}

/** Caret offset (in serialised raw text) where the cursor currently
 *  sits. Wraps `rangeOffsetToRaw` for the range start. */
function currentCursorCharOffset(): number {
  const host = hostEl.value;
  if (!host) return 0;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return readHostAsText().length;
  const range = sel.getRangeAt(0);
  if (!host.contains(range.startContainer)) return readHostAsText().length;
  return rangeOffsetToRaw(range.startContainer, range.startOffset);
}

/** Raw-text positions of the current selection's start AND end.
 *  For a collapsed caret, start === end. Non-collapsed selections
 *  (e.g. after Ctrl+A or shift-arrow) need both endpoints so the
 *  caller can replace the selected range — single-offset readers
 *  treat the selection as a caret and lose the selected content. */
function currentSelectionRangeRaw(): { start: number; end: number } {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    const len = readHostAsText().length;
    return { start: len, end: len };
  }
  const r = sel.getRangeAt(0);
  const start = rangeOffsetToRaw(r.startContainer, r.startOffset);
  const end = rangeOffsetToRaw(r.endContainer, r.endOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Imperative DOM-sync for text spans after a programmatic atom apply.
 *
 *  Why this exists: text-atom spans bind `{{ atom.text || ZWSP }}`.
 *  When the user types raw text into a span, the DOM `textContent`
 *  updates in place but `atom.text` stays at whatever it was (atoms
 *  are reactive source-of-truth, only updated via `emitValue` echo or
 *  programmatic ops — NOT live typing). On a subsequent programmatic
 *  atom reassign that keeps the same text-atom positions, Vue's
 *  `PatchFlags.TEXT` diff sees old vnode text === new vnode text and
 *  SKIPS the DOM patch — leaving user-typed characters stranded in
 *  the DOM but absent from `atoms.value`. Next `readHostAsText()` then
 *  sees BOTH the stranded raw text AND any freshly-inserted chip
 *  serialisation, returning corrupt text like `"$testo$testo"`. Each
 *  blur re-parses that → adds another chip in front of the still-
 *  stranded text. Compounds.
 *
 *  Earlier this was solved with a `renderTick` counter on the v-for
 *  key (`:key="${renderTick}-${idx}"`) — every programmatic apply
 *  bumped the tick → all keys changed → Vue tore down and re-created
 *  every atom node. Worked but heavy-handed: lost caret stability
 *  during legit programmatic ops, and the teardown-rebuild churn was
 *  itself a source of corruption when paired with native browser
 *  Backspace/Delete (DOM mutated mid-render-cycle → atoms model
 *  diverges from DOM).
 *
 *  Imperative sync: after `atoms.value = padAtoms(next)`, await Vue's
 *  patch via `nextTick`, then walk the live `.wp-rt__text` spans and
 *  force `textContent` for each to match its atom's `text || ZWSP`.
 *  Bypasses Vue's PatchFlags.TEXT diff entirely — no key churn, no
 *  full teardown, no DOM/atom drift. Spans keep stable identity for
 *  caret restore; text gets corrected in-place. */
function syncTextSpansToAtoms(): void {
  const host = hostEl.value;
  if (!host) return;
  const spans = host.querySelectorAll<HTMLElement>(".wp-rt__text");
  for (const span of spans) {
    const idx = Number(span.getAttribute("data-atom-index"));
    const atom = atoms.value[idx];
    if (atom && atom.kind === "text") {
      // Compare on textContent (visible plain string) — the inline
      // colour spans inside contribute the same characters, so when
      // user-typed text already matches `atom.text` we can skip the
      // innerHTML rewrite and preserve the live caret. When they
      // diverge, force the colored DOM tree to match.
      const wantText = atom.text || ZWSP;
      if (span.textContent !== wantText) {
        span.innerHTML = textAtomHtml(atom.text);
      }
    }
  }
}

function applyAtoms(next: Atom[]): void {
  atoms.value = padAtoms(next);
  void nextTick(() => syncTextSpansToAtoms());
}

/** Live structure-aware read of the host as an `Atom[]` — the deletion-path
 *  counterpart to `readHostAsText`. Walks the same `host.childNodes` but
 *  PRESERVES the chip/text structure instead of flattening to a string, and
 *  crucially does NOT tokenize:
 *
 *    - text spans become plain text atoms read from their LIVE `textContent`
 *      (which `atoms.value` does NOT track during raw typing — see
 *      `syncTextSpansToAtoms`), so a half-typed token like `$mood.` stays
 *      plain text;
 *    - chips are read from `atoms.value` via `data-atom-index` (chips only
 *      mutate through programmatic ops, so the atom is authoritative there).
 *
 *  The Backspace/Delete handlers feed this into `deleteRawRange` so editing
 *  never re-chipifies — chip formation stays on the commit paths only
 *  (settle-delimiter / blur / autocomplete). Adjacent text is merged to keep
 *  the list canonical. */
function readHostAsAtoms(): Atom[] {
  const host = hostEl.value;
  if (!host) return [{ kind: "text", text: "" }];
  const out: Atom[] = [];
  const pushText = (t: string): void => {
    if (t.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + t };
    } else {
      out.push({ kind: "text", text: t });
    }
  };
  for (const node of host.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText((node.textContent ?? "").replace(ZWSP_RE, ""));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    if (el.classList.contains("wp-refchip")) {
      const atom = atoms.value[Number(el.getAttribute("data-atom-index"))];
      if (atom && atom.kind !== "text") out.push(atom);
      else if (atom && atom.kind === "text") pushText(atom.text);
      continue;
    }
    // wp-rt__text spans + any defensive fallback: read live text.
    pushText((el.textContent ?? "").replace(ZWSP_RE, ""));
  }
  return out.length > 0 ? out : [{ kind: "text", text: "" }];
}

/** Delete the raw-text span `[delStart, delEnd)` directly off a live atom
 *  list — WITHOUT re-tokenizing. This is what keeps chip formation off the
 *  delete path: text atoms are sliced char-exact; a chip is one cursor stop,
 *  so any overlap removes the WHOLE chip (the span widens to chip
 *  boundaries). No `parse`/`parseForSurface` runs, so raw text that merely
 *  looks like a chip (`$mood`, `$mood.`) survives a Backspace as plain text.
 *
 *  Offsets are in the same serialised raw-text space `rangeOffsetToRaw`
 *  produces (chip length = `serialiseAtomsLocal([atom]).length`), so the
 *  caret arithmetic lines up. Returns the new atom list plus the caret
 *  offset to restore (the start of the deleted span, widened to a chip
 *  boundary when a chip was removed). */
function deleteRawRange(
  live: Atom[],
  delStart: number,
  delEnd: number,
): { atoms: Atom[]; caret: number } {
  const spans: { atom: Atom; start: number; end: number }[] = [];
  let cursor = 0;
  for (const atom of live) {
    const len = serialiseAtomsLocal([atom]).length;
    spans.push({ atom, start: cursor, end: cursor + len });
    cursor += len;
  }
  // Widen the deletion span to fully cover any chip it partially intersects —
  // chips can't be half-deleted.
  let lo = delStart;
  let hi = delEnd;
  for (const s of spans) {
    if (s.atom.kind === "text") continue;
    if (s.start < hi && s.end > lo) {
      lo = Math.min(lo, s.start);
      hi = Math.max(hi, s.end);
    }
  }
  const out: Atom[] = [];
  const pushAtom = (a: Atom): void => {
    const last = out[out.length - 1];
    if (a.kind === "text" && last && last.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + a.text };
    } else {
      out.push(a);
    }
  };
  for (const s of spans) {
    const atom = s.atom;
    if (s.end <= lo || s.start >= hi) {
      pushAtom(atom); // fully outside the deletion span — keep as-is
      continue;
    }
    if (atom.kind === "text") {
      const cutFrom = Math.max(0, lo - s.start);
      const cutTo = Math.min(atom.text.length, hi - s.start);
      const kept = atom.text.slice(0, cutFrom) + atom.text.slice(cutTo);
      if (kept.length > 0) pushAtom({ kind: "text", text: kept });
      continue;
    }
    // Chip fully covered by [lo, hi) (widened above) — drop it.
  }
  return { atoms: out, caret: lo };
}

function insertChipAtCaret(
  chipText: string,
  caretOverride?: { caret: number; acStart: number },
): void {
  // Operate in raw-text space — much simpler than atom-cursor surgery.
  const text = readHostAsText();
  // Prefer the override (used by the picker apply / skip flow where
  // the contenteditable lost focus to the popover). Falls back to the
  // live caret + acStart for the inline autocomplete path.
  const caret = caretOverride?.caret ?? currentCursorCharOffset();
  const trigStart = caretOverride?.acStart ?? acStart.value;
  // Strip the typed trigger fragment (`@col`, `$per`) before inserting
  // the chip. `acStart` holds the raw-text offset of the trigger `@` /
  // `$`; the slice [acStart, caret] is the trigger + typed query text.
  //
  // Defensive scan-backward: if acStart is unset (-1) OR doesn't point
  // at a valid trigger character, re-derive it by scanning back from
  // the caret for a `$<ident>` or `@<ident>` run. Catches event-order
  // races where Enter fires before refreshAutocompleteFromHost has
  // probed the latest text, AND the test-seam path where __apply runs
  // without ever calling the probe. Without this, the previously-typed
  // `$testo` would survive alongside the freshly-inserted chip.
  let cutFrom = trigStart >= 0 ? Math.min(trigStart, caret) : caret;
  const cutChar = text[cutFrom];
  if (cutChar !== "$" && cutChar !== "@") {
    const head = text.slice(0, caret);
    // Match a trailing trigger + typed query. `$ident` / `@ident` /
    // `@{partial-uuid` cases. Falls back to no-op (cutFrom unchanged)
    // when no pattern matches.
    const m = head.match(/[$@](?:[A-Za-z_][A-Za-z0-9_]*|\{[0-9a-fA-F:,_ -]*\}?)?$/);
    if (m) cutFrom = head.length - m[0].length;
  }
  const before = text.slice(0, cutFrom);
  const after = text.slice(caret);
  const newText = before + chipText + after;
  applyAtoms(parseForSurface(newText));
  emitValue(newText);
  const newCaret = (before + chipText).length;
  void nextTick(() => restoreCursorAtChar(newCaret));
}

function insertRefAtCursor(
  uuid: string,
  filter: RefFilter,
  caretOverride?: { caret: number; acStart: number },
): void {
  // Cache the wildcard's current display name in the ref so the chip
  // can render a label even when the library entry is later deleted.
  // Resolver matches on uuid only — the name is purely a fossil for
  // the UI. Missing-name fallback emits the bare-uuid form (legacy
  // workflows stay parseable round-trip). The expression + exclude-null
  // flag serialize as the `:expr` + `!null` segments (§3.2).
  const name = props.uuidToName.get(uuid);
  const refAtom: RefAtomX = {
    kind: "ref",
    uuid,
    subCategories: [],
    expr: filter.expr,
    excludeNull: filter.excludeNull,
    ...(name ? { name } : {}),
  };
  insertChipAtCaret(serialiseRefAtom(refAtom), caretOverride);
}

function insertVarAtCursor(name: string): void {
  insertChipAtCaret("$" + name);
}

// --- SubcategoryFilterPicker handlers ---
function onPickerApply(filter: { expr: string; excludeNull: boolean }): void {
  if (pickerMode.value === "insert" && pendingInsert.value) {
    insertRefAtCursor(
      pendingInsert.value.uuid,
      filter,
      pendingInsertCaret.value ?? undefined,
    );
    pendingInsert.value = null;
    pendingInsertCaret.value = null;
  } else if (pickerMode.value === "edit" && pickerTargetAtomIndex.value !== null) {
    const target = atoms.value[pickerTargetAtomIndex.value];
    if (target && target.kind === "ref") {
      // Refresh the cached display name on edit — the library may
      // have been renamed since this token was first written. Write the
      // new `{expr, excludeNull}` onto the atom; clear the legacy
      // `subCategories` so `refFilterOf` reads the explicit fields.
      const liveName = props.uuidToName.get(target.uuid);
      const nextAtom: RefAtomX = {
        ...target,
        subCategories: [],
        expr: filter.expr,
        excludeNull: filter.excludeNull,
        ...(liveName ? { name: liveName } : {}),
      };
      const next = replaceAtom(atoms.value, pickerTargetAtomIndex.value, nextAtom);
      applyAtoms(next);
      emitValue(serialiseAtomsLocal(atoms.value));
    }
  }
  pickerOpen.value = false;
}

function onPickerSkip(): void {
  if (pickerMode.value === "insert" && pendingInsert.value) {
    insertRefAtCursor(
      pendingInsert.value.uuid,
      { expr: "", excludeNull: false },
      pendingInsertCaret.value ?? undefined,
    );
    pendingInsert.value = null;
    pendingInsertCaret.value = null;
  }
  pickerOpen.value = false;
}

function onPickerDelete(): void {
  if (pickerTargetAtomIndex.value !== null) {
    const idx = pickerTargetAtomIndex.value;
    const next = atoms.value.filter((_, i) => i !== idx);
    applyAtoms(next);
    emitValue(serialiseAtomsLocal(atoms.value));
  }
  pickerOpen.value = false;
}

function cancelPicker(): void {
  // Backdrop dismiss is a clean cancel — drop pending state, do NOT
  // insert anything. Use Skip inside the picker to insert without
  // filter.
  pendingInsert.value = null;
  pendingInsertCaret.value = null;
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
        // Reconstruct the canonical 4-segment form (`@{uuid#name:expr
        // !null}`). `serialiseRefAtom` preserves the cached `#name` so
        // re-tokenization round-trips the display label, and reads the
        // `{expr, excludeNull}` filter (explicit fields or reconstructed
        // from the legacy `subCategories` body).
        out += serialiseRefAtom(atom);
      } else if (atom.kind === "var") {
        // SP2a: keep the `.K` list accessor (matches serialiseAtomsLocal +
        // atomicEditorModel.serialise). Dropping it here silently rewrote
        // `$mood.0` -> `$mood` on every host re-read (input / blur / settle).
        out += "$" + atom.name + (atom.index != null ? "." + atom.index : "");
      }
      continue;
    }
    if (el.classList.contains("wp-rt__text")) {
      // wp-rt__text spans hold the live text — user typing modifies the
      // span's textContent in place, so we read whatever's there now.
      // ZWSPs are render-only caret-landing helpers in empty pad spans;
      // strip them so they never reach modelValue.
      out += (el.textContent ?? "").replace(ZWSP_RE, "");
      continue;
    }
    // Defensive fallback for any other element (shouldn't happen in
    // practice — host children are chips + text spans + fragment markers).
    out += (el.textContent ?? "").replace(ZWSP_RE, "");
  }
  return out;
}

function onHostInput(ev?: Event): void {
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
  // Chipify any complete `$name` / `@{uuid}` tokens that the user just
  // closed by typing a word-boundary char (space, tab, comma, etc.).
  // Catches `$runtimeVar ` that never matched the static suggestion list
  // and would otherwise stay raw text forever.
  const inputEv = ev as InputEvent | undefined;
  if (
    inputEv?.inputType === "insertText" &&
    typeof inputEv.data === "string" &&
    SETTLE_DELIMITERS.test(inputEv.data)
  ) {
    settleAtomsFromHost();
  }
}

// NB: `.` is deliberately NOT a settle delimiter (SP2a). A var's `.K` list
// accessor (`$mood.0`) types the `.` before the digit; settling on `.` would
// chipify `$mood` prematurely and strand the accessor. `.` settles one
// boundary later (on the following space/comma/etc) instead.
const SETTLE_DELIMITERS = /[\s,;:/()[\]{}!?]/;

/** Re-parse the host's raw text into atoms, preserving the caret in
 *  raw-text space. Chipifies any complete `$name` / `@{uuid}` tokens
 *  that accumulated as plain text during typing (the suggestion-driven
 *  autocomplete path can only chipify names already in the catalog —
 *  runtime/forward-declared vars need this fallback). */
function settleAtomsFromHost(): void {
  const text = readHostAsText();
  const caret = currentCursorCharOffset();
  const parsed = parseForSurface(text);
  // Re-derive whenever the text content actually differs from what
  // atoms currently model. Skipping on "chip count unchanged" left
  // inline brace blocks (`{a|b|c}`, `{2$$,$$…}`) un-colored because
  // closing the brace doesn't add a chip — but the tokenized output
  // does change shape (`text` token → `dp-brace`/`dp-multi` token)
  // and v-html needs the new atom.text to re-render the colored
  // sub-span. Compare the user-typed text against the atoms' current
  // serialised form so we still skip true no-ops (e.g. typing a space
  // after a chip that was already settled).
  const liveSerialised = serialiseAtomsLocal(atoms.value);
  if (liveSerialised === text) return;
  applyAtoms(parsed);
  void nextTick(() => restoreCursorAtChar(caret));
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
    // Move the orphan node into the target span instead of overwriting
    // its textContent. Overwriting destroys colored sub-spans for inline
    // syntax (`<span class="wp-rt-dp-brace">…</span>` etc.) that the
    // textAtomHtml render produces. Keeping the orphan as a separate
    // text-node child preserves coloring on the rest of the span; the
    // orphan's text will be re-tokenized on the next applyAtoms cycle
    // (settle delimiter, blur, programmatic op).
    if (appendMode) {
      target.appendChild(orphan);
    } else {
      target.insertBefore(orphan, target.firstChild ?? null);
    }
    // caretRel.node === orphan stays valid — DOM only moved the node,
    // it's still the same text-node identity at the same offset.
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
  // If selection is already inside a wp-rt__text span (directly OR
  // nested in a colored sub-span like wp-rt-dp-brace), nothing to do —
  // browser will insert correctly and our caret math walks descendants.
  const targetEl: HTMLElement | null =
    target.nodeType === Node.TEXT_NODE
      ? (target as Text).parentElement
      : target.nodeType === Node.ELEMENT_NODE
        ? (target as HTMLElement)
        : null;
  if (targetEl && targetEl.closest(".wp-rt__text")) return;
  // Otherwise, find a wp-rt__text span to redirect into. Pick the span
  // ADJACENT to the user's caret position — not the document-wide last
  // span. When the caret landed on a chip element (chip body), the
  // immediately-following pad span is what the user expects to type
  // into; falling back to the final span shoves text to the wrong end
  // of the input.
  const newRange = document.createRange();
  const positioned = positionAfterTarget(target, range.startOffset, newRange);
  if (!positioned) {
    // Fall back to the last span if no adjacent pad was found (e.g.
    // selection is on the host root with no nearby chip).
    const spans = host.querySelectorAll(".wp-rt__text");
    if (spans.length === 0) return;
    const span = spans[spans.length - 1] as HTMLElement;
    // Walk to the LAST text-node descendant. With colored sub-spans
    // (`<span class="wp-rt-dp-multi">…</span>`), `firstChild` is no
    // longer guaranteed to be a text node, so the legacy fast path
    // would land the caret at element offset 0 — the START of the
    // span — and any text the user then typed appeared in front of
    // the brace block instead of after it.
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    let n: Node | null = walker.nextNode();
    while (n) {
      last = n as Text;
      n = walker.nextNode();
    }
    if (last) {
      newRange.setStart(last, (last.textContent ?? "").length);
    } else {
      newRange.setStart(span, 0);
    }
  }
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  // Don't preventDefault — browser will now insert at the new selection.
}

/** Position `range` so the caret lands inside the wp-rt__text span
 *  closest to the user's intent. When the original selection sat on a
 *  chip or on the host root between chips, the user wanted to type
 *  ADJACENT to that anchor — not somewhere else in the input. Returns
 *  true if a position was set. */
function positionAfterTarget(
  target: Node,
  offset: number,
  range: Range,
): boolean {
  const host = hostEl.value;
  if (!host) return false;
  let chip: HTMLElement | null = null;
  let preferFollowing = true;
  if (target.nodeType === Node.ELEMENT_NODE) {
    const el = target as HTMLElement;
    if (el === host) {
      // Caret on host root — offset is child-index. Inspect the child
      // just before the offset (if any) to find the nearest chip.
      const childBefore = host.childNodes[offset - 1] ?? null;
      const childAt = host.childNodes[offset] ?? null;
      if (childBefore && childBefore.nodeType === Node.ELEMENT_NODE
          && (childBefore as HTMLElement).classList.contains("wp-refchip")) {
        chip = childBefore as HTMLElement;
        preferFollowing = true;
      } else if (childAt && childAt.nodeType === Node.ELEMENT_NODE
          && (childAt as HTMLElement).classList.contains("wp-refchip")) {
        chip = childAt as HTMLElement;
        preferFollowing = false;
      }
    } else if (el.classList.contains("wp-refchip")) {
      chip = el;
      preferFollowing = true;
    }
  }
  if (!chip) return false;
  // Walk siblings to find the nearest pad span.
  let sib: Node | null = preferFollowing ? chip.nextSibling : chip.previousSibling;
  while (sib) {
    if (sib.nodeType === Node.ELEMENT_NODE
        && (sib as HTMLElement).classList.contains("wp-rt__text")) {
      const span = sib as HTMLElement;
      // Walk the first/last text-node descendant. With colored sub-
      // spans inside `wp-rt__text`, `firstChild` may be an element
      // (e.g. wp-rt-dp-brace) instead of a text node — placing the
      // caret on the span element at offset 0 would drop typing in
      // front of the colored block instead of next to the chip.
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let first: Text | null = null;
      let last: Text | null = null;
      let n: Node | null = walker.nextNode();
      while (n) {
        if (!first) first = n as Text;
        last = n as Text;
        n = walker.nextNode();
      }
      if (preferFollowing && last) {
        range.setStart(last, (last.textContent ?? "").length);
      } else if (!preferFollowing && first) {
        range.setStart(first, 0);
      } else {
        range.setStart(span, 0);
      }
      return true;
    }
    sib = preferFollowing ? sib.nextSibling : sib.previousSibling;
  }
  return false;
}

/** Paste handler — converts the pasted text into atoms and merges
 *  them at the caret. Without intercepting, browsers paste raw text
 *  directly into the host (potentially as a sibling text node rather
 *  than inside a wp-rt__text span), and a pasted `@{uuid}` literal
 *  stays as plain text instead of chip-ifying. Intercept, parse the
 *  pasted text, splice into atoms, restore caret after the paste. */
function onHostPaste(ev: ClipboardEvent): void {
  if (props.disabled) return;
  const data = ev.clipboardData?.getData("text/plain");
  if (data == null) return;
  ev.preventDefault();
  const currentText = readHostAsText();
  // Read selection BOUNDS, not just a caret — a non-collapsed
  // selection (e.g. after Ctrl+A or shift-drag) must be REPLACED by
  // the paste, not have the paste appended at one endpoint while the
  // selection stays. Without this, pasting over `hello world` left
  // `hello worldreplaced` instead of `replaced`.
  const { start, end } = currentSelectionRangeRaw();
  // Strip CRLF / LF normalisation — single-line inputs ignore newlines,
  // multi-line inputs keep them. Atoms model treats text atoms as
  // opaque strings either way.
  const pasted = props.multiline ? data : data.replace(/[\r\n]+/g, " ");
  const before = currentText.slice(0, start);
  const after = currentText.slice(end);
  const newText = before + pasted + after;
  applyAtoms(parseForSurface(newText));
  emitValue(newText);
  const newCaret = (before + pasted).length;
  void nextTick(() => restoreCursorAtChar(newCaret));
}

function onHostBlur(): void {
  focused.value = false;
  // Safety net: any leftover `$name` / `@{uuid}` / `{a|b|c}` text that
  // didn't trigger a settle-by-delimiter during typing chips up here.
  // Caret already gone, so no need to restore it — atoms re-render is
  // enough. Mirrors `settleAtomsFromHost`'s "live text differs from
  // serialised atoms" check so a closed brace block re-colors on blur.
  const text = readHostAsText();
  if (serialiseAtomsLocal(atoms.value) === text) return;
  applyAtoms(parseForSurface(text));
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
    // Caret already inside a wp-rt__text (directly or via colored
    // sub-span) → leave it alone.
    const scEl: HTMLElement | null =
      sc.nodeType === Node.TEXT_NODE
        ? (sc as Text).parentElement
        : sc.nodeType === Node.ELEMENT_NODE
          ? (sc as HTMLElement)
          : null;
    if (scEl && scEl.closest(".wp-rt__text")) return;
    const spans = host.querySelectorAll(".wp-rt__text");
    if (spans.length === 0) return;
    const span = spans[spans.length - 1] as HTMLElement;
    const r = document.createRange();
    // Walk to the last text-node descendant so the caret lands inside
    // whichever sub-span owns the trailing position.
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    let n: Node | null = walker.nextNode();
    while (n) {
      last = n as Text;
      n = walker.nextNode();
    }
    if (last) {
      r.setStart(last, (last.textContent ?? "").length);
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
  // Enter while the `$` / `@` autocomplete is open:
  //   - Suggestion matched → insert that.
  //   - No suggestion match BUT user typed a `$<name>` query → chipify
  //     the literal name. Runtime / forward-declared vars never appear
  //     in the static suggestion list, so this is the only way to get
  //     a chip without manually typing a delimiter afterwards.
  //   - No match + empty query (just `$` / `@`) → close popover, let
  //     the browser handle Enter normally (insert newline in multiline).
  if (ev.key === "Enter" && acOpen.value) {
    if (acItems.value.length > 0) {
      ev.preventDefault();
      applyAutocomplete(acItems.value[acActive.value]);
      return;
    }
    if (acTrigger.value === "$" && acQuery.value.length > 0) {
      ev.preventDefault();
      insertVarAtCursor(acQuery.value);
      acOpen.value = false;
      return;
    }
  }
  // Single-line mode: swallow Enter. The contenteditable host would
  // otherwise insert a `<br>` (or wrap typed text in a fresh `<div>`)
  // and the surrounding `wp-rt__host--single` is `overflow-y: hidden`
  // — the newline pushes existing content out of view, the caret jumps
  // to an invisible second line, and the input looks empty until the
  // user presses Backspace and the `<br>` collapses. Mirrors how
  // native `<input>` ignores Enter.
  if (ev.key === "Enter" && !props.multiline) {
    ev.preventDefault();
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
    // Atom-direct deletion — NEVER re-tokenize on delete, so editing can't
    // chipify. We read the live atom structure (`readHostAsAtoms`: text from
    // the DOM, chips from `atoms.value`), delete a raw-text span directly off
    // those atoms via `deleteRawRange`, and re-apply. Chip formation stays on
    // the commit paths (settle-delimiter / blur / autocomplete) ONLY —
    // matching the rule that Backspace must never form a chip.
    //
    // A committed chip (a `.wp-refchip` element) is removed whole because
    // `deleteRawRange` widens the span to chip boundaries; raw text that only
    // LOOKS like a chip (`$mood`, `$mood.` mid-edit) is a plain text atom and
    // loses exactly one char. The same path also handles non-collapsed
    // selections (Ctrl+A, drag-select) — the whole selected raw span goes.
    const range = currentSelectionRangeRaw();
    let delStart: number;
    let delEnd: number;
    if (range.start !== range.end) {
      delStart = range.start;
      delEnd = range.end;
    } else {
      if (range.start === 0) return; // caret at start — nothing to delete
      delStart = range.start - 1;
      delEnd = range.start;
    }
    ev.preventDefault();
    const { atoms: nextAtoms, caret } = deleteRawRange(readHostAsAtoms(), delStart, delEnd);
    applyAtoms(nextAtoms);
    emitValue(serialiseAtomsLocal(atoms.value));
    void nextTick(() => restoreCursorAtChar(caret));
    return;
  }
  if (ev.key === "Delete") {
    // Forward-delete — mirror of Backspace, atom-direct (no re-tokenize). The
    // deletion span is the one char AFTER the caret (or the whole selection);
    // `deleteRawRange` widens it to remove a committed chip whole.
    const live = readHostAsAtoms();
    const range = currentSelectionRangeRaw();
    let delStart: number;
    let delEnd: number;
    if (range.start !== range.end) {
      delStart = range.start;
      delEnd = range.end;
    } else {
      const totalLen = serialiseAtomsLocal(live).length;
      if (range.start >= totalLen) return; // caret at end — nothing forward
      delStart = range.start;
      delEnd = range.start + 1;
    }
    ev.preventDefault();
    const { atoms: nextAtoms, caret } = deleteRawRange(live, delStart, delEnd);
    applyAtoms(nextAtoms);
    emitValue(serialiseAtomsLocal(atoms.value));
    void nextTick(() => restoreCursorAtChar(caret));
    return;
  }
  // Arrow keys: defer to native browser handling. Modern browsers skip
  // `contenteditable=false` chip nodes naturally — the caret hops to
  // the adjacent text span on both Chrome and Firefox. Earlier
  // attempts at custom hopping fought the browser's selection
  // semantics around empty text atoms (padded landing spans) and
  // produced worse UX than the native fallback.
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
      @blur="onHostBlur"
      @input="onHostInput"
      @keydown="onHostKeydown"
      @beforeinput="onHostBeforeInput"
      @paste="onHostPaste"
    >
      <template v-for="(atom, idx) in atoms" :key="idx">
        <RefChip
          v-if="atom.kind === 'ref' || atom.kind === 'var'"
          :kind="atom.kind"
          :name="atom.kind === 'var'
            ? atom.name
            : (uuidToName.get(atom.uuid) ?? atom.name ?? '')"
          :uuid="atom.kind === 'ref' ? atom.uuid : ''"
          :expr="atom.kind === 'ref' ? chipFilterOf(atom).expr : ''"
          :exclude-null="atom.kind === 'ref' ? chipFilterOf(atom).excludeNull : false"
          :resolved="atomIsResolved(atom)"
          :index="atom.kind === 'var' ? atom.index : undefined"
          :data-atom-index="idx"
          @click="(ev: MouseEvent) => onChipClick(idx, ev)"
        />
        <span
          v-else
          :data-atom-index="idx"
          class="wp-rt__text"
          :class="atom.blockColor
            ? ['wp-rt-block-scaf', 'wp-rt-block-scaf--' + atom.blockColor]
            : null"
          v-html="renderTextAtom(atom)"
        ></span>
      </template>
    </div>

    <!-- Warning markers overlay. Each marker is a zero-width inline element
         anchored at the UTF-16 offset corresponding to the warning position.
         `data-warning-position` records the original code-point index for tests. -->
    <div
      v-if="effectiveWarnings.length > 0"
      class="wp-rt__warnings"
      aria-hidden="true"
    >
      <span
        v-for="w in effectiveWarnings"
        :key="`${w.position}-${w.severity}-${w.module_id}-${w.source_field}`"
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
          <span v-if="suggestionMeta(label)" class="wp-rt-suggestions__meta">
            {{ suggestionMeta(label) }}
          </span>
        </button>
      </div>
    </Teleport>

    <!-- Backdrop click cancels the picker without inserting anything. To
         insert an unfiltered @{uuid}, use the Skip button inside the
         picker. The picker itself is anchored beneath (or above) the
         clicked chip / host element via `pickerAnchor` — a popover,
         not a modal — so it feels like a contextual control on the
         element the user just touched. -->
    <Teleport v-if="pickerOpen" to="body">
      <div class="wp-subcat-picker__backdrop" @click="cancelPicker"></div>
      <div
        class="wp-subcat-picker__anchor"
        :class="{ 'wp-subcat-picker__anchor--flipped': pickerAnchor.flipped }"
        :style="{
          top: pickerAnchor.top + 'px',
          left: pickerAnchor.left + 'px',
        }"
        @click.stop
      >
        <SubcategoryFilterPicker
          :sub-categories="pickerSubCats"
          :tag-groups="pickerTagGroups"
          :option-tag-sets="pickerOptionTagSets"
          :initial-expr="pickerInitialExpr"
          :initial-exclude-null="pickerInitialExcludeNull"
          :mode="pickerMode"
          :has-null-option="pickerHasNull"
          @apply="onPickerApply"
          @skip="onPickerSkip"
          @delete="onPickerDelete"
        />
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
  line-height: 1.9;
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
.wp-rt-suggestions__meta {
  margin-left: var(--wp-space-4);
  color: var(--wp-text-dim, #8a8a93);
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11px; /* audit-exempt: micro disambiguator suffix — below scale floor */
  flex-shrink: 0;
}
.wp-rt-suggestions__item[data-active] .wp-rt-suggestions__meta {
  color: var(--wp-text, #e7e7ee);
}

/* Step-2 SubcategoryFilterPicker — anchored popover next to the
   clicked chip (or below the host on insert flow). Teleported to
   <body> so it escapes ancestor overflow/transform contexts. Backdrop
   is a transparent click-target full-viewport layer that cancels the
   picker (Skip semantics — no insert). Escape key dismisses the
   same way. */
.wp-subcat-picker__backdrop {
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 1000;
}
.wp-subcat-picker__anchor {
  position: fixed;
  z-index: 1001;
  /* Subtle drop-shadow so the popover reads as elevated even without
     the dimmed backdrop of the previous modal version. */
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4));
}
</style>
