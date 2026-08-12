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
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  parse,
  replaceAtom,
  type Atom,
  type RefAtom,
  type TextAtom,
} from "./atomicEditorModel";
import { escapeHtml, inlineTokenHtml, splitRefFilter, tokenizeRich } from "../../widgets/richTokenize";
import RefChip, { type VarProducerLike } from "./RefChip.vue";
import SubcategoryFilterPicker from "./SubcategoryFilterPicker.vue";
import RemapRefPopup from "./RemapRefPopup.vue";
import { useGrowableField } from "../../components/shared/useGrowableField";
import { rewriteBrokenRef } from "../cascade/remap-ref-rewrite";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import type { SurfaceKind, ResolveWarning } from "../utils/resolveTokens";
import { probeAutocomplete, probeModelRef, probeTagWord } from "../utils/autocompleteProbe";
import { api } from "../api/client";
import type { ModelKind, ModelSuggestion, TagCategoryName, TagSuggestion } from "../api/types";
import { loadTagAvailability } from "../utils/tagStatus";
import {
  autocompleteSeparatorEnabled,
  completionSettingsVersion,
  completionSourceEnabled as sourceOn,
} from "../utils/tagSetting";
import { refRows, varRows, type SuggestionRow } from "../utils/suggestion-rows";
import { varColorClass, varColorIndex } from "../../components/shared/var-color";
import { CONTEXT_POOLS_KEY, type ContextPoolMap } from "../../extension/context-pools";

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
  /** Single-line surfaces (`multiline:false`) clip long values behind a
   *  horizontal scroll. Set `wrap` to instead WRAP the value onto multiple
   *  lines and auto-grow the box to fit (with a max-height cap + manual
   *  vertical resize handle). Semantics stay single-value — Enter still
   *  commits, newlines aren't meaningful. No effect when `multiline`. */
  wrap?: boolean;
  placeholder?: string;
  varSuggestions?: string[];
  refSuggestions?: string[];
  /** Opt-in: enable the `@{}` nested-wildcard-ref machinery (autocomplete
   *  popover + sub-cat picker + ref chips) on a NON-wildcard surface. Set by
   *  the derivation editor on ACTION-value inputs — the engine resolves `@{}`
   *  there (carrier) but compares `condition.value` raw, so condition inputs
   *  leave this false. The `wildcard` surface enables refs regardless. */
  allowNestedRefs?: boolean;
  /**
   * Override the producer/consumer default for `$var` reads.
   *
   * Tri-state on purpose. A `boolean` here would be inferred as a Vue Boolean
   * prop, and Vue casts an ABSENT Boolean prop to `false` rather than leaving
   * it undefined — so `props.allowVars ?? <default>` never reached the
   * default and every surface silently lost `$`. `"auto"` says "use the
   * surface's rule" in a way no prop-casting rule can quietly rewrite.
   */
  allowVars?: "auto" | "on" | "off";
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
  /** `$var` → who writes it, from `collectUpstreamProducers`. Canvas hosts
   *  pass this so a var chip's hover card can name the module and node that
   *  produce the value; the SPA has no graph and passes nothing. */
  varProducers?: Map<string, VarProducerLike>;
  /** True when the host walked a graph. Lets the chip say "no upstream
   *  producer" (canvas, actionable) rather than staying silent (SPA). */
  graphAware?: boolean;
  /**
   * Fill the height the host gives us and scroll the overflow, instead of
   * growing to fit the content and offering a drag grip.
   *
   * For canvas widgets mounted with `fillHost`, where the NODE's own corner is
   * the one and only resize control. Two resize authorities on one box is what
   * produced a drag that never ended and a node that fought the editor over
   * its height; this removes the second one rather than arbitrating between
   * them.
   *
   * Hides the grip, drops the height cap, and makes the box a flex child that
   * can shrink below its content — without `min-height: 0` a flex item refuses
   * to, which is exactly how the payload used to push the node taller.
   */
  fill?: boolean;
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
  wrap: false,
  placeholder: "",
  varSuggestions: () => [],
  refSuggestions: () => [],
  allowNestedRefs: false,
  uuidToName: () => new Map(),
  uuidToSubCategories: () => new Map(),
  uuidToHasNull: () => new Map(),
  uuidToOptionsCount: () => new Map(),
  uuidToOptionTagSets: () => new Map(),
  uuidToTagGroups: () => new Map(),
  ariaLabel: undefined,
  disabled: false,
  varProducers: undefined,
  graphAware: false,
  fill: false,
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

/** `@{}` nested-ref machinery is live when the surface is `wildcard` OR the
 *  host opted in via `allowNestedRefs` (derivation action values). Single
 *  source for the parse-collapse + the `@`-autocomplete gate so they can't
 *  drift apart. */
const refsEnabled = computed(() => props.surface === "wildcard" || props.allowNestedRefs);

/**
 * Whether `$var` READS mean anything on this surface.
 *
 * The engine already draws this line and calls it producer vs consumer:
 * `wildcard` and `fixed_values` DEFINE what a `$name` resolves to, so a `$var`
 * read inside one is not a reference — `resolve_text` gates both off and
 * renders the token as literal text with a warning
 * (`engine/modules/fixed_values_handler.py`, `engine/syntax/resolve.py`).
 *
 * The frontend used to hardcode `surface === "wildcard"` here, which made it
 * MORE permissive than the engine: the SPA's fixed-values editor offered `$`
 * autocomplete for tokens the engine would never resolve. A prop with a
 * surface-derived default keeps the two aligned and lets a caller be explicit
 * rather than adding a third name to a growing condition.
 */
/**
 * Surfaces that render `$var` as coloured text rather than a chip.
 *
 * Only the prompt template. Everywhere else a chip is honest — the module
 * editors let you click one to re-pick what it points at, so the border and
 * fill are advertising a real affordance. A template is prose you are writing,
 * the chip advertises nothing, and its box breaks the line rhythm of the
 * sentence at 10px inside 12px text.
 */
const FLAT_VAR_SURFACES = new Set(["assembler"]);

const PRODUCER_SURFACES = new Set(["wildcard", "fixed_values"]);
const flatVars = computed(() => FLAT_VAR_SURFACES.has(props.surface ?? "combine"));

const varsEnabled = computed(() => {
  if (props.allowVars === "on") return true;
  if (props.allowVars === "off") return false;
  return !PRODUCER_SURFACES.has(props.surface ?? "combine");
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

// --- Refs ---
const hostEl = ref<HTMLDivElement | null>(null);
const popoverEl = ref<HTMLDivElement | null>(null);
const focused = ref(false);

// Placeholder-ghost gate. The host ALWAYS carries a ZWSP pad span (padAtoms),
// so `.wp-rt__host:empty` never matches — the placeholder must hang off an
// explicit class instead. Tracks LIVE content (updated on every input +
// programmatic apply) so the ghost hides on the first keystroke like a native
// `<input placeholder>`.
const isEmpty = ref((props.modelValue ?? "").length === 0);

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
/** `"tag"` is the sigil-less booru-tag mode. Keeping it in the SAME state as
 *  `$` and `@` is deliberate: one popover, one trigger, so the modes are
 *  mutually exclusive by construction rather than by coordination. Two
 *  independent popovers could both be open over one caret. */
const acTrigger = ref<"$" | "@" | "tag">("$");

/* ── Booru tag autocomplete (optional, off unless enabled) ──────────────────
 * Rows come from the server: the tag list is several megabytes and is never
 * sent to the browser, so every keystroke asks for one screenful instead.
 *
 * Gated three ways — the setting, an installed list, and the sigil probe not
 * already owning the caret. Any one of them false and this stays silent. */
/** 855605 -> "856k". The exact figure is noise; the order of magnitude is the
 *  whole signal, and a full number would dominate a 12px row. */
function formatTagCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

const tagRows = ref<TagSuggestion[]>([]);
const modelRows = ref<Partial<Record<ModelKind, ModelSuggestion[]>>>({});

/** Set while the caret sits inside a `<lora:…>` or `embedding:…` reference.
 *  Restricts the popover to that kind: a reference names one by construction,
 *  so offering the other — or offering tags — is offering something that
 *  cannot legally be inserted at that caret. */
const refKind = ref<ModelKind | null>(null);

/**
 * The query the rows currently on screen were actually fetched for.
 *
 * The header renders `acQuery`, which updates synchronously on every
 * keystroke, while the rows arrive from a debounced fetch — so there is a
 * window where the popover shows the PREVIOUS query's results under the
 * CURRENT query's header. Caught on video: the field read `lazy` while the
 * third row was `laser` (from the alias `lazer`), which is not a `lazy` prefix
 * at all — those were the results for `laz`.
 *
 * The rows are deliberately not cleared while the next fetch is in flight;
 * blanking on every keystroke flickers far worse than briefly-stale content.
 * Instead the popover says so, which turns an unexplained reflow into an
 * obvious "still looking".
 */
const rowsQuery = ref("");
const rowsStale = computed(() => acOpen.value && rowsQuery.value !== acQuery.value);

/**
 * One row of the bare-word popover, whatever source it came from.
 *
 * Kept as ONE FLAT ARRAY even though the popover renders sections, because
 * `acActive` indexes it. Grouping the state instead would put the keyboard
 * selection in charge of two coordinates and make "skip the header" a case to
 * handle; flat, a header is simply not in the array and cannot be selected.
 */
type WordRow =
  | { source: "tag"; tag: TagSuggestion }
  | { source: ModelKind; model: ModelSuggestion };

/**
 * Sections, not one ranked list.
 *
 * The sources have no common ranking key: a tag ranks by post count in the tens
 * of thousands, a LoRA has no count at all — you either have the file or you do
 * not. Any flat ordering has to invent a comparison between "12,000 posts" and
 * "a file on disk", and whichever is invented, tags win on weight of numbers
 * and the user's own models sink below the fold. Sections also let each source
 * cap its own rows, so 20 tags cannot crowd out 3 matching LoRAs.
 *
 * Tags lead because that is what a prompt is mostly made of.
 */
/** Tag rows kept when a model also matched.
 *
 *  Sections alone did not deliver what they promised. Tags lead, and a query
 *  like `lazy` matches twenty of them, so the embedding section existed but sat
 *  entirely below the fold — the user could not filter to their own models
 *  without scrolling a list they were not looking for. Capping the leading
 *  section is what actually makes the others reachable.
 *
 *  Only applied when there IS something to protect: a query matching nothing
 *  but tags still gets the full twenty. */
const TAGS_WHEN_MODELS_MATCH = 6;

const wordRows = computed<WordRow[]>(() => {
  const loras = modelRows.value.lora ?? [];
  const embeddings = modelRows.value.embedding ?? [];
  const modelsPresent = loras.length > 0 || embeddings.length > 0;
  const tags = modelsPresent
    ? tagRows.value.slice(0, TAGS_WHEN_MODELS_MATCH)
    : tagRows.value;
  return [
    ...tags.map((tag) => ({ source: "tag" as const, tag })),
    ...loras.map((model) => ({ source: "lora" as const, model })),
    ...embeddings.map((model) => ({ source: "embedding" as const, model })),
  ];
});

/** Rows grouped for rendering, in the same order as the flat list, with the
 *  flat index carried along so a click knows what it selected. */
const wordSections = computed(() => {
  const order: Array<WordRow["source"]> = ["tag", "lora", "embedding"];
  const labels: Record<WordRow["source"], string> = {
    tag: "tags", lora: "loras", embedding: "embeddings",
  };
  const out: Array<{ source: WordRow["source"]; label: string; rows: Array<{ row: WordRow; index: number }> }> = [];
  for (const source of order) {
    const rows = wordRows.value
      .map((row, index) => ({ row, index }))
      .filter((e) => e.row.source === source);
    if (rows.length) out.push({ source, label: labels[source], rows });
  }
  return out;
});

/** PrimeIcon per source. `pi-tags` plural is the booru tag — `pi-tag` singular
 *  is already the fixed_values module kind. `pi-asterisk` and `pi-code` were
 *  the only two candidates with no existing use anywhere in `src/`. */
const SOURCE_ICON: Record<WordRow["source"], string> = {
  tag: "pi pi-tags",
  lora: "pi pi-asterisk",
  embedding: "pi pi-code",
};

/** What a committed row puts in the document. A model inserts its FULL PATH,
 *  not its display name: two folders can hold the same filename and ComfyUI
 *  resolves by path, so inserting the short name would silently pick a
 *  different file from the one shown. */
/**
 * What follows a committed completion.
 *
 * Opt-in `", "`, so the next tag can be typed straight away. Suppressed inside
 * a `<lora:…>` or `embedding:…` reference: there the caret is mid-syntax and a
 * comma would terminate the very reference being completed — the LoRA still
 * needs its `:weight>`.
 */
function committedSuffix(): string {
  if (refKind.value !== null) return "";
  return autocompleteSeparatorEnabled() ? ", " : "";
}

function wordRowText(row: WordRow): string {
  if (row.source === "tag") return row.tag.name;
  // Inside an existing reference the caller already typed the marker, and
  // `acStart` points at the path — so emitting the whole syntax again would
  // produce `<lora:<lora:name:1.0>:1.0>`.
  if (refKind.value !== null) return row.model.path;
  if (row.source === "lora") return `<lora:${row.model.path}:1.0>`;
  return `embedding:${row.model.path}`;
}

/** Categories present in the CURRENT results, in Danbooru's own order.
 *
 *  The legend appears only when more than one kind is on screen. On an
 *  all-general query every bar is the same neutral grey, and a legend naming
 *  four colours none of which are visible explains nothing — it is decoration
 *  that costs a row of height. */
const tagLegend = computed(() => {
  if (!tagHasCategories.value) return [];
  const order: TagCategoryName[] = [
    "character", "copyright", "artist", "meta", "general",
  ];
  const present = new Set(
    tagRows.value
      .map((t) => t.category_name)
      .filter((c): c is TagCategoryName => c !== null),
  );
  const shown = order.filter((c) => present.has(c));
  return shown.length > 1 ? shown : [];
});
/** Row count for the ACTIVE mode — keyboard nav must not care which. */
const acRowCount = computed(
  () => (acTrigger.value === "tag" ? wordRows.value.length : acItems.value.length),
);
const tagListAvailable = ref(false);
const tagHasCategories = ref(false);
let tagFetchSeq = 0;
let tagFetchTimer: ReturnType<typeof setTimeout> | undefined;

/** Enabled only where a booru tag is a plausible thing to type: option values
 *  and template text. Never in a name field. */
const tagAutocompleteEnabled = computed(() => {
  // The reactive dependency that makes this recompute at all: `sourceOn` reads
  // ComfyUI's settings store, which Vue cannot track, so without this the
  // result cached until the page reloaded.
  void completionSettingsVersion.value;
  if (props.disabled) return false;
  // Tags need a downloaded list; the model sources read what ComfyUI already
  // enumerated, so for them "switched on" is the whole condition. Any one
  // source being usable is enough to arm the bare-word probe.
  if (sourceOn("tag") && tagListAvailable.value) return true;
  return sourceOn("lora") || sourceOn("embedding");
});

function scheduleTagFetch(query: string): void {
  if (tagFetchTimer !== undefined) clearTimeout(tagFetchTimer);
  // A sequence number, not just a timer: responses can land out of order and
  // a slow answer for "blu" must not overwrite a fast one for "blue_ha".
  const seq = ++tagFetchSeq;
  tagFetchTimer = setTimeout(() => {
    /* ONE settle for all sources, not one per source.
     *
     * These used to resolve independently, on the reasoning that the popover
     * should never be held at the speed of the slower one. That optimised for a
     * latency that does not exist — both endpoints are in-process on localhost —
     * and paid for it with a visible double reflow on EVERY keystroke: the tag
     * rows landed and rendered, then the model rows landed, appended their
     * sections and re-capped the tags, so the list rebuilt twice in a few tens
     * of milliseconds. That is the flicker.
     *
     * `allSettled`, so one source failing still shows the other. A failure is
     * an empty list for that source and nothing else — an optional convenience
     * must not raise anything while someone is mid-sentence.
     */
    const wantTags = refKind.value === null && sourceOn("tag") && tagListAvailable.value;
    const kinds: ModelKind[] = refKind.value !== null
      ? [refKind.value]
      : [
        ...(sourceOn("lora") ? ["lora" as const] : []),
        ...(sourceOn("embedding") ? ["embedding" as const] : []),
      ];

    void Promise.allSettled([
      wantTags ? api.tags.suggest(query, 20) : Promise.resolve(null),
      kinds.length > 0
        ? api.models.suggest(query, kinds, 8, refKind.value !== null)
        : Promise.resolve(null),
    ]).then(([tagRes, modelRes]) => {
      // Stale-response guard: a newer keystroke already scheduled its own
      // fetch, and its answer must not be overwritten by ours arriving late.
      if (seq !== tagFetchSeq) return;
      tagRows.value = tagRes.status === "fulfilled" && tagRes.value
        ? tagRes.value.tags
        : [];
      modelRows.value = modelRes.status === "fulfilled" && modelRes.value
        ? modelRes.value.results
        : {};
      rowsQuery.value = query;
      acActive.value = 0;
    });
  }, 120);
}
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
const pickerWildcardName = ref("");
/** `"node"` when this Context node carries its own snapshot of the wildcard
 *  being filtered. Absent in the SPA, which only ever reads the library. */
const pickerPoolOrigin = ref<"node" | "library" | undefined>(undefined);

/** Pools this Context node holds, when a Context node is an ancestor. Same
 *  injection RefChip uses, so the chip marker and the panel header agree about
 *  which pool is in play. */
const contextPools = inject<{ value: ContextPoolMap } | undefined>(
  CONTEXT_POOLS_KEY,
  undefined,
);
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

// --- RemapRefPopup state (#3 broken-chip heal) ---
const remapOpen = ref(false);
const remapOldUuid = ref("");
const remapCachedName = ref("");
const remapOldExpr = ref("");
const remapOldExcludeNull = ref(false);
const remapAnchor = ref<{ top: number; left: number }>({ top: 0, left: 0 });

/** WildcardRefData the popup's dropdown + reconcile consume. RichTextInput
 *  already receives the per-uuid maps as props (uuidToName etc.), so we
 *  assemble the WildcardRefData shape from them rather than re-walking a
 *  catalog the editor host doesn't hold. */
const remapRefData = computed(() => ({
  uuidToName: props.uuidToName,
  uuidToSubCategories: props.uuidToSubCategories,
  uuidToHasNull: props.uuidToHasNull,
  uuidToOptionsCount: props.uuidToOptionsCount,
  uuidToOptionTagSets: props.uuidToOptionTagSets,
  uuidToTagGroups: props.uuidToTagGroups,
}));

/** Theme class to stamp on the body-teleported overlays (`@`-autocomplete
 *  popover + the SubcategoryFilterPicker anchor/backdrop).
 *
 *  Why: both overlays `<Teleport to="body">`, so they escape the host's
 *  subtree. The `--wp-*` light + dark token variants are declared on
 *  `.wp-theme-light` / `.wp-theme-dark`; when the HOST sits under a
 *  non-default theme (canvas light mode, or the SPA's light theme) the
 *  body-teleported node would otherwise resolve only the base `:root`
 *  (dark) palette and paint with the wrong colors.
 *
 *  Mirroring the host's resolved theme onto the teleported root makes the
 *  tokens resolve to the SAME values the host uses. We read the nearest
 *  themed ancestor of the host live (re-evaluated each render, so it's
 *  correct at open time in BOTH the SPA and the canvas without hard-coding
 *  either). Empty string when no explicit theme class is on the ancestor
 *  chain — the inherited cascade is then already correct (default dark). */
function teleportThemeClass(): string {
  const el = hostEl.value;
  if (!el || typeof el.closest !== "function") return "";
  const themed = el.closest(".wp-theme-light, .wp-theme-dark");
  if (!themed) return "";
  return themed.classList.contains("wp-theme-light")
    ? "wp-theme-light"
    : "wp-theme-dark";
}

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
      // fixed_values and assembler both keep `$name` as literal text, for
      // opposite reasons. fixed_values PRODUCES bindings, so a `$var` read is
      // meaningless there. The assembler reads them constantly — but a
      // template is prose, and an atomic chip in prose behaves like an object:
      // one Backspace deletes the whole token, the caret cannot enter it, and
      // it takes a pointer cursor. Collapsed, it is ordinary editable text
      // that happens to be coloured.
      : props.surface === "fixed_values" || props.surface === "assembler"
        ? new Set(["var", "ref"])
        : new Set(["ref"]);
  // Action-value derivation inputs (allowNestedRefs) chipify `@{}` refs like
  // the wildcard surface does — drop `ref` from the collapse set so they
  // settle into chips instead of staying literal text.
  if (refsEnabled.value) collapseSet.delete("ref");
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
// Bumped whenever the atom v-for has to be rebuilt rather than patched:
// the browser destroyed rendered nodes behind Vue's back (see
// `hostDomIsStale`), or a structural insert is landing on a hand-mutated
// contenteditable (autocomplete / ref-picker apply).
//
// Keyed on the HOST ELEMENT, never on the atom v-for. Re-keying the v-for
// looks like the lighter option and is not: the host is a contenteditable,
// so every node inside it — including the two EMPTY TEXT NODES Vue uses to
// delimit each `<template v-for>` Fragment — belongs to the browser, which
// deletes and merges them at will (Firefox normalises empty text nodes away
// as you type; Chromium keeps them, which is why this only ever reproduced
// on Firefox). Once an anchor is gone, tearing the v-for down runs Vue's
// `removeFragment` walk off the end of the child list and throws
// `nextSibling of null`, and patching over detached child els throws
// `insertBefore: Child to insert before is not a child of this node`.
//
// Replacing the host element sidesteps both: Vue unmounts an element vnode
// with a single `hostRemove(el)` on a node that IS still attached, tearing
// its children down with `doRemove: false` so no stale child el or missing
// anchor is ever touched, then mounts the new tree into an empty element
// with no anchor to insert before.
const hostEpoch = ref(0);
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
  // The always-collapse rule above has one exception, and it is the exception
  // that proves it: the rationale is "the ABSENCE of a chip already signals
  // not-committed, so an inline colour would only compete with the settled
  // chip palette". On the prompt template there are no var chips at all, so
  // nothing is being competed with and the colour is the only signal there is.
  if (!flatVars.value) return inlineTokenHtml(text, ["var", "ref"]);
  return inlineTokenHtml(text, ["ref"], varSpanAttrs);
}

/**
 * Inline attributes for one `$name` run on the prompt-template surface.
 *
 * Colour comes from the same djb2 hash the assembler's variable strip uses, so
 * a name reads identically in the template, in the strip and in the `$`
 * popover. Inline rather than a class because `.wp-rt .wp-rt-var` already sets
 * a colour at higher specificity than the global `.var-N` palette.
 *
 * A name nothing upstream writes gets the danger colour and a wavy underline
 * instead. Losing the chip lost the one cue that separated a typo from a
 * working variable, and colour alone cannot carry it — every run is coloured.
 * Only claimed where the host actually walked a graph: in the SPA every var is
 * out of scope because there is no graph to be in.
 */
function varSpanAttrs(name: string): string {
  if (props.graphAware && !props.varSuggestions.includes(name)) {
    return ' style="color:var(--wp-danger,#ef4444);'
      + "text-decoration:underline wavy color-mix(in srgb,var(--wp-danger,#ef4444) 70%,transparent);"
      + 'text-underline-offset:3px;text-decoration-thickness:1px"';
  }
  return ` style="color:var(--wp-var-${varColorIndex(name)})"`;
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
  // Echo of our own emit — ignore, so a round-tripped keystroke doesn't
  // rebuild the DOM under a live caret. The string alone is not enough to
  // tell an echo from a real write: `lastEmittedValue` seeds to the mount
  // value, so an editor that mounted empty treats every later external ""
  // as an echo. That is exactly the assembler's Clear button — it wrote "",
  // the write was dropped, and the old template stayed on screen. Confirm
  // the DOM actually already shows `next` before skipping.
  if (next === lastEmittedValue && readHostAsText() === next) return;
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
  // The panel titles itself with the wildcard it is filtering — without it the
  // insert flow drops you into an unlabelled form one step after choosing from
  // a list of near-identical names.
  pickerWildcardName.value = props.uuidToName.get(uuid) ?? uuid;
  // Node snapshot wins over the library, exactly as `resolvePoolFor` decides
  // it for the hover card — so presence in the node map IS the origin.
  pickerPoolOrigin.value = contextPools?.value?.has(uuid)
    ? "node"
    : contextPools
      ? "library"
      : undefined;
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

/** Live re-anchor for the RemapRefPopup. The popup GROWS when the user
 *  picks a wildcard (the reconcile section + filter picker mount), so a
 *  one-shot measure isn't enough — a popup that fit below the chip at open
 *  can overflow the viewport after a pick. We measure the popup's REAL box
 *  and re-hug the chip: 6px below, flipping above only when the real height
 *  doesn't fit below; the top is clamped on-screen. Driven once on paint and
 *  again on every size change via a ResizeObserver. */
let remapResizeObs: ResizeObserver | null = null;

function anchorRemapToTrigger(el: HTMLElement): void {
  if (!pickerTriggerRect) return;
  const r = el.getBoundingClientRect();
  const gap = 6;
  const t = pickerTriggerRect;
  const spaceBelow = window.innerHeight - t.bottom;
  const flip = r.height > 0 && spaceBelow < r.height && t.top > spaceBelow;
  let top = flip ? t.top - r.height - gap : t.bottom + gap;
  let left = remapAnchor.value.left;
  if (r.height > 0) top = Math.max(8, Math.min(top, window.innerHeight - r.height - 8));
  if (r.width > 0) left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
  remapAnchor.value = { top, left };
}

function clampRemapIntoView(): void {
  void nextTick(() => {
    const el = document.querySelector("[data-test='remap-popup']") as HTMLElement | null;
    if (!el) return;
    anchorRemapToTrigger(el);
    // Re-anchor on growth (pick expands the reconcile section). Guarded for
    // jsdom, which has no ResizeObserver — the one-shot anchor above still runs.
    if (typeof ResizeObserver === "undefined") return;
    remapResizeObs?.disconnect();
    remapResizeObs = new ResizeObserver(() => anchorRemapToTrigger(el));
    remapResizeObs.observe(el);
  });
}

function teardownRemapObs(): void {
  remapResizeObs?.disconnect();
  remapResizeObs = null;
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
/** Row cap for the suggestion popover. Was 8 — with 100+ wildcards sharing
 *  near-identical display names, a query like `pose` silently truncated to
 *  the first 8 and the rest were UNREACHABLE: the popover's `max-height`
 *  never overflowed, so there was nothing to scroll and the feature read as
 *  "the scrollbar doesn't work". Raised so the list genuinely overflows and
 *  `overflow-y: auto` earns its keep; keyboard nav scrolls the active row
 *  into view via the `acActive` watcher below. */
const AC_MAX_ITEMS = 50;

/** Every hit, uncapped. Split out from `acItems` so the header can report how
 *  many entries actually matched rather than how many survived the cap — with
 *  a 50-row cap and a broad query the two differ, and "50 matches" for a query
 *  that hit 300 is simply false. */
const acMatches = computed(() => {
  if (!acOpen.value) return [];
  if (acTrigger.value === "tag") return [];  // tag rows live in `tagRows`
  if (acTrigger.value === "@" && !refsEnabled.value) return [];
  const pool = acTrigger.value === "@" ? props.refSuggestions : props.varSuggestions;
  const q = acQuery.value.toLowerCase();
  const labelOf = acTrigger.value === "@"
    ? (uuid: string) => (props.uuidToName.get(uuid) ?? uuid).toLowerCase()
    : (name: string) => name.toLowerCase();
  return pool.filter((id) => labelOf(id).includes(q));
});

const acItems = computed(() => acMatches.value.slice(0, AC_MAX_ITEMS));

/**
 * Render models for the popover, one per entry in `acItems`.
 *
 * Kept parallel to `acItems` rather than replacing it: every keyboard path
 * (`applyAutocomplete(acItems[acActive])`, the Tab/Enter handlers) indexes the
 * token list, and giving those a richer element to unwrap buys nothing.
 *
 * A `@` row is identified by what a wildcard actually is — its option count,
 * its axes, its tags — because the rows that send people here are the ones
 * whose NAMES are identical. A `$` row is identified by who writes it.
 */
/**
 * Inline colour for a row's icon box, keyed on the module kind.
 *
 * Inline rather than a class per kind because the kind set is open — the map
 * in `kind-icons.ts` already grew a `loop` and a `category` — and a missing
 * class would silently fall back to an uncoloured box. A missing TOKEN falls
 * back to the accent instead, which still looks deliberate.
 */
function kindTint(kind: string): Record<string, string> {
  const token = `--wp-kind-${kind === "fixed_values" ? "fixed" : kind}`;
  const colour = `var(${token}, var(--wp-accent-text, #c4b5fd))`;
  return {
    color: colour,
    background: `color-mix(in oklab, ${colour} 16%, transparent)`,
  };
}

/**
 * Tint for a `$` row, taken from the variable's own name.
 *
 * The assembler's variable strip sits a few pixels under this popover and
 * colours every name through `varColorClass` — same hash, eight buckets. The
 * popover painted each row by MODULE KIND instead, so the same `$quality` was
 * one colour in the list and another in the strip, and you could not match a
 * row to a chip by looking. `$` rows now take the variable's colour; `@` rows
 * keep `kindTint`, where the kind IS the identity of the thing being picked.
 *
 * The glyph shape still carries the kind, exactly as it does in the strip.
 */
function varTint(name: string): Record<string, string> {
  const colour = `var(--wp-var-${varColorIndex(name)})`;
  return {
    color: colour,
    background: `color-mix(in oklab, ${colour} 16%, transparent)`,
  };
}

/** Uuids this node supplies a pool for. `undefined` in the SPA, where the
 *  injection is absent and every ref necessarily reads the library. */
const nodePoolUuids = computed<ReadonlySet<string> | undefined>(() => {
  const pools = contextPools?.value;
  return pools ? new Set(pools.keys()) : undefined;
});

const acRows = computed<SuggestionRow[]>(() =>
  acTrigger.value === "@"
    ? refRows(acItems.value, {
        uuidToName: props.uuidToName,
        nodePoolUuids: nodePoolUuids.value,
        uuidToOptionsCount: props.uuidToOptionsCount,
        uuidToSubCategories: props.uuidToSubCategories,
        uuidToTagGroups: props.uuidToTagGroups,
      })
    : varRows(acItems.value, props.varProducers, props.graphAware),
);

watch(acItems, (items) => {
  if (acActive.value >= items.length) acActive.value = 0;
});

// Keep the keyboard-selected row visible. Without this, ArrowDown past the
// last VISIBLE row moved `acActive` but left the popover scrolled at the top,
// so the highlight vanished and the list looked frozen.
watch(acActive, (i) => {
  void nextTick(() => {
    const row = popoverEl.value?.querySelectorAll<HTMLElement>(".wp-rt-suggestions__item")[i];
    row?.scrollIntoView({ block: "nearest" });
  });
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
    // No `$` / `@` token at the caret — the only situation where booru tags
    // may be offered. This ordering IS the non-interference guarantee: the
    // sigil probe gets first refusal on every keystroke.
    if (tagAutocompleteEnabled.value) {
      // A model reference wins over the bare word. The caret inside
      // `<lora:…>` or after `embedding:` is unambiguously naming ONE kind, and
      // the bare-word probe cannot even describe what is being typed there —
      // its word class stops at the first dot, so a full filename searched for
      // whatever followed the last one.
      const ref = probeModelRef(rawText, rawCaret);
      if (ref && sourceOn(ref.kind)) {
        acOpen.value = true;
        acStart.value = ref.start;
        acQuery.value = ref.query;
        acTrigger.value = "tag";
        refKind.value = ref.kind;
        scheduleTagFetch(ref.query);
        positionPopup();
        return;
      }
      refKind.value = null;
      const word = probeTagWord(rawText, rawCaret);
      if (word && !triggerIsInsideChip(word.start)) {
        acOpen.value = true;
        acStart.value = word.start;
        acQuery.value = word.query;
        acTrigger.value = "tag";
        scheduleTagFetch(word.query);
        positionPopup();
        return;
      }
    }
    acOpen.value = false;
    tagRows.value = [];
    modelRows.value = {};
    return;
  }
  // A sigil token owns the caret from here on; drop any bare-word rows so a
  // stale list cannot be committed by an Enter meant for the sigil popover.
  tagRows.value = [];
  modelRows.value = {};
  // The trigger belongs to a chip that already exists — the user is not
  // filtering anything, so there is nothing to suggest. This fires whenever
  // the caret ends up flush against a chip's trailing edge: type a space after
  // `$style_fx`, delete it, and the caret lands there with the chip's own
  // serialised `$style_fx` sitting behind it in raw text. The probe cannot see
  // the difference; `triggerIsInsideChip` asks the DOM instead.
  if (triggerIsInsideChip(hit.start)) {
    acOpen.value = false;
    return;
  }
  // Gate `@` autocomplete — the wildcard surface always allows nested refs;
  // other surfaces opt in via `allowNestedRefs` (derivation action values,
  // which the engine resolves `@{}` on post-Layer-A).
  if (hit.trigger === "@" && !refsEnabled.value) {
    acOpen.value = false;
    return;
  }
  // Gate `$` autocomplete — wildcards don't use $var substitution at
  // runtime; only template surfaces (combine, derivation, assembler)
  // do. Blocking the popover in wildcard surface stops the user from
  // typing `$name` into an option value and ending up with a chip
  // that has no engine meaning.
  if (hit.trigger === "$" && !varsEnabled.value) {
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
/** Length contribution of a single host child to the raw-text space.
 *  Hoisted out of `rangeOffsetToRaw` so `chipRawSpans` measures chips the
 *  same way the caret mapping does — two copies of this would drift. */
function childRawLen(child: ChildNode): number {
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
}

/**
 * Raw-text `[start, end)` span of every rendered chip.
 *
 * A committed chip serialises back into raw text as the very thing the user
 * would have typed to create it (`$style_fx`), so the raw string alone cannot
 * tell "a finished chip" from "a token being typed". Only the DOM knows — a
 * chip is an atom element, in-progress text is not. These spans carry that
 * distinction into the raw coordinate space the probe works in.
 */
function chipRawSpans(): Array<[number, number]> {
  const host = hostEl.value;
  if (!host) return [];
  const spans: Array<[number, number]> = [];
  let offset = 0;
  for (const child of Array.from(host.childNodes)) {
    const len = childRawLen(child);
    if (
      child.nodeType === Node.ELEMENT_NODE
      && (child as HTMLElement).classList.contains("wp-refchip")
      && len > 0
    ) {
      spans.push([offset, offset + len]);
    }
    offset += len;
  }
  return spans;
}

/** True when the `$` / `@` the probe latched onto is part of an existing chip
 *  rather than something the user is typing. */
function triggerIsInsideChip(rawIndex: number): boolean {
  return chipRawSpans().some(([start, end]) => rawIndex >= start && rawIndex < end);
}

function rangeOffsetToRaw(targetNode: Node, targetOffset: number): number {
  const host = hostEl.value;
  if (!host || !host.contains(targetNode)) return readHostAsText().length;
  const charsBefore = (s: string, n: number): number =>
    s.slice(0, n).replace(ZWSP_RE, "").length;
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

/** Bottom-fade + grip-follow state. `hasMoreBelow` drives the fade — a capped
 *  box gives no other clue that it is hiding text. */
const {
  hasMoreBelow,
  updateOverflowHint,
  scheduleOverflowHint,
  attach,
  startResize,
} = useGrowableField(() => hostEl.value);

/* Overflow hint + grip-follow now come from the shared `useGrowableField`.
 * The fixed-values ValueRow had grown its own copy of the same three
 * behaviours, and the copies had already diverged — only this one cleared the
 * grip, only this one followed it off-screen. One implementation instead.
 *
 * No auto-grow here: this host sizes itself with `height: auto` + a CSS
 * `max-height`, so there is nothing for the composable's autosize to drive. */
onMounted(() => {
  scheduleOverflowHint();
  attach();
  // Only ask when the user has actually switched the feature on — an install
  // that never enables it makes no request at all.
  if (sourceOn("tag")) {
    void loadTagAvailability().then((status) => {
      tagListAvailable.value = status.available;
      tagHasCategories.value = status.hasCategories;
    });
  }
});

/** A host swap replaces the observed element, so the ResizeObserver has to
 *  follow it — otherwise the overflow fade and grip-follow silently stop
 *  working for the rest of the session on any field that ever had to repair
 *  its DOM. */
watch(hostEpoch, () => {
  void nextTick(() => {
    attach();
    scheduleOverflowHint();
  });
});

/** True when the live host has FEWER rendered atom nodes than `atoms.value`
 *  expects — i.e. the browser destroyed nodes Vue still holds `el` pointers
 *  for. Contenteditable hands the browser ownership of these children, and
 *  it replaces them wholesale on select-all + retype, IME commit, undo, and
 *  some paste paths; alt-tabbing mid-token then fires blur into a re-parse
 *  that patches over the wreckage.
 *
 *  Deliberately a `<` and not a `!==`: EXTRA top-level nodes are the normal
 *  typing case (browsers insert user-typed characters as raw text nodes
 *  directly under the host — see the padAtoms docblock) and must not trigger
 *  a remount, which would eat the caret mid-keystroke. Only destroyed nodes
 *  make the vdom unpatchable. */
function hostDomIsStale(): boolean {
  const host = hostEl.value;
  if (!host) return false;
  return host.querySelectorAll("[data-atom-index]").length < atoms.value.length;
}

/** True while every Fragment anchor Vue needs is still in the host.
 *
 *  Vue delimits each Fragment with two EMPTY TEXT NODES, and `<template
 *  v-for>` builds one Fragment per atom plus one for the list itself — so a
 *  healthy host holds `2N + 2` empty text nodes as direct children. They sit
 *  inside a contenteditable, which makes them the browser's to destroy:
 *  Firefox normalises empty text nodes away as the user types, Chromium keeps
 *  them. That difference is why every crash in this family has been
 *  Firefox-only.
 *
 *  Each anchor is load-bearing. Removing a list item walks `nextSibling` from
 *  its start anchor until it reaches its end anchor (`removeFragment`), and
 *  appending one inserts before the LIST's end anchor. With either gone the
 *  render throws — `nextSibling of null`, or `insertBefore: Child to insert
 *  before is not a child of this node` — and leaves a half-torn subtree that
 *  no longer responds to anything, Save and Cancel included.
 *
 *  `hostDomIsStale` cannot stand in for this: it counts `[data-atom-index]`
 *  ELEMENTS, and anchors are neither elements nor atoms.
 *
 *  Counts EMPTY text nodes only — characters the browser drops directly under
 *  the host are non-empty (see `reconcileOrphanTextNodes`), and a surplus is
 *  harmless, so the test is `>=`. */
function hostAnchorsIntact(): boolean {
  const host = hostEl.value;
  if (!host) return true;
  let empties = 0;
  for (const node of host.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node as Text).data === "") empties += 1;
  }
  return empties >= 2 * atoms.value.length + 2;
}

/** True when applying `next` would ADD or REMOVE atom nodes, or flip an atom
 *  between its chip and its text branch.
 *
 *  Those are exactly the renders that make Vue insert or unmount list items,
 *  and therefore the only ones that touch a fragment anchor. A same-shape
 *  apply patches text and props in place and cannot trip over a missing one,
 *  which is what keeps ordinary typing on the cheap path. */
function isStructuralApply(next: Atom[]): boolean {
  const cur = atoms.value;
  if (cur.length !== next.length) return true;
  return cur.some((atom, i) => (atom.kind === "text") !== (next[i].kind === "text"));
}

function applyAtoms(next: Atom[], opts?: { rebuild?: boolean }): void {
  // `rebuild` forces a full teardown+remount instead of an in-place patch.
  // Used ONLY on the structural-insert paths (autocomplete / ref-picker
  // apply): there the contenteditable already lost focus to the popover/modal,
  // so no live caret or typing is disturbed, AND the host DOM may have been
  // hand-mutated (orphan text nodes, in-place span textContent, fragment
  // anchors normalised away) out of sync with Vue's vdom. Patching the new
  // atom structure over that stale DOM is what throws `insertBefore: Child to
  // insert before is not a child of this node`.
  // The raw typing / Backspace paths deliberately do NOT rebuild — they keep
  // the imperative syncTextSpansToAtoms approach for caret stability (the
  // removed global renderTick churned those paths; this scopes it to inserts).
  //
  // Both routes go through the HOST ELEMENT swap, never a v-for re-key:
  // re-keying was verified NOT to help — the key churn still walks destroyed
  // els and missing `<template v-for>` fragment anchors and throws on
  // `nextSibling` of null. See the `hostEpoch` docblock.
  //
  // The third trigger is the general one, and the reason `rebuild` is no
  // longer load-bearing on its own: ANY apply that adds, removes or re-branches
  // an atom needs the fragment anchors, and the browser may have taken them.
  // Marking individual call sites `rebuild` was a whitelist, and the whitelist
  // kept missing entries — the ref picker, then Ctrl+A Ctrl+X, each crashing
  // the same way from a path nobody had flagged. Asking the DOM instead covers
  // all thirteen call sites at once, and costs nothing on Chromium, where the
  // anchors are never missing in the first place.
  const padded = padAtoms(next);
  if (
    hostDomIsStale() ||
    opts?.rebuild ||
    (isStructuralApply(padded) && !hostAnchorsIntact())
  ) {
    hostEpoch.value += 1;
  }
  atoms.value = padded;
  isEmpty.value = serialiseAtomsLocal(next).length === 0;
  void nextTick(() => {
    syncTextSpansToAtoms();
    scheduleOverflowHint();
  });
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
    // wp-rt__text spans + any defensive fallback: read live text. (Block
    // colour is re-derived from the post-edit text by `recolorBlocks`, so we
    // don't try to carry it through the flattened DOM read here.)
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

/** Re-derive brace-block scaffolding colour from the CURRENT serialised text,
 *  WITHOUT chipifying (chips are left exactly as-is, so Wave-5's "never
 *  chipify on delete" holds). Used after an atom-direct edit so the amber/green
 *  colour tracks the live text: a still-valid block keeps its colour, and
 *  breaking a block — deleting its `{`/`}`/`|` or the `$$` delimiter — drops it.
 *  Text atoms are split at block-token boundaries so a span straddling a block
 *  edge (the atom-direct read merges adjacent text) colours each side right. */
function recolorBlocks(list: Atom[]): Atom[] {
  const text = serialiseAtomsLocal(list);
  if (!text) return list;
  const colorAt: Array<"alt" | "multi" | null> = new Array(text.length).fill(null);
  for (const tok of tokenizeRich(text)) {
    const c = tok.kind === "dp-multi" ? "multi" : tok.kind === "dp-brace" ? "alt" : null;
    if (!c) continue;
    for (let k = tok.start; k < tok.end; k++) colorAt[k] = c;
  }
  const out: Atom[] = [];
  const pushText = (t: string, bc: "alt" | "multi" | null): void => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text" && (last.blockColor ?? null) === bc) {
      out[out.length - 1] = bc
        ? { kind: "text", text: last.text + t, blockColor: bc }
        : { kind: "text", text: last.text + t };
    } else {
      out.push(bc ? { kind: "text", text: t, blockColor: bc } : { kind: "text", text: t });
    }
  };
  let off = 0;
  for (const a of list) {
    const len = serialiseAtomsLocal([a]).length;
    if (a.kind === "text") {
      let i = 0;
      while (i < a.text.length) {
        const c = colorAt[off + i] ?? null;
        let j = i + 1;
        while (j < a.text.length && (colorAt[off + j] ?? null) === c) j++;
        pushText(a.text.slice(i, j), c);
        i = j;
      }
    } else {
      out.push(a);
    }
    off += len;
  }
  return out;
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
  // rebuild: this is a structural insert from a popover/modal (focus already
  // left the host), so remount the atom nodes fresh rather than patch over
  // the hand-mutated DOM — avoids the Vue insertBefore desync crash.
  applyAtoms(parseForSurface(newText), { rebuild: true });
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

/**
 * Splice a plain booru tag over the word being typed.
 *
 * Mirrors `insertChipAtCaret`'s raw-text splice but inserts TEXT, not a chip.
 * `$` and `@` commits build a chip because they carry engine meaning; a tag is
 * just characters in the prompt, so parsing the result yields plain text and
 * nothing renders as a pill.
 *
 * Deliberately not a branch inside `insertChipAtCaret`: that function's
 * defensive re-derivation scans backwards for a `$`/`@` run, which is exactly
 * wrong for a sigil-less word and would cut from the wrong place.
 */
function insertTagAtCursor(tag: string): void {
  const text = readHostAsText();
  const caret = currentCursorCharOffset();
  const from = acStart.value >= 0 ? Math.min(acStart.value, caret) : caret;
  const before = text.slice(0, from);
  const newText = before + tag + text.slice(caret);
  applyAtoms(parseForSurface(newText), { rebuild: true });
  emitValue(newText);
  const newCaret = (before + tag).length;
  acOpen.value = false;
  tagRows.value = [];
  modelRows.value = {};
  void nextTick(() => restoreCursorAtChar(newCaret));
}

/**
 * Insert plain text at the caret, adding a single separating space when
 * the character before the caret isn't already whitespace.
 *
 * Public API — the only function on this component meant to be driven from
 * outside. The assembler's chip strip is a SEPARATE widget on the same node,
 * so it cannot splice into this editor's DOM; before Vue Nodes it spliced
 * into the native `<textarea>` at `widget.inputEl`, which is now detached
 * and unrendered. Writing `widget.value` instead would work but replaces the
 * whole string and drops the caret.
 *
 * Deliberately does NOT consult `acStart` the way `insertTagAtCursor` does:
 * that one is completing a word the user is mid-way through typing and must
 * eat the typed prefix, whereas this one is a foreign insert and must not
 * eat anything. When the caret isn't inside the editor (never focused, or
 * focus is on the chip the user just clicked) `currentCursorCharOffset`
 * reports end-of-text, which gives an append.
 */
function insertTextAtCaret(text: string): void {
  const current = readHostAsText();
  const caret = currentCursorCharOffset();
  const before = current.slice(0, caret);
  const after = current.slice(caret);
  // Separate on BOTH sides. The trailing space is not cosmetic: inserting
  // `$mood` before the word `portrait` would otherwise yield `$moodportrait`,
  // which re-parses as a variable named `moodportrait` — the insert would
  // quietly change which variable it inserted.
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const insert = `${lead}${text}${trail}`;
  const next = before + insert + after;
  applyAtoms(parseForSurface(next), { rebuild: true });
  emitValue(next);
  // Caret sits after the token, before the trailing space, so the user can
  // keep typing the token rather than landing past a gap.
  void nextTick(() => restoreCursorAtChar(before.length + lead.length + text.length));
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

/**
 * Insert flow only: step back to the suggestion list.
 *
 * The typed `@query` is still sitting in the value — nothing is inserted until
 * apply or skip — so the popover can simply be reopened over it. Focus and the
 * caret have to be restored first: the picker took focus when it opened, and
 * without putting it back the popover reopens under a caret the browser has
 * moved to offset 0.
 */
function onPickerBack(): void {
  const restore = pendingInsertCaret.value?.caret ?? null;
  pendingInsert.value = null;
  pickerOpen.value = false;
  void nextTick(() => {
    hostEl.value?.focus();
    if (restore !== null) restoreCursorAtChar(restore);
    // `acStart` / `acQuery` / `acTrigger` were never cleared, so the list comes
    // back showing exactly what it showed before.
    acOpen.value = true;
    acActive.value = 0;
    positionPopup();
  });
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

function onChipRemap(idx: number, ev?: MouseEvent): void {
  const atom = atoms.value[idx];
  if (!atom || atom.kind !== "ref") return;
  remapOldUuid.value = atom.uuid;
  remapCachedName.value = atom.name ?? "";
  const { expr, excludeNull } = refFilterOf(atom);
  remapOldExpr.value = expr;
  remapOldExcludeNull.value = excludeNull;
  // Reuse the picker's anchor maths to position the remap popup at the chip.
  setPickerAnchorFromElement((ev?.currentTarget as HTMLElement | null) ?? null);
  // Seed just BELOW the chip (not the tall-picker flip seed) so the first
  // paint is already close — clampRemapIntoView then hugs it exactly using
  // the popup's real height. Avoids the one-frame high-flash.
  remapAnchor.value = {
    top: (pickerTriggerRect?.bottom ?? pickerAnchor.value.top) + 6,
    left: pickerAnchor.value.left,
  };
  remapOpen.value = true;
  clampRemapIntoView();
}

/** Rewrite EVERY occurrence of the dead uuid in THIS field's raw text once,
 *  per the spec's "Remap-everywhere scope" (walk root = the open module's
 *  payload — here the single field RichTextInput edits). */
function applyRemap(next: { uuid: string; name: string; subcatExpr: string; excludeNull: boolean }): void {
  const text = readHostAsText();
  const rewritten = rewriteBrokenRef(text, remapOldUuid.value, next);
  applyAtoms(parseForSurface(rewritten));
  emitValue(rewritten);
  remapOpen.value = false;
  teardownRemapObs();
}

function cancelRemap(): void {
  remapOpen.value = false;
  teardownRemapObs();
}

// Test seam — drive confirm without faking the popup click chain in jsdom.
function __confirmRemapForTest(
  oldUuid: string,
  next: { uuid: string; name: string; subcatExpr: string; excludeNull: boolean },
): void {
  remapOldUuid.value = oldUuid;
  applyRemap(next);
}

/**
 * Escape closes the picker — and stops there.
 *
 * The editor pages run a window-level Escape shortcut that cancels the whole
 * edit and routes back to the list. It opts out when focus sits in an
 * `input, textarea, [contenteditable]`, which covers the expression field but
 * NOT the picker's tag buttons — so pressing Escape after clicking a tag threw
 * away the edit and navigated away from the page. That is why it only happened
 * sometimes.
 *
 * Registered in the CAPTURE phase and stopping immediate propagation, so while
 * the picker is open it consumes the key before any bubble-phase window
 * listener sees it, whatever order they were registered in.
 */
function onPickerEscape(ev: KeyboardEvent): void {
  if (ev.key !== "Escape") return;
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();
  // The header says "Esc back" on the insert flow and "Esc cancel" on the
  // chip-edit flow, because there IS somewhere to go back to only in the first
  // case. Escape has to match what the header promises.
  if (pickerMode.value === "insert" && pendingInsert.value) onPickerBack();
  else cancelPicker();
}

watch(pickerOpen, (open) => {
  if (open) {
    window.addEventListener("keydown", onPickerEscape, true);
  } else {
    window.removeEventListener("keydown", onPickerEscape, true);
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

defineExpose({
  insertTextAtCaret,
  __triggerAutocompleteForTest,
  __applyAutocompleteForTest,
  __confirmRemapForTest,
});

function onSuggestionMouseDown(e: MouseEvent, label: string): void {
  // `mousedown` (not click) so we beat the textarea blur.
  e.preventDefault();
  applyAutocomplete(label);
}

// --- Global listeners: close popup on outside-click / scroll / resize.
//     We attach lazily (only while open) so non-editing inputs cost nothing.

/**
 * Close on any press that lands outside the input and outside the popover.
 *
 * Bound to `pointerdown` as well as `mousedown`, and that is the whole point:
 * `mousedown` alone did not dismiss on canvas clicks. litegraph drives the
 * canvas from pointer events and calls `preventDefault()` on `pointerdown` to
 * suppress native text-selection and drag — and a prevented `pointerdown`
 * suppresses the browser's compatibility `mousedown` entirely, so a
 * mousedown-only listener never hears the click that matters. The canvas is
 * most of the screen on a node graph, so this read as "the popover never
 * closes".
 *
 * `pointerdown` fires first and nothing downstream can take it away. Both are
 * kept: `mousedown` is the fallback for environments with no PointerEvent
 * (jsdom under test, older embedded webviews). Closing twice is idempotent.
 *
 * Ordering is safe for suggestion rows. They commit on `mousedown` (to beat
 * the host's blur), and this handler returns early for anything inside the
 * popover, so firing before them changes nothing.
 */
function onDocumentPressStart(e: Event): void {
  const t = e.target as Node | null;
  if (!t) return;
  if (hostEl.value?.contains(t)) return;
  if (popoverEl.value?.contains(t)) return;
  acOpen.value = false;
}
function onWindowScroll(e: Event): void {
  // Scrolling INSIDE the popover is the user reading the list — wheeling over
  // it, or dragging its scrollbar. This listener is capture-phase on window,
  // so those scrolls used to land here and close the popover outright: the
  // list had a scrollbar that could not be used, and a scrollbar drag left a
  // half-typed reference behind. Ignore them.
  const t = e.target as Node | null;
  if (t && popoverEl.value?.contains(t)) return;
  // The popover IS the scroll target when the wheel lands on it directly
  // (target is the element, not a descendant).
  if (t && t === popoverEl.value) return;
  // A genuine outside scroll moved the anchor. Re-anchor rather than close —
  // `positionPopup` recomputes from the host's live rect, so the popover
  // simply follows the input instead of destroying the user's in-progress
  // token. Matches the injector menu + VarAutocompleteInput behaviour.
  positionPopup();
}
function onWindowResize(): void {
  if (acOpen.value) positionPopup();
}

watch(acOpen, (open) => {
  if (open) {
    void nextTick(positionPopup);
    window.addEventListener("pointerdown", onDocumentPressStart, true);
    window.addEventListener("mousedown", onDocumentPressStart, true);
    window.addEventListener("scroll", onWindowScroll, true);
    window.addEventListener("resize", onWindowResize);
  } else {
    window.removeEventListener("pointerdown", onDocumentPressStart, true);
    window.removeEventListener("mousedown", onDocumentPressStart, true);
    window.removeEventListener("scroll", onWindowScroll, true);
    window.removeEventListener("resize", onWindowResize);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", onDocumentPressStart, true);
  window.removeEventListener("mousedown", onDocumentPressStart, true);
  window.removeEventListener("scroll", onWindowScroll, true);
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener("keydown", onPickerEscape, true);
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
  isEmpty.value = next.length === 0;
  // The browser can delete the atom spans outright, not just their text: any
  // edit against a selection anchored on the HOST (Ctrl+A then type, and
  // anything else that replaces the whole field) takes the `wp-rt__text`
  // elements with it. What is left still accepts typing, but no atom span
  // exists to hold it, so nothing chips, nothing colours, and Vue's vnodes
  // point at detached nodes until some later patch throws on them.
  //
  // `applyAtoms` already knows how to repair that — it swaps the host element
  // when the DOM has gone stale — but nothing reached it from here, because
  // typing deliberately does not re-apply atoms (that is what keeps the caret
  // stable). Re-apply only when the structure is actually gone.
  if (hostDomIsStale()) {
    const caret = currentCursorCharOffset();
    applyAtoms(parseForSurface(next));
    if (next !== props.modelValue) emitValue(next);
    void nextTick(() => restoreCursorAtChar(caret));
    return;
  }
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
  // A RANGE, not a caret: the browser is about to replace it, and that is
  // correct. Redirecting here would collapse it, so the replacement never
  // happened and the typed character was merely inserted — select-all then
  // type one letter over `yellow` left `yellowy` instead of `y`. This rescue
  // exists only for a collapsed caret stranded outside a text span.
  if (!range.collapsed) return;
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
  if (!positioned && !positionFromHostIndex(target, range.startOffset, newRange)) {
    // Nothing adjacent and nothing positional — land at the end of the last
    // span, which is where an unanchored caret most plausibly belongs.
    const spans = host.querySelectorAll(".wp-rt__text");
    if (spans.length === 0) return;
    setCaretAtSpanEdge(spans[spans.length - 1] as HTMLElement, "end", newRange);
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
/**
 * Put `range` at one edge of `span`, walking to a real text node.
 *
 * With coloured sub-spans inside `wp-rt__text` (`<span class="wp-rt-dp-brace">`
 * and friends), `firstChild` / `lastChild` are not guaranteed to be text
 * nodes, and placing the caret on the span ELEMENT at offset 0 drops typing in
 * front of the whole brace block instead of inside it.
 */
function setCaretAtSpanEdge(span: HTMLElement, edge: "start" | "end", range: Range): void {
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  if (edge === "start") {
    const first = walker.nextNode() as Text | null;
    if (first) range.setStart(first, 0);
    else range.setStart(span, 0);
    return;
  }
  let last: Text | null = null;
  let n: Node | null = walker.nextNode();
  while (n) {
    last = n as Text;
    n = walker.nextNode();
  }
  if (last) range.setStart(last, (last.textContent ?? "").length);
  else range.setStart(span, 0);
}

/**
 * Redirect a caret that is sitting on the host root into the span it is
 * actually next to.
 *
 * Pressing Home, or clicking at the very start of the field, leaves the
 * selection on the host itself rather than inside a `wp-rt__text` span —
 * Firefox in particular parks it there, between the empty text nodes Vue
 * leaves around fragment markers. The old fallback then sent the caret to the
 * END of the LAST span, so a character typed at position 0 was inserted at the
 * end of the value: typing `{` in front of `skirt` produced `skirt{`.
 *
 * On the host root the offset is a CHILD INDEX, so it says exactly where the
 * caret is. Scan forward from it for a span and land at that span's start;
 * only when there is nothing after it does the end of the preceding span
 * become the right answer.
 */
function positionFromHostIndex(target: Node, offset: number, range: Range): boolean {
  const host = hostEl.value;
  if (!host) return false;
  // Either the caret is on the host, or in one of the empty text nodes that
  // sit directly under it — in which case its own index is what matters, not
  // the offset inside a node with no content.
  let index: number;
  if (target === host) {
    index = offset;
  } else if (target.parentNode === host) {
    index = Array.prototype.indexOf.call(host.childNodes, target);
    // A caret PAST the content of a non-empty node belongs after it.
    if (offset > 0) index += 1;
  } else {
    return false;
  }
  if (index < 0) return false;

  const isTextSpan = (n: Node | null): n is HTMLElement =>
    !!n && n.nodeType === Node.ELEMENT_NODE
    && (n as HTMLElement).classList.contains("wp-rt__text");

  for (let i = index; i < host.childNodes.length; i++) {
    if (isTextSpan(host.childNodes[i])) {
      setCaretAtSpanEdge(host.childNodes[i] as HTMLElement, "start", range);
      return true;
    }
  }
  for (let i = Math.min(index, host.childNodes.length) - 1; i >= 0; i--) {
    if (isTextSpan(host.childNodes[i])) {
      setCaretAtSpanEdge(host.childNodes[i] as HTMLElement, "end", range);
      return true;
    }
  }
  return false;
}

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
/**
 * The raw source text currently selected — `@{uuid}` and `$name` in their
 * serialised form, not the chip's rendered label.
 *
 * `readHostAsText()` is the source of truth for the value, and the selection
 * offsets are already expressed against it, so slicing it keeps copy, cut and
 * paste all speaking the same language.
 */
function selectedRawText(): { text: string; start: number; end: number } {
  const all = readHostAsText();
  const { start, end } = currentSelectionRangeRaw();
  return { text: all.slice(start, end), start, end };
}

/**
 * Copy the SOURCE of the selection, not what the chips happen to render.
 *
 * A ref chip's DOM text is its display label — for an unresolved ref, nothing
 * at all — so the browser's own copy turned `red @{955bb6fa} tail` into
 * `red  tail` and the ref was silently dropped on paste. Measured: copying a
 * value with one chip and pasting it back lost the chip every time.
 */
function onHostCopy(ev: ClipboardEvent): void {
  if (props.disabled) return;
  const { text } = selectedRawText();
  if (!text) return;
  ev.clipboardData?.setData("text/plain", text);
  ev.preventDefault();
}

/**
 * Cut, done through the atom model instead of by the browser.
 *
 * Left to the browser this was the single most destructive interaction in the
 * editor. A Ctrl+A selection is anchored on the HOST element, so the deletion
 * removed the `wp-rt__text` spans themselves — the elements Vue's vnodes point
 * at. The field was left with zero spans: still typeable, but nothing chipped,
 * nothing coloured, and the vdom referencing detached nodes, which is what
 * produced `insertBefore: Child to insert before is not a child of this node`
 * on a later patch and left the page unable to respond to anything.
 *
 * Routing it through `applyAtoms` keeps the structure Vue's, exactly as paste
 * already did.
 */
function onHostCut(ev: ClipboardEvent): void {
  if (props.disabled) return;
  const all = readHostAsText();
  const { text, start, end } = selectedRawText();
  if (!text) return;
  ev.clipboardData?.setData("text/plain", text);
  ev.preventDefault();
  const remainder = all.slice(0, start) + all.slice(end);
  applyAtoms(parseForSurface(remainder));
  emitValue(remainder);
  void nextTick(() => restoreCursorAtChar(start));
}

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
    if (acTrigger.value === "tag") {
      const row = wordRows.value[acActive.value];
      if (row) {
        ev.preventDefault();
        insertTagAtCursor(wordRowText(row) + committedSuffix());
        return;
      }
      // Nothing to commit — close and let Enter behave natively rather than
      // swallowing a newline the user actually wanted.
      acOpen.value = false;
      return;
    }
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
    acActive.value = Math.min(acRowCount.value - 1, acActive.value + 1);
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
      // Caret at the absolute start — nothing to delete. MUST preventDefault
      // even though there's no work: a bare `return` lets the browser run its
      // native deleteContentBackward, which EATS the ZWSP pad char in the
      // empty/leading text span. Losing the ZWSP strands the caret on the host
      // root and the DOM permanently diverges from the atoms model (the
      // "can't delete / stuck $#" corruption). Blocking the native delete
      // keeps the pad intact.
      if (range.start === 0) {
        ev.preventDefault();
        return;
      }
      delStart = range.start - 1;
      delEnd = range.start;
    }
    ev.preventDefault();
    const { atoms: nextAtoms, caret } = deleteRawRange(readHostAsAtoms(), delStart, delEnd);
    applyAtoms(recolorBlocks(nextAtoms));
    emitValue(serialiseAtomsLocal(atoms.value));
    void nextTick(() => {
      restoreCursorAtChar(caret);
      // Re-probe AFTER the caret is back. `preventDefault` above suppressed the
      // native delete, so no `input` event fires and `onHostInput` — the only
      // other caller of this — never runs. Without it `acQuery` keeps its
      // pre-deletion value and the suggestion list stays frozen at whatever it
      // narrowed to: type `@act_` to two matches, delete the `_`, and `@act`
      // still shows two instead of four.
      // A SECOND tick: `restoreCursorAtChar` ends with `host.focus()`, and
      // `onHostFocus` schedules its own nextTick that can reposition the
      // caret. Probing in this tick reads the pre-settled caret (offset 0) and
      // the probe returns null, closing the popover instead of re-filtering.
      void nextTick(refreshAutocompleteFromHost);
    });
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
      // Caret at the absolute end — nothing forward. preventDefault for the
      // same reason as Backspace-at-start: a bare return lets native
      // deleteContentForward eat the trailing ZWSP pad and corrupt the field.
      if (range.start >= totalLen) {
        ev.preventDefault();
        return;
      }
      delStart = range.start;
      delEnd = range.start + 1;
    }
    ev.preventDefault();
    const { atoms: nextAtoms, caret } = deleteRawRange(live, delStart, delEnd);
    applyAtoms(recolorBlocks(nextAtoms));
    emitValue(serialiseAtomsLocal(atoms.value));
    void nextTick(() => {
      restoreCursorAtChar(caret);
      // Same reason as the Backspace branch — forward-delete is also
      // `preventDefault`ed, so nothing else re-probes the query.
      // A SECOND tick: `restoreCursorAtChar` ends with `host.focus()`, and
      // `onHostFocus` schedules its own nextTick that can reposition the
      // caret. Probing in this tick reads the pre-settled caret (offset 0) and
      // the probe returns null, closing the popover instead of re-filtering.
      void nextTick(refreshAutocompleteFromHost);
    });
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
      hasMoreBelow ? 'wp-rt--more' : null,
      fill ? 'wp-rt--fill' : null,
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
      :key="hostEpoch"
      class="wp-rt__host"
      :class="[
        multiline ? 'wp-rt__host--multi' : 'wp-rt__host--single',
        { 'wp-rt__host--wrap': wrap && !multiline, 'wp-rt__host--empty': isEmpty },
      ]"
      :contenteditable="!disabled"
      @scroll="updateOverflowHint"
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
      @copy="onHostCopy"
      @cut="onHostCut"
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
          :in-scope="atom.kind === 'var' && varSuggestions.includes(atom.name)"
          :producer="atom.kind === 'var' ? varProducers?.get(atom.name) : undefined"
          :graph-aware="graphAware"
          :index="atom.kind === 'var' ? atom.index : undefined"
          :data-atom-index="idx"
          remappable
          @click="(ev: MouseEvent) => onChipClick(idx, ev)"
          @remap="(ev: MouseEvent) => onChipRemap(idx, ev)"
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

    <!-- Resize grip, replacing `resize: vertical`.
         The native resizer recomputes height from an origin it captured at
         pointerdown and never clamps to the element's own min/max, so dragging
         past a limit banks invisible travel the user then has to walk all the
         way back before anything moves — measured at 13 of 23 dead frames.
         Ours applies each move's DELTA to the current height, so the first
         pixel back off a limit moves the box. -->
    <div
      v-if="(wrap || multiline) && !fill"
      class="wp-rt__grip"
      data-test="rt-grip"
      aria-hidden="true"
      @pointerdown="startResize"
    ></div>

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
        v-if="acOpen && acRowCount > 0"
        ref="popoverEl"
        class="wp-rt-suggestions"
        :class="[teleportThemeClass(), { 'wp-rt-suggestions--up': popupPos.flipped }]"
        :data-stale="rowsStale ? '' : null"
        :style="{
          top: popupPos.top + 'px',
          left: popupPos.left + 'px',
          minWidth: popupPos.width + 'px',
        }"
        role="listbox"
      >
        <div v-if="acTrigger === 'tag'" class="wp-rt-suggestions__head">
          <span class="wp-rt-suggestions__query">{{ acQuery }}</span>
          <!-- Says WHICH autocomplete this is. Without a sigil in the query
               there is otherwise nothing distinguishing it from the `$` / `@`
               popover, which looks identical and behaves differently. -->
          <span class="wp-rt-suggestions__src">{{ wordSections.map((s) => s.label).join(" · ") }}</span>
          <span class="wp-rt-suggestions__count">{{ wordRows.length }}</span>
          <!-- Names the one thing the rows cannot: that they are not for what
               is currently typed. Without it the reflow when results land
               reads as the list glitching. -->
          <span v-if="rowsStale" class="wp-rt-suggestions__stale">searching…</span>
          <span class="wp-spacer" />
          <span class="wp-rt-suggestions__hint">↑↓ · Enter · Esc</span>
        </div>
        <template v-if="acTrigger === 'tag'">
          <!-- Sections, because the sources have no common ranking key: a tag
               ranks by post count in the tens of thousands, a model has no
               count at all. Any single ordering has to invent a comparison
               between "12,000 posts" and "a file on disk", and tags win it on
               weight of numbers every time.

               `entry.index` is the row's position in the FLAT `wordRows`, which
               is what `acActive` indexes. Headers are not in that array, so
               arrow-key navigation cannot land on one — no skip logic needed. -->
          <template v-for="section in wordSections" :key="section.source">
            <div
              v-if="wordSections.length > 1"
              class="wp-rt-suggestions__section"
            >
              <i :class="SOURCE_ICON[section.source]" aria-hidden="true" />{{ section.label }}
            </div>
            <button
              v-for="entry in section.rows"
              :key="section.source + ':' + (entry.row.source === 'tag' ? entry.row.tag.matched : entry.row.model.path)"
              type="button"
              class="wp-rt-suggestions__item wp-rt-tag"
              :data-active="entry.index === acActive ? '' : null"
              role="option"
              :aria-selected="entry.index === acActive"
              @mousedown.prevent="insertTagAtCursor(wordRowText(entry.row) + committedSuffix())"
              @mouseenter="acActive = entry.index"
            >
              <template v-if="entry.row.source !== 'tag'">
                <span class="wp-rt-tag__cat" :class="`wp-rt-tag__cat--${entry.row.source}`">
                  <i :class="SOURCE_ICON[entry.row.source]" aria-hidden="true" />
                </span>
                <span class="wp-rt-tag__body">
                  <span class="wp-rt-tag__name">{{ entry.row.model.name }}</span>
                  <!-- The folder is the only thing separating two files with
                       the same name, and the insert uses the full path. -->
                  <span v-if="entry.row.model.folder" class="wp-rt-tag__sub">
                    {{ entry.row.model.folder }}
                  </span>
                </span>
              </template>
              <template v-else>
                <!-- Colour bar only when the loaded file HAS categories. A
                     two-column list would otherwise show a column of identical
                     grey bars explaining nothing. -->
                <!-- `pi-tags` (plural) deliberately: `pi-tag` singular is
                     already the fixed_values module kind, so a booru tag row
                     would have rendered identically to a library module.
                     Tinted by category, so this one slot says both "this is a
                     tag" and "of this kind". -->
                <span
                  v-if="tagHasCategories"
                  class="wp-rt-tag__cat"
                  :class="entry.row.tag.category_name ? `wp-rt-tag__cat--${entry.row.tag.category_name}` : null"
                ><i class="pi pi-tags" aria-hidden="true" /></span>
                <span class="wp-rt-tag__body">
                  <!-- Always the tag that will be INSERTED, never the alias
                       that matched. Enter must put exactly this on screen. -->
                  <span class="wp-rt-tag__name">{{ entry.row.tag.name }}</span>
                  <span v-if="entry.row.tag.matched !== entry.row.tag.name" class="wp-rt-tag__sub">
                    from <span class="wp-rt-tag__alias">{{ entry.row.tag.matched }}</span>
                  </span>
                  <span
                    v-else-if="tagHasCategories && entry.row.tag.category_name"
                    class="wp-rt-tag__sub"
                  >{{ entry.row.tag.category_name }}</span>
                </span>
                <span class="wp-rt-tag__count">{{ formatTagCount(entry.row.tag.count) }}</span>
              </template>
            </button>
          </template>
          <div v-if="tagLegend.length" class="wp-rt-tag__legend">
            <span v-for="cat in tagLegend" :key="cat">
              <i class="pi pi-tags wp-rt-tag__swatch" :class="`wp-rt-tag__cat--${cat}`" aria-hidden="true" />{{ cat }}
            </span>
          </div>
        </template>
        <div v-else class="wp-rt-suggestions__head">
          <span class="wp-rt-suggestions__query">{{ acTrigger }}{{ acQuery }}</span>
          <!-- The match count belongs in the header, not implied by the list
               length: the list is capped and scrolls, so "how many did I
               actually match" is otherwise unanswerable without scrolling.
               Counts MATCHES, not rendered rows — and says so when the cap
               hid some, since a silent truncation is how you conclude the
               wildcard you are looking for does not exist. -->
          <span class="wp-rt-suggestions__count">
            {{ acMatches.length }} match{{ acMatches.length === 1 ? "" : "es" }}
            <template v-if="acMatches.length > acRows.length">
              · showing {{ acRows.length }}
            </template>
          </span>
          <span class="wp-spacer" />
          <!-- Says what the keys actually do. Choosing an `@` row goes on to
               the filter panel rather than inserting a bare ref, so Enter is
               labelled for where it leads. -->
          <span class="wp-rt-suggestions__hint">↑↓ · {{ acTrigger === "@" ? "Enter filter" : "Enter" }} · Esc</span>
        </div>
        <button
          v-for="(row, i) in (acTrigger === 'tag' ? [] : acRows)"
          :key="row.token"
          type="button"
          class="wp-rt-suggestions__item"
          :data-active="i === acActive ? '' : null"
          role="option"
          :aria-selected="i === acActive"
          @mousedown="(e) => onSuggestionMouseDown(e, row.token)"
          @mouseenter="acActive = i"
        >
          <!-- The glyph sits in a tinted box in its OWN kind's colour. A `$var`
               can be written by a fixed_values or a combine as easily as by a
               wildcard, and painting every row accent-violet throws away the
               one cue that says which. -->
          <span
            class="wp-rt-suggestions__icon-box"
            :style="acTrigger === '$' ? varTint(row.label) : kindTint(row.kind)"
            aria-hidden="true"
          ><i :class="row.icon" /></span>
          <span class="wp-rt-suggestions__body">
            <span
              class="wp-rt-suggestions__label"
              :class="acTrigger === '$' ? varColorClass(row.label) : null"
            >
              <span class="wp-rt-suggestions__trigger">{{ acTrigger }}</span>{{ row.label }}
            </span>
            <!-- Second line: the facts that separate same-named entries. For
                 `@` these are structural (options/axes/tags); for `$` it is
                 the writer. Either way the row answers "which one is this?"
                 without the user having to insert it and find out. -->
            <span v-if="row.uuid || row.facts.length || row.producer" class="wp-rt-suggestions__sub">
              <span v-if="row.uuid" class="wp-rt-suggestions__uuid">{{ row.uuid }}</span>
              <template v-if="row.producer">
                <span v-if="row.producer.verb">{{ row.producer.verb }}</span>
                <!-- The module name is the identifying half of the sentence,
                     so it is the part that gets picked out. -->
                <span v-if="row.producer.moduleName" class="wp-rt-suggestions__by">
                  {{ row.producer.moduleName }}
                </span>
                <span v-if="row.producer.moduleName && row.producer.tail" class="wp-rt-suggestions__sep">·</span>
                <span v-if="row.producer.tail" class="wp-rt-suggestions__node">{{ row.producer.tail }}</span>
              </template>
              <span
                v-for="fact in row.facts"
                :key="fact"
                class="wp-rt-suggestions__fact"
              >{{ fact }}</span>
              <!-- Same mark the chip and the filter header carry, so "this is
                   the node's copy" reads identically wherever it appears. -->
              <span
                v-if="row.fromNode"
                class="wp-rt-suggestions__origin"
                data-test="suggestion-origin-node"
              ><i class="pi pi-database" aria-hidden="true" /> this node</span>
              <span v-if="row.badge" class="wp-rt-suggestions__badge">{{ row.badge }}</span>
              <span v-if="row.internal" class="wp-rt-suggestions__internal">internal</span>
            </span>
          </span>
          <!-- Funnel marks the rows that lead to a filter — i.e. the ones
               whose wildcard declares tags to filter by. Shown on the active
               row only: on every row it becomes a column of noise, and the
               next step applies to the row you are on. -->
          <i
            v-if="row.filterable && i === acActive"
            class="pi pi-filter wp-rt-suggestions__funnel"
            aria-hidden="true"
          />
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
      <div class="wp-subcat-picker__backdrop" :class="teleportThemeClass()" @click="cancelPicker"></div>
      <div
        class="wp-subcat-picker__anchor"
        :class="[teleportThemeClass(), { 'wp-subcat-picker__anchor--flipped': pickerAnchor.flipped }]"
        :style="{
          top: pickerAnchor.top + 'px',
          left: pickerAnchor.left + 'px',
        }"
        @click.stop
      >
        <SubcategoryFilterPicker
          :wildcard-name="pickerWildcardName"
          :pool-origin="pickerPoolOrigin"
          :sub-categories="pickerSubCats"
          :tag-groups="pickerTagGroups"
          :option-tag-sets="pickerOptionTagSets"
          :initial-expr="pickerInitialExpr"
          :initial-exclude-null="pickerInitialExcludeNull"
          :mode="pickerMode"
          :has-null-option="pickerHasNull"
          @apply="onPickerApply"
          @back="onPickerBack"
          @skip="onPickerSkip"
          @delete="onPickerDelete"
        />
      </div>
    </Teleport>

    <RemapRefPopup
      v-if="remapOpen"
      :old-uuid="remapOldUuid"
      :cached-name="remapCachedName"
      :ref-data="remapRefData"
      :old-expr="remapOldExpr"
      :old-exclude-null="remapOldExcludeNull"
      :anchor="remapAnchor"
      @confirm="applyRemap"
      @cancel="cancelRemap"
    />
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
/* "More below" hint — a capped box otherwise looks identical whether it holds
   its whole value or a third of it. Deliberately restrained: a short fade to
   the field's own background, lifted with a touch of accent so the eye catches
   it, and `pointer-events: none` so it never intercepts a click or a caret
   placement near the bottom edge. Clears the moment the user scrolls to the
   end. */
.wp-rt--more::after {
  content: "";
  position: absolute;
  /* Left edge is full-bleed — a 1px inset left a visible seam where the band
     stopped short of the border; the wrapper's `overflow: hidden` + radius
     clip that side cleanly instead.
     The RIGHT edge stops short of the resize grip. The band is exactly as tall
     as the grip and sat right on top of it, so a resizable field's handle was
     invisible: users aimed, missed, re-grabbed, and read it as "the drag
     sticks then starts working". `pointer-events: none` meant it never
     actually blocked the drag — it just hid the target. */
  inset: auto 16px 0 0;
  height: 16px;
  pointer-events: none;
  /* Gradient to a TRANSPARENT accent, not to a blend with the background: the
     text keeps showing through instead of being washed out, while the tint
     stays chromatic enough to notice. The 1px inset line at the very bottom is
     what actually catches the eye. */
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 26%, transparent)
  );
  box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 60%, transparent);
}

/* Sits in the bottom-right corner the overflow fade leaves clear. Drawn like
   the native grip so it reads as the same affordance it replaces. */
.wp-rt__grip {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: ns-resize;
  z-index: 2;
  background: repeating-linear-gradient(
    135deg,
    transparent 0 2px,
    var(--wp-text-dim, #8a8a9a) 2px 3px
  );
  /* Clipped to a bottom-right triangle so the hatching runs parallel to the
     hypotenuse — the shape the browser's own resizer draws, which is what
     users already read as "drag me". A filled square read as a button. */
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
  opacity: 0.55;
}
.wp-rt__grip:hover { opacity: 0.9; }

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
  /* A text field must look like one. Nothing here ever set a cursor, so the
     host inherited whatever the surrounding chrome used — and on the canvas
     that is ComfyUI's node wrapper, which carries `cursor-grab` for dragging
     the node. The result was a grab hand over an editable field, which reads
     as "you cannot type here". Inherited, so it never showed up in the SPA. */
  cursor: text;
  /* Anchor for the absolutely-positioned placeholder ghost (below). */
  position: relative;
}
/* Read-only because a link drives the value — an I-beam would promise editing
   that will not happen. */
.wp-rt__host[contenteditable="false"] {
  cursor: default;
}
.wp-rt__host--single {
  height: var(--wp-input-h, 34px);
  padding: 0 var(--wp-space-5);
  line-height: var(--wp-input-h, 34px);
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
}
/* Opt-in wrap+auto-grow for single-value surfaces (prop `wrap`). Overrides
   the single-line clip: the value WRAPS onto multiple lines and the box
   grows to fit (min = one row, capped at 40vh then scrolls). `resize:
   vertical` gives a manual drag handle — its grip renders inside the host
   box, so the wrapper's `overflow:hidden` doesn't clip it. Compound
   selector so it beats `--single` regardless of source order. */
.wp-rt__host--single.wp-rt__host--wrap {
  height: auto;
  min-height: var(--wp-input-h, 34px);
  /* 40vh let one field eat half the viewport before it ever scrolled, which
     pushed every control below it off-screen. 12rem (~7 lines) is enough to
     read a long value at a glance; past that the box scrolls AND keeps its
     `resize: vertical` handle, so anyone who wants more just drags it. */
  max-height: 12rem;
  padding: 6px var(--wp-space-5);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: hidden;
  overflow-y: auto;
  /* Stop the scroll chaining to the page. Without this, scrolling a capped
     field and reaching either end hands the remaining delta to the ancestor —
     so the modal (or the whole editor) lurches while the user is still
     pointing at the field. Most noticeable at the TOP edge, where a small
     upward flick past the first line jumps the page. */
  overscroll-behavior: contain;
}
/* Keep the placeholder ghost aligned with wrapped text (top-left, not
   vertically centered on the 34px single-line). */
.wp-rt__host--single.wp-rt__host--wrap.wp-rt__host--empty::before {
  line-height: 1.6;
}
/* ── Fill mode ────────────────────────────────────────────────────────────
 *
 * The node owns the height; we take what we are given and scroll the rest.
 *
 * `min-height: 0` on both the root and the host is the load-bearing part. Both
 * are flex items, and a flex item defaults to `min-height: auto`, which refuses
 * to shrink below its content — so the template pushed the box, which pushed
 * the node, which is the auto-scaling this mode exists to stop. Measured on the
 * debug widget: without it the node inflated from 300 to 870 to fit its
 * payload and could not be dragged shorter.
 *
 * `max-height: none` because the 14rem cap below is there to bound AUTO-growth.
 * Nothing auto-grows here, and keeping it would cap the box well short of a
 * node the user deliberately dragged tall.
 */
.wp-rt--fill {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.wp-rt--fill .wp-rt__host {
  flex: 1 1 0%;
  min-height: 0;
  max-height: none;
  height: auto;
  overflow-y: auto;
}

.wp-rt__host--multi {
  padding: var(--wp-space-4) var(--wp-space-5);
  line-height: 1.9;
  min-height: 72px;
  /* Cap + scroll, matching `--wrap`. Uncapped, pasting a paragraph grew the
     box to thousands of pixels and pushed every control below it off-screen. */
  max-height: 14rem;
  overflow-y: auto;
  /* Same containment as `--wrap` — see the note there. */
  overscroll-behavior: contain;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Placeholder ghost — shown when the field has no content. Gated on the
   `--empty` class (NOT `:empty`): the host always holds a ZWSP pad span, so
   `:empty` never matches. The class tracks live content so the ghost clears
   on the first keystroke, matching `<input placeholder>`. */
.wp-rt__host--empty::before {
  content: attr(data-placeholder);
  /* Overlay the host's text area so the caret stays at the start (the host
     still holds a ZWSP pad span); `padding: inherit` matches the single/multi
     text inset so the ghost aligns with where real text would begin. */
  position: absolute;
  inset: 0;
  padding: inherit;
  color: var(--wp-text-dim, #6e6e7c);
  pointer-events: none;
  white-space: pre-wrap;
  overflow: hidden;
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
  /* POPOVER tier — above every modal overlay (9999 ModalShell … 10010
     InjectorBindingModal). At 9999 this only cleared modals that were also
     9999, winning on DOM order; inside a 10000+ modal it rendered behind. */
  z-index: 10020;
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
.wp-rt-suggestions__count {
  font-family: var(--wp-font, system-ui, sans-serif);
  opacity: 0.75;
}
/* Two lines per row now, so `align-items: center` would float the icon
   against the name rather than the row. `flex-start` plus a top offset on the
   icon lines it up with the FIRST line's text, which is where the eye is. */
/* Pinned while the rows scroll underneath. `overflow-y: auto` lives on the
   popover root, so without this the header scrolls out of view and the query
   you are refining disappears — true for the `$`/`@` popover too, and fixed
   for both here. The negative margins cancel the root's horizontal padding so
   the pinned bands span the full width instead of leaving a transparent gutter
   for rows to show through. */
.wp-rt-suggestions__head,
.wp-rt-tag__legend {
  position: sticky;
  z-index: 1;
  background: var(--wp-bg-1, #11111b);
  margin: 0 calc(-1 * var(--wp-space-2));
  padding-left: var(--wp-space-2);
  padding-right: var(--wp-space-2);
}

.wp-rt-suggestions__head { top: 0; }

.wp-rt-tag__legend {
  /* Pulled down over the root's `padding-bottom`. At `bottom: 0` the legend
     sticks to the content box and that padding stays transparent below it, so
     a scrolling row was visible underneath the legend band. */
  bottom: calc(-1 * var(--wp-space-2));
  margin-bottom: calc(-1 * var(--wp-space-2));
  padding-bottom: calc(var(--wp-space-3) + var(--wp-space-2));
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-5);
  font-family: var(--wp-font);
  font-size: 10.5px;
  color: var(--wp-text-dim);
  border-top: 1px solid var(--wp-border);
  padding-top: var(--wp-space-3);
  padding-bottom: var(--wp-space-3);
  /* Sits below the last row rather than floating over it when the list is
     short enough not to scroll. */
  margin-top: auto;
}

/* A tinted glyph now, not a 4px bar — the fixed width and height left over
   from the bar squashed the icon to a sliver. */
.wp-rt-tag__swatch {
  margin-right: 5px;
  font-size: 11px;
  vertical-align: -1px;
}

.wp-rt-suggestions__src {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-dim);
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  padding: 1px 5px;
}

/* Booru tag rows. Same popover chrome, different row body — a tag has a
   category and a post count where a `$`/`@` row has a producer and facts. */
.wp-rt-tag { display: flex; align-items: center; gap: 10px; }

.wp-rt-tag__cat {
  width: 15px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  /* Neutral is the `general` category, which is most rows — a coloured icon
     on every line would make the coloured ones stop meaning anything. */
  color: #6a6a7a;
}

.wp-rt-tag__cat--general   { color: #6a6a7a; }
/* The two model sources. Their own hues rather than a category colour — a LoRA
   has no danbooru category, and reusing one would imply a relationship that
   does not exist. */
.wp-rt-tag__cat--lora      { color: var(--wp-var-6); }
.wp-rt-tag__cat--embedding { color: var(--wp-var-7); }

/* Section header. Only rendered when more than one source has hits, so it
   never costs a row to say something the single visible group already says.
   `scroll-margin-top` for the same reason the tag rows have it: arrow-key
   navigation scrolls a row into view and the sticky query band would otherwise
   park the first row of a section underneath itself. */
/* Dimmed rather than hidden: the stale rows are still the best guess on screen
   and blanking them on every keystroke flickers far worse. */
.wp-rt-suggestions__stale {
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--wp-accent-text, #c4b5fd);
  opacity: 0.85;
}
.wp-rt-suggestions[data-stale] .wp-rt-suggestions__item {
  opacity: 0.55;
  transition: opacity .12s ease;
}

.wp-rt-suggestions__section {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3, 6px);
  padding: 6px 10px 3px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text3, #666);
  scroll-margin-top: 38px;
}
.wp-rt-suggestions__section i { font-size: 10px; opacity: 0.8; }
.wp-rt-tag__cat--character { color: var(--wp-var-3); }
.wp-rt-tag__cat--copyright { color: var(--wp-var-1); }
.wp-rt-tag__cat--artist    { color: var(--wp-var-5); }
.wp-rt-tag__cat--meta      { color: var(--wp-var-2); }

.wp-rt-tag__body {
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.wp-rt-tag__name {
  font-family: var(--wp-font-mono);
  font-size: 12.5px;
  line-height: 1.25;
  color: var(--wp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wp-rt-tag__sub {
  font-size: 10.5px;
  line-height: 1.2;
  color: var(--wp-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wp-rt-tag__alias { color: var(--wp-kind-ref); }

.wp-rt-tag__count {
  font-family: var(--wp-font-mono);
  font-size: 11px;
  color: var(--wp-text-dim);
  flex: 0 0 auto;
  /* So 856k / 44k / 3.1k line up instead of jittering row to row. */
  font-variant-numeric: tabular-nums;
}

/* The header (and, in tag mode, the legend) are sticky, so they OVERLAY the
   scrollport rather than shrinking it. `scrollIntoView({block:"nearest"})`
   only knows about the scrollport, so arrowing to the first or last row parked
   it underneath a pinned band -- selected, highlighted, and invisible.
   `scroll-margin` is the mechanism designed for exactly this. */
.wp-rt-suggestions__item { scroll-margin-top: 38px; }
.wp-rt-tag { scroll-margin-bottom: 40px; }

.wp-rt-suggestions__item {
  display: flex;
  align-items: flex-start;
  gap: var(--wp-space-4);
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--wp-radius-sm);
  padding: 6px var(--wp-space-5); /* audit-exempt: 6px vertical keeps two-line rows compact */
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: var(--wp-text-sm);
  color: var(--wp-text, #e7e7ee);
  cursor: pointer;
}
.wp-rt-suggestions__item[data-active] {
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 22%, transparent);
}
/* A rounded, tinted tile rather than a bare glyph: it gives the kind colour
   enough area to actually register, and keeps the label column aligned whether
   or not a glyph has been resolved. */
.wp-rt-suggestions__icon-box {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-top: 1px; /* audit-exempt: optical centring on the label's first line box */
  border-radius: var(--wp-radius-sm);
  font-size: 10px;
}
.wp-rt-suggestions__body {
  display: flex;
  flex-direction: column;
  gap: 1px; /* audit-exempt: hairline between a name and its own subtitle */
  flex: 1;
  min-width: 0;
}
.wp-rt-suggestions__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-rt-suggestions__trigger {
  color: var(--wp-accent-text, #c4b5fd);
}
/* On a `$` row the label carries a `var-N` colour, and the sigil is part of
   the token — `$quality` is one word in the strip below, so splitting its
   colour here would make the two read as different things. Refs keep the
   accent sigil: `@` rows are coloured by kind, and the kind colour is already
   doing that job in the icon box. */
.wp-rt-suggestions__label[class*="var-"] .wp-rt-suggestions__trigger {
  color: inherit;
}
/* The detail line. Wraps rather than clips: these are short independent
   facts, and dropping one silently would defeat the point of showing them.
   The popover has a max-width, so wrapping is bounded. */
.wp-rt-suggestions__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wp-space-3);
  font-size: 11px; /* audit-exempt: micro disambiguator line — below scale floor */
  color: var(--wp-text-dim, #8a8a93);
}
.wp-rt-suggestions__uuid {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  opacity: 0.8;
}
/* Facts are discrete measurements, so each gets its own tile — as a run of
   bare words they read as one sentence and the eye cannot pick out the number
   it wants. */
.wp-rt-suggestions__fact {
  padding: 1px 4px; /* audit-exempt: micro tile padding */
  border-radius: 3px; /* audit-exempt: tile smaller than the radius scale */
  background: var(--wp-bg-4);
  color: var(--wp-text-muted, #8a8a93);
  font-family: var(--wp-font, system-ui, sans-serif);
}
/* The writer's name — the identifying half of the producer line. */
.wp-rt-suggestions__by {
  color: var(--wp-accent-text, #c4b5fd);
  font-family: var(--wp-font-mono, ui-monospace, monospace);
}
.wp-rt-suggestions__node {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  opacity: 0.85;
}
.wp-rt-suggestions__sep { opacity: 0.4; }
/* A count of what else touches this name — a thing to look at, so it is
   tinted like a soft warning rather than left as body text. */
.wp-rt-suggestions__badge {
  font-family: var(--wp-font, system-ui, sans-serif);
  padding: 0 4px; /* audit-exempt: badge inline padding */
  border-radius: var(--wp-radius-sm);
  padding: 1px 4px; /* audit-exempt: micro tile padding, matches __fact */
  border-radius: 3px; /* audit-exempt: tile smaller than the radius scale */
  background: color-mix(in oklab, var(--wp-warn) 20%, transparent);
  color: var(--wp-warn);
}
.wp-rt-suggestions__origin {
  display: inline-flex;
  align-items: center;
  gap: 3px; /* audit-exempt: glyph-to-word gap */
  padding: 0 4px; /* audit-exempt: micro tile padding, matches __fact */
  border-radius: 3px; /* audit-exempt: tile below the radius scale */
  background: color-mix(in oklab, var(--wp-info) 15%, transparent);
  color: var(--wp-info);
  font-family: var(--wp-font, system-ui, sans-serif);
}
.wp-rt-suggestions__origin .pi { font-size: 9px; }
.wp-rt-suggestions__internal {
  font-family: var(--wp-font, system-ui, sans-serif);
  font-style: italic;
  opacity: 0.8;
}
.wp-rt-suggestions__funnel {
  flex-shrink: 0;
  margin-top: 2px; /* audit-exempt: matches the leading icon's optical offset */
  font-size: 11px;
  color: var(--wp-accent-text, #c4b5fd);
}
.wp-rt-suggestions__item[data-active] .wp-rt-suggestions__sub {
  color: var(--wp-text, #e7e7ee);
}

/* Step-2 SubcategoryFilterPicker — anchored popover next to the
   clicked chip (or below the host on insert flow). Teleported to
   <body> so it escapes ancestor overflow/transform contexts. Backdrop
   is a transparent click-target full-viewport layer that cancels the
   picker (Skip semantics — no insert). Escape key dismisses the
   same way. */
/* Z-index sits in the autocomplete-popover tier (9999), NOT the old
   1000/1001. On the canvas the derivation/wildcard instance modal renders
   on its own high-z overlay; at 1000/1001 the body-teleported picker fell
   BEHIND that modal. The picker tracks the autocomplete popover's tier so it
   clears every modal: those run up to 10010 (InjectorBindingModal), so the
   old 10000/10001 was no longer above all of them. Backdrop sits just under
   the anchor, both above the modal tier. */
.wp-subcat-picker__backdrop {
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 10020;
}
.wp-subcat-picker__anchor {
  position: fixed;
  z-index: 10021;
  /* Subtle drop-shadow so the popover reads as elevated even without
     the dimmed backdrop of the previous modal version. */
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4));
}
</style>
