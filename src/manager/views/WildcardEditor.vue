<script setup lang="ts">
/**
 * WildcardEditor — Wave 4 port of `WildcardEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity (name + category + description + tags + `$varBinding`)
 *  2. Sub-categories group boxes (one per `tag_groups` axis + an
 *     ungrouped box; each box owns its pills + an inline "+ tag", §4.3/H1)
 *     — `components/wildcard-editor/WildcardSubcategoriesCard.vue`
 *  3. Options table (weight + value RichTextInput + a per-option grouped
 *     multi-select for `sub_categories[]`, §4.3/H2)
 *
 * Save flow appends a snapshot to `payload.history` (utils/history.ts) so
 * the EditorFrame's history button works on the next mount.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import type { SaveState, EditorFieldError } from "../components/EditorFrame.types";
import { useRouter, useRoute } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import SendToTestRunner from "../components/SendToTestRunner.vue";
import IdentityCard from "../components/IdentityCard.vue";
import { usePanelAction } from "../composables/usePanelAction";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import CommunityRowActions from "../components/CommunityRowActions.vue";
import Input from "../components/ui/Input.vue";
import RichTextInput from "../components/RichTextInput.vue";
import NegativeField from "../components/NegativeField.vue";
import { appendNegative, pruneBlankNegatives, setNegative } from "../utils/negatives";
import BulkAddPanel from "../components/BulkAddPanel.vue";
import SelectionToolbar from "../components/SelectionToolbar.vue";
import Checkbox from "../components/ui/Checkbox.vue";
import type { ParsedBulkOption } from "../utils/bulkParse";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { axisHueAt } from "../../components/shared/axis-color";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import {
  registerOpenEditor, draftCreateId, draftSaved, type StagedDraft,
} from "../composables/useOpenEditor";
import { registerAiAction } from "../composables/useAiActions";
import DraftBanner from "../components/DraftBanner.vue";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useUiStore } from "../stores/uiStore";
import {
  filterIsActive,
  moveSelected,
  nudge,
  optionMatches,
  visibleTagsFor,
  type MoveTarget,
} from "../utils/option-list-ops";
import { useRecentStore } from "../stores/recentStore";
import { toIdentifier } from "../utils/slug";
import { validateSubcatName, validateRefGrammarName, isValidVariableName } from "@/manager/validation/names";
import {
  buildWildcardRefData,
  collectLibraryWildcardRefs,
} from "../utils/library-suggestions";
import { appendSnapshot, readHistory } from "../utils/history";
import type {
  ModuleHistoryEntry,
  WildcardOption,
  AiDraftGroup,
  AiWildcardEditAction,
  AiWildcardEditChange,
  WildcardPayload,
} from "../api/types";
import { useCascadeStore } from "../cascade/cascade-store";
import { useCascadeApply } from "../cascade/useCascadeApply";
import { registerCascadeUndo } from "../cascade/undo-stack-integration";
import CascadeConfirmDialog from "../cascade/CascadeConfirmDialog.vue";
import CascadeRenameDialog from "../cascade/CascadeRenameDialog.vue";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import type { ResolveWarning } from "../utils/resolveTokens";
import { brokenRefLabels } from "../utils/validateModule";
import AiWildcardPanel from "../components/ai/AiWildcardPanel.vue";
import { useAiConfig } from "../composables/useAiConfig";
import WildcardSubcategoriesCard from "../components/wildcard-editor/WildcardSubcategoriesCard.vue";
import OptionFilterBar from "../components/wildcard-editor/OptionFilterBar.vue";
import OptionTagsCell from "../components/wildcard-editor/OptionTagsCell.vue";
import OptionProbabilityCell from "../components/wildcard-editor/OptionProbabilityCell.vue";
import {
  acceptsPromotionRefusal,
  axisIndexOf,
  buildSubcatGroups,
  normalizeTagGroupKinds,
  normalizeTagGroups,
  OTHER_AXIS,
  serializeTagGroupKinds,
  serializeTagGroups,
  tagChipStyle,
  toggledOptionTags,
  totalWeightOf,
  type SubcatGroup,
} from "../components/wildcard-editor/tag-groups";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const route = useRoute();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const ui = useUiStore();
const toast = useToast();
const recent = useRecentStore();
const { resolveReturnTo } = useReturnTo();
const cascade = useCascadeStore();
const cascadeApply = useCascadeApply();

/**
 * Live library row for the entity being edited. Resolves through
 * `moduleStore.catalog` so per-row footer actions (publish to
 * community, copy payload) get the same engine-row shape every
 * other code path uses. Null on create or when the row hasn't yet
 * hydrated.
 */
const currentRow = computed(() => {
  if (!props.id) return null;
  return moduleStore.catalog.find((m) => m.id === props.id) ?? null;
});
const resolveWarnings = useResolveWarnings();

const cascadeDialogOpen = ref(false);
const cascadeDialogProps = ref<{
  kind: string;
  id: string;
  action: "delete" | "rename";
  extra?: Record<string, unknown>;
} | null>(null);

async function onEntityDeleteClick(): Promise<void> {
  if (!props.id) return;
  // Always go through the cascade dialog — even when there are no
  // inbound refs. Earlier the no-refs branch deleted directly without
  // any prompt; that bit users who clicked the editor's Delete pill
  // by accident on a freshly-installed entity. The dialog runs its
  // own dry-run, so 0 refs just shows an empty "affected" list with
  // the Delete button still front-and-center — adds a 100ms scan but
  // guarantees confirm-before-destroy on every editor.
  cascadeDialogProps.value = {
    kind: "wildcard",
    id: props.id,
    action: "delete",
  };
  cascadeDialogOpen.value = true;
}

// Rename dialog for sub-category pills
const subcatRenameOpen = ref(false);
const subcatRenameTarget = ref<string>("");

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const contentRating = ref<"safe" | "nsfw">("safe");
const varBinding = ref("");
const varBindingError = ref("");
const subCategories = ref<string[]>([]);
/** Optional UI grouping of registry sub-categories into named axes
 *  (`payload.tag_groups`). Serialised back into the payload on save so
 *  grouping survives sharing. The engine ignores it. */
const tagGroups = ref<Record<string, string[]>>({});
/** Per-group meaning (`payload.tag_group_kinds`). Absent means `classify` —
 *  today's behaviour and what every stored payload means — so only `accepts`
 *  entries are ever stored, keeping an untouched payload byte-identical. */
const tagGroupKinds = ref<Record<string, "accepts">>({});

const options = ref<WildcardOption[]>([
  { id: `opt_${Math.random().toString(16).slice(2, 8)}`, value: "", weight: 1, sub_categories: [] },
  { id: `opt_${Math.random().toString(16).slice(2, 8)}`, value: "", weight: 1, sub_categories: [] },
]);
/** Which option row's tag picker is expanded (option id), H2. */
const openOptTagPicker = ref<string | null>(null);
/** When a menu opens too close to the viewport bottom we flip it to open
 *  upward so it isn't clipped off the end of the page (bugs #1/#4). */
const pickerDropUp = ref(false);
const saving = ref(false);
const saveState = ref<SaveState>("idle");
const saveError = ref<string>("");
let saveStateTimer: ReturnType<typeof setTimeout> | null = null;

/** Flip the Save button state-machine. `ttl` (ms) auto-resets the
 *  saved/error flash back to "idle" if nothing else has touched the
 *  state in the meantime. */
function setSaveState(next: SaveState, ttl?: number): void {
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  saveState.value = next;
  if (ttl && (next === "saved" || next === "error")) {
    saveStateTimer = setTimeout(() => {
      if (saveState.value === next) saveState.value = "idle";
    }, ttl);
  }
}
const isEdit = computed(() => !!props.id);
const historyEntries = ref<ModuleHistoryEntry[]>([]);

// Unsaved-changes guard
const baseline = ref<string>("");

function snapshot(): string {
  return JSON.stringify({
    name: name.value,
    description: description.value,
    categoryId: categoryId.value,
    tags: tags.value,
    varBinding: varBinding.value,
    subCategories: subCategories.value,
    tagGroups: tagGroups.value,
    tagGroupKinds: tagGroupKinds.value,
    options: options.value,
  });
}

/**
 * Bulk-add has un-added text sitting in its box.
 *
 * Reported repeatedly: users hit the PAGE's Save or Cancel instead of the
 * panel's own "Add options" / Cancel, because the page pair is larger and in
 * the familiar place — and the typed batch was silently thrown away. Two
 * guards, no new dialog for the common case:
 *   - Save is greyed while the panel is open, with a tooltip saying why, so
 *     the only Save-shaped thing that responds is the panel's own commit.
 *   - The un-added text counts as unsaved work, so the existing route guard
 *     already covers Cancel, the back link and any other navigation. Only the
 *     wording changes.
 */
const bulkPending = ref(false);
/** The AI panel (Settings › AI assistant). The button only shows once the
 *  assistant is turned on. A draft not yet added counts as unsaved work. */
const ai = useAiConfig();
const aiDraftOpen = ref(false);
const aiPending = ref(false);

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => bulkPending.value || aiPending.value || snapshot() !== baseline.value,
);

/** The chat's draft this new wildcard was opened with (Save creates it at
 *  the id the card reserved and marks the card applied). */
let chatDraft: StagedDraft | null = null;
const fillFromChat = registerOpenEditor({
  id: props.id, type: "wildcard", dirty: () => dirty.value,
  rebase: () => { baseline.value = snapshot(); },
  name, description, tags, categoryId, contentRating,
  payload: () => currentPayload() as unknown as Record<string, unknown>,
  setPayload: (p) => {
    const next = p as Partial<WildcardPayload>;
    if (Array.isArray(next.options)) {
      options.value = next.options.map((o) => ({
        ...o, sub_categories: Array.isArray(o.sub_categories) ? [...o.sub_categories] : [],
      })) as typeof options.value;
    }
    if (Array.isArray(next.sub_categories)) subCategories.value = [...next.sub_categories];
    if (next.tag_groups) {
      tagGroups.value = normalizeTagGroups(next.tag_groups, subCategories.value);
      tagGroupKinds.value = normalizeTagGroupKinds(next.tag_group_kinds, tagGroups.value);
    }
    if (typeof next.var_binding === "string" && next.var_binding) varBinding.value = next.var_binding;
  },
});

// The chat's `draft_options`: open the AI panel on Add and draft there, so
// the user picks what to keep exactly as if they had asked the panel.
const aiPanel = ref<InstanceType<typeof AiWildcardPanel> | null>(null);
registerAiAction("draft_options", async (args) => {
  if (!ai.config.value?.enabled) return "couldn't: the assistant is off";
  aiDraftOpen.value = true;
  await nextTick();
  if (!aiPanel.value) return "couldn't: the AI panel didn't open";
  return aiPanel.value.draft(String(args.instruction ?? ""), Number(args.count) || 10);
}, (args) => !!props.id && args.id === props.id);

// The chat's `use_panel`: Describe, or one of the AI panel's tabs (Add drafts
// new options; the edits work on the selected options, or all of them).
const identityCard = ref<InstanceType<typeof IdentityCard> | null>(null);
async function viaEdit(action: AiWildcardEditAction, text: string): Promise<string> {
  aiDraftOpen.value = true;
  await nextTick();
  return aiPanel.value ? aiPanel.value.edit(action, text) : "couldn't: the AI panel didn't open";
}
usePanelAction({
  id: () => props.id,
  identity: identityCard,
  panels: {
    add: async (text) => {
      aiDraftOpen.value = true;
      await nextTick();
      return aiPanel.value ? aiPanel.value.draft(text, 10) : "couldn't: the AI panel didn't open";
    },
    remove: (text) => viaEdit("remove", text),
    rewrite: (text) => viaEdit("rewrite", text),
    retag: (text) => viaEdit("retag", text),
    reweight: (text) => viaEdit("reweight", text),
  },
});

const draft = useEditorDraft({
  kind: "wildcard",
  id: props.id ?? "new",
  dirty,
  snapshot,
});

function applyDraft(): void {
  const snap = draft.restore();
  if (!snap) return;
  try {
    const parsed = JSON.parse(snap) as {
      name: string;
      description: string;
      categoryId: string | null;
      tags: string[];
      varBinding: string;
      subCategories: string[];
      tagGroups?: Record<string, string[]>;
      tagGroupKinds?: Record<string, "accepts">;
      options: typeof options.value;
    };
    name.value = parsed.name;
    description.value = parsed.description;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    varBinding.value = parsed.varBinding;
    subCategories.value = parsed.subCategories;
    tagGroups.value = parsed.tagGroups ?? {};
    tagGroupKinds.value = parsed.tagGroupKinds ?? {};
    options.value = parsed.options;
    subcatOpen.value = resolveSubcatDefaultOpen();
  } catch {
    toast.push({ severity: "error", summary: "Draft restore failed", life: 3000 });
  }
}

// Suggestions: every other wildcard's id (= 8-hex uuid post DB
// migration 004) for the `@`-trigger nested-reference autocomplete.
// The canonical stored form is `@{8hex}` per the syntax spec — the
// popover surfaces the human display name (via `nameByUuid`) but
// the inserted token is the bare 8-hex id. The id IS the uuid, so
// no extraction step is needed.
//
// Walker extracted to `utils/library-suggestions.ts` (2026-05-09 cycle)
// so derivation editor + future SPA views inherit the same picker.
const wcSuggestions = computed<string[]>(
  () => collectLibraryWildcardRefs(moduleStore, props.id, nameByUuid.value),
);

// All six per-wildcard maps RichTextInput's `@{}` nested-ref UI consumes
// (display name, declared sub-cats, has-null, option count, per-option tag
// sets, tag-group axes) built in ONE catalog pass by the shared
// `buildWildcardRefData` walker (utils/library-suggestions) — the SAME
// source the derivation editor now reuses for its action-value carriers.
// The thin wrappers below preserve the existing binding names so the
// template + `wcSuggestions` sort key are untouched.
const refData = computed(() => buildWildcardRefData(moduleStore.catalog));
const nameByUuid = computed(() => refData.value.uuidToName);
/** Missing `@` refs per option value — the same test the chips use, so a row
 *  is marked exactly when it shows a red chip. */
function optionBrokenRefs(value: string): string[] {
  // Nothing is known until the catalog loads; do not paint every ref red then.
  if (nameByUuid.value.size === 0) return [];
  return brokenRefLabels(value, nameByUuid.value);
}
const uuidToSubCategories = computed(() => refData.value.uuidToSubCategories);
const uuidToOptionsCount = computed(() => refData.value.uuidToOptionsCount);
const uuidToHasNull = computed(() => refData.value.uuidToHasNull);
const uuidToOptionTagSets = computed(() => refData.value.uuidToOptionTagSets);
const uuidToTagGroups = computed(() => refData.value.uuidToTagGroups);

// Var-suggestions removed: wildcard option values don't support $name
// substitution at runtime (only @{uuid} nested refs + {a|b|c} inline
// choices). RichTextInput's surface="wildcard" gates the $-trigger
// popover so even pasted `$name` text stays plain.

/* ── Sub-category group boxes (§4.3, H1) ────────────────────────────
 * Render the registry as bordered boxes: one per `tag_groups` axis (in
 * insertion order) plus a trailing "ungrouped" box for registry tags not
 * claimed by any axis. Each box owns its pills + an inline "+ tag". */

/** Sub-Categories section disclosure. The default is set once on load from the
 *  `subcatDefault` display-pref (see `uiStore`): `"populated"` opens it only
 *  when the wildcard already has groups (so a well-tagged wildcard's axes don't
 *  push the options table out of view on a blank one, but an existing library
 *  of groups is visible without a click); `"always"` opens it even when empty;
 *  `"never"` keeps it shut. The collapsed header carries a tag/axis count plus
 *  an accented `+`, so it still advertises there is something to open. */
const subcatOpen = ref(false);

/** Resolve the panel's initial open state from the pref + current group count.
 *  Called once after the row hydrates, never on every group edit — otherwise
 *  collapsing it and adding a tag would yank it back open. */
function resolveSubcatDefaultOpen(): boolean {
  switch (ui.subcatDefault) {
    case "always": return true;
    case "never": return false;
    default: return Object.keys(tagGroups.value).length > 0;
  }
}

/** The registry as group boxes (see `buildSubcatGroups`) — the option tag
 *  picker and the options filter group their tags the same way the card does. */
const subcatGroups = computed<SubcatGroup[]>(() =>
  buildSubcatGroups(tagGroups.value, subCategories.value),
);

const subcatCard = ref<InstanceType<typeof WildcardSubcategoriesCard> | null>(null);

/** Rename an axis (see the card's `renameGroup`). Kept reachable on the
 *  editor so callers and tests need not know the card exists. */
function renameGroup(oldAxis: string, nextAxis: string): boolean {
  return subcatCard.value?.renameGroup(oldAxis, nextAxis) ?? false;
}

/** Disband an axis (see the card's `ungroupAxis`). */
function ungroupAxis(axis: string): void {
  subcatCard.value?.ungroupAxis(axis);
}

/** Per-axis chip hue (shared `axisHueAt` palette), so a tag reads with the
 *  same colour across every surface. */
function tagHue(tag: string): string {
  return axisHueAt(axisIndexOf(tagGroups.value, tag));
}

function chipStyle(tag: string): Record<string, string> {
  return tagChipStyle(tagGroups.value, tag);
}

/** True when the trigger that fired `ev` sits within `menuPx` of the
 *  viewport bottom — i.e. a downward menu would be clipped, so flip up. */
function shouldDropUp(ev: MouseEvent | undefined, menuPx: number): boolean {
  const el = ev?.currentTarget as HTMLElement | null;
  const r = el?.getBoundingClientRect();
  return !!r && window.innerHeight - r.bottom < menuPx;
}

/** Close the editor's transient overlays: the per-option tag picker and the
 *  options filter's tag menu. Used by the document-level outside-click +
 *  Escape handlers (bug #3); the sub-categories card dismisses its own
 *  kebab menus and inline add-tag input the same way. */
function closeAllMenus(): void {
  openOptTagPicker.value = null;
  // The options filter's tag menu is teleported like the per-option one, so it
  // needs the same dismissal — without this it stayed open until its own
  // button was clicked again.
  optTagMenuOpen.value = false;
}

/** Outside-click: any pointer landing outside an open menu / its trigger
 *  dismisses everything. Clicks inside these regions are handled by their
 *  own (`@click.stop`) handlers, so we bail when the target is within one. */
function onDocPointerDown(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  if (
    t?.closest(
      // `.opt-tags__picker` is listed separately: the menu is teleported to
      // <body>, so it is no longer inside `.opt-tags` and would otherwise be
      // dismissed by its own clicks.
      ".subcat-pill, .subcat-menu, .subcat-addtag, .subcat-addtag__open, .opt-tags,"
      + " .opt-tags__picker, .wc-optfilter__tagbtn",
    )
  ) {
    return;
  }
  closeAllMenus();
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeAllMenus();
}

/* ── Per-option grouped multi-select (§4.3, H2) ─────────────────────── */

/** Box model for the option tag picker — same axis grouping as the
 *  registry boxes but used to render the grouped checkbox sections. */
const optionTagGroups = computed<SubcatGroup[]>(() => subcatGroups.value);




/**
 * Viewport coordinates for the teleported tag menu.
 *
 * The menu used to be `position: absolute` inside the table cell, which put it
 * inside `.wp-editor__body` — an `overflow: auto` scroller. Anything extending
 * past that container's edge was simply cut off, which is why the menu lost its
 * bottom rows near the foot of the page. Teleporting to <body> and positioning
 * from the trigger's rect is what every other popover here already does.
 */
const optTagAnchor = ref({ top: 0, left: 0, width: 0 });
/** Height reserved when deciding whether to flip above the trigger. Matches
 *  the menu's own cap (240px list + search + padding). */
const OPT_TAG_MENU_PX = 300;

function toggleOptTagPicker(optionId: string, ev?: MouseEvent): void {
  const opening = openOptTagPicker.value !== optionId;
  openOptTagPicker.value = opening ? optionId : null;
  if (!opening) return;
  pickerDropUp.value = shouldDropUp(ev, OPT_TAG_MENU_PX);
  optTagTriggerEl = (ev?.currentTarget as HTMLElement | null) ?? null;
  const r = optTagTriggerEl?.getBoundingClientRect();
  if (!r) return;
  // Fixed coordinates, so no scroll offset is added — and the menu is
  // re-anchored on every open rather than tracked, since the editor body
  // scrolls underneath it and a stale anchor is worse than a closed menu.
  optTagAnchor.value = {
    top: pickerDropUp.value ? r.top - 4 : r.bottom + 4,
    left: r.left,
    width: r.width,
  };
}

/** The button the open menu belongs to, so it can be re-measured on scroll. */
let optTagTriggerEl: HTMLElement | null = null;

/**
 * Keep the menu attached to its trigger while the editor scrolls under it.
 *
 * A fixed-position popover does not move with the page, so without this it
 * would sit stranded beside unrelated rows. Closing instead was the first
 * attempt and is wrong: the browser scrolls a partly-visible button into view
 * as part of clicking it, so opening a menu near either edge closed it in the
 * same gesture.
 *
 * Once the trigger has left the viewport entirely there is nothing to anchor
 * to, and closing IS right.
 */
function reanchorOptTagPicker(ev?: Event): void {
  // A scroll that happens INSIDE a teleported menu is the user reading its own
  // list — with the wheel or by dragging its scrollbar — and must not dismiss
  // it. Only movement of the surface UNDER the menu is a reason to react.
  const from = ev?.target as HTMLElement | null;
  if (from?.closest?.(".opt-tags__picker")) return;
  // Re-measure rather than dismiss. Closing on any layout change meant the
  // menu vanished the moment the list behind it changed height — filtering to
  // zero results shortens the page, which fires a scroll, which closed the
  // very menu you were using to filter.
  if (optTagMenuOpen.value) {
    const r = optFilterTriggerEl?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) optTagMenuOpen.value = false;
    else positionFilterMenu();
  }
  if (openOptTagPicker.value === null || !optTagTriggerEl) return;
  const r = optTagTriggerEl.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) {
    openOptTagPicker.value = null;
    return;
  }
  pickerDropUp.value = window.innerHeight - r.bottom < OPT_TAG_MENU_PX;
  optTagAnchor.value = {
    top: pickerDropUp.value ? r.top - 4 : r.bottom + 4,
    left: r.left,
    width: r.width,
  };
}


/** How many assigned tags a row shows before collapsing the rest behind `+N`.
 *  A fully tagged option carries 8+ (hue + temperature + tone + saturation +
 *  suitability flags); rendering them all made one row taller than the whole
 *  rest of the table. Matches the canvas OptionRow's cap. */
const OPT_TAG_LIMIT = 4;
const expandedOptTags = ref<Set<string>>(new Set());

function toggleOptTagsExpanded(optionId: string): void {
  const next = new Set(expandedOptTags.value);
  if (next.has(optionId)) next.delete(optionId);
  else next.add(optionId);
  expandedOptTags.value = next;
}

/**
 * Which tags a row shows, and what the `+N` pill has to admit.
 *
 * Filtering by a tag that happens to sit in the folded remainder produced a row
 * with no visible reason for being there — the evidence was behind the very
 * pill saying "there is more". Matched tags are promoted into the visible slots
 * instead. Tags are a set, so their order carries no meaning and promoting one
 * costs nothing; auto-expanding the row would reflow every match at once,
 * which is a lot of movement for a small clarification.
 */
function optionTagView(o: WildcardOption) {
  return visibleTagsFor(
    o.sub_categories ?? [],
    matchedTagSet.value,
    OPT_TAG_LIMIT,
    expandedOptTags.value.has(o.id),
  );
}

/** Toggle a tag's membership on an option. Preserves registry order so
 *  the chips render in a stable sequence regardless of click order. */
function toggleOptionTag(o: WildcardOption, tag: string): void {
  o.sub_categories = toggledOptionTags(subCategories.value, o.sub_categories ?? [], tag);
}

const totalWeight = computed(() => totalWeightOf(options.value));

function probabilityFor(o: WildcardOption): number {
  return ((Number(o.weight) || 0) / totalWeight.value) * 100;
}

/** Make `o` the wildcard's one fallback option, or unset it. Stored only as
 *  `true` (absent otherwise) so a payload without one never stamps schema 9. */
function toggleFallback(o: WildcardOption): void {
  if (o.is_null) return;
  const on = !o.fallback;
  for (const other of options.value) delete other.fallback;
  if (on) o.fallback = true;
}

// `normalizeTagGroups` / `normalizeTagGroupKinds` / `serializeTagGroups` /
// `serializeTagGroupKinds` live in `components/wildcard-editor/tag-groups`.

onUnmounted(() => {
  document.removeEventListener("click", onDocPointerDown);
  document.removeEventListener("keydown", onDocKeydown);
  window.removeEventListener("scroll", reanchorOptTagPicker, true);
  window.removeEventListener("resize", reanchorOptTagPicker);
});

onMounted(async () => {
  // Outside-click + Escape dismissal for all transient menus (bug #3).
  document.addEventListener("click", onDocPointerDown);
  document.addEventListener("keydown", onDocKeydown);
  // Capture, so a scroll in ANY nested scroller reaches this — scroll events
  // do not bubble, and the editor body is the one that actually moves.
  window.addEventListener("scroll", reanchorOptTagPicker, true);
  window.addEventListener("resize", reanchorOptTagPicker);
  await Promise.all([categoryStore.fetchAll(), moduleStore.fetchCatalog()]);
  if (props.id) {
    try {
      const row = await moduleStore.get(props.id);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = row.tags;
      contentRating.value = row.content_rating ?? "safe";
      const p = row.payload as Partial<WildcardPayload>;
      // Normalise every option to the v2 shape (sub_categories[]) so a
      // row that slipped through without the array — e.g. a payload read
      // before lazy-migration ran — still edits cleanly.
      options.value = (p.options ?? []).map((o) => ({
        ...o,
        sub_categories: Array.isArray(o.sub_categories) ? [...o.sub_categories] : [],
      }));
      subCategories.value = [...(p.sub_categories ?? [])];
      tagGroups.value = normalizeTagGroups(p.tag_groups, subCategories.value);
      tagGroupKinds.value = normalizeTagGroupKinds(p.tag_group_kinds, tagGroups.value);
      varBinding.value = (p.var_binding && p.var_binding.trim()) || toIdentifier(row.name);
      historyEntries.value = readHistory(row.payload);
      recent.push({ id: props.id, kind: "wildcard", name: name.value });
    } catch {
      toast.push({ severity: "error", summary: "Wildcard not found" });
      router.replace("/wildcards");
    }
  } else if (route.query.starter === "subject") {
    // Quick-create starter: pre-fill a ready-to-save "subject" wildcard so a
    // brand-new user lands in an editor with something concrete to tweak + save.
    name.value = "subject";
    varBinding.value = "subject";
    options.value = [
      { id: _newOptionId(), value: "a cat", weight: 1, sub_categories: [] },
      { id: _newOptionId(), value: "a dog", weight: 1, sub_categories: [] },
      { id: _newOptionId(), value: "a fox", weight: 1, sub_categories: [] },
    ];
  }
  // After every load path (existing row, blank new, starter) settle the
  // sub-category panel to the user's chosen default.
  subcatOpen.value = resolveSubcatDefaultOpen();
  baseline.value = snapshot();
  // "Open in editor" on a chat card: the proposed wildcard, unsaved.
  if (!props.id) {
    chatDraft = fillFromChat();
    chatDraftNote(chatDraft);
  }
});

function chatDraftNote(d: StagedDraft | null): void {
  if (!d) return;
  toast.push({
    severity: "info",
    summary: "From the assistant",
    detail: d.newCategory
      ? `Check it and Save to keep it. It suggested a new category, "${d.newCategory}": create it from the Category picker if you want it.`
      : "Check it and Save to keep it.",
  });
}

/** Drop a sub-category from local draft state: the registry, every
 *  option's membership, AND any axis that lists it. Mirrors the server
 *  `fix_subcat_delete` cascade so pills + option chips + group boxes all
 *  reflect the removal before a refetch. */
function removeSub(s: string) {
  subCategories.value = subCategories.value.filter((x) => x !== s);
  for (const o of options.value) {
    if ((o.sub_categories ?? []).includes(s)) {
      o.sub_categories = (o.sub_categories ?? []).filter((t) => t !== s);
    }
  }
  if (Object.keys(tagGroups.value).length > 0) {
    const next: Record<string, string[]> = {};
    for (const [axis, members] of Object.entries(tagGroups.value)) {
      next[axis] = members.filter((m) => m !== s);
    }
    tagGroups.value = next;
  }
}

async function onSubcatDeleteClick(subcat: string): Promise<void> {
  // Only the cascade flow matters for saved wildcards (props.id).
  // For new wildcards (no id yet) the subcat is local-only — delegate
  // straight to the existing in-memory removeSub.
  if (!props.id) {
    removeSub(subcat);
    return;
  }
  const refs = cascade.subcatRefsTo(props.id, subcat);
  if (refs.length === 0) {
    // Silent path: apply via cascade (server cleans any stale refs),
    // then remove from local draft state + show Undo toast.
    const result = await cascadeApply.apply({
      kind: "subcategory",
      id: props.id,
      action: "delete",
      extra: { subcat_name: subcat },
    });
    if (result.ok) {
      removeSub(subcat);
      baseline.value = snapshot();
      const undoId = result.undo_entry_id;
      toast.push({
        severity: "success",
        summary: `Sub-category "${subcat}" deleted`,
        life: 5000,
        action: {
          label: "Undo",
          run: async () => {
            const undoResult = await cascadeApply.undo(undoId);
            if (!undoResult.ok) {
              toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
            } else {
              // Re-add the subcat to the local draft if undo succeeded.
              if (!subCategories.value.includes(subcat)) {
                subCategories.value.push(subcat);
              }
              baseline.value = snapshot();
              toast.push({ severity: "info", summary: `Sub-category "${subcat}" restored`, life: 3000 });
            }
          },
        },
      });
    } else {
      toast.push({ severity: "error", summary: "Delete failed", detail: (result as { ok: false; error: string }).error, life: 4000 });
    }
    return;
  }
  // Refs > 0 path: open the confirm dialog so the user sees the impact.
  cascadeDialogProps.value = {
    kind: "subcategory",
    id: props.id,
    action: "delete",
    extra: { subcat_name: subcat },
  };
  cascadeDialogOpen.value = true;
}

function onCascadeDialogConfirmed(result: { undo_entry_id: string; affected_count: number }): void {
  cascadeDialogOpen.value = false;
  const dialogProps = cascadeDialogProps.value;
  if (!dialogProps) return;
  const undoId = result.undo_entry_id;
  const count = result.affected_count;

  if (dialogProps.kind === "wildcard") {
    // Whole-entity delete confirmed from the cascade dialog.
    moduleStore.remove(dialogProps.id);
    toast.push({
      severity: "success",
      summary: `"${name.value}" deleted`,
      detail: count > 0 ? `Updated ${count} reference${count === 1 ? "" : "s"}` : undefined,
      life: 5000,
      action: {
        label: "Undo",
        run: async () => {
          const undoResult = await cascadeApply.undo(undoId);
          if (!undoResult.ok) {
            toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
          } else {
            toast.push({ severity: "info", summary: `"${name.value}" restored`, life: 3000 });
          }
        },
      },
    });
    router.push(resolveReturnTo("/wildcards"));
    return;
  }
  if (dialogProps.kind === "option") {
    const rowIdx = dialogProps.extra?._row_idx as number | undefined;
    const optionId = dialogProps.id;
    const optSnapshot = typeof rowIdx === "number" ? options.value[rowIdx] : undefined;
    const optionLabel = optSnapshot?.value || optionId;
    if (typeof rowIdx === "number") options.value.splice(rowIdx, 1);
    baseline.value = snapshot();
    toast.push({
      severity: "success",
      summary: `Option "${optionLabel}" deleted`,
      detail: count > 0 ? `Updated ${count} reference${count === 1 ? "" : "s"}` : undefined,
      life: 5000,
      action: {
        label: "Undo",
        run: async () => {
          const undoResult = await cascadeApply.undo(undoId);
          if (!undoResult.ok) {
            toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
          } else if (optSnapshot && typeof rowIdx === "number") {
            // Splice the option back at its original index.
            const insertAt = Math.min(rowIdx, options.value.length);
            options.value.splice(insertAt, 0, optSnapshot);
            baseline.value = snapshot();
            toast.push({ severity: "info", summary: `Option "${optionLabel}" restored`, life: 3000 });
          }
        },
      },
    });
    return;
  }

  // Default: sub-category delete path
  const subcat = (dialogProps.extra?.subcat_name as string | undefined) ?? "";
  if (subcat) removeSub(subcat);
  baseline.value = snapshot();
  toast.push({
    severity: "success",
    summary: `Sub-category "${subcat}" deleted`,
    detail: count > 0 ? `Updated ${count} reference${count === 1 ? "" : "s"}` : undefined,
    life: 5000,
    action: {
      label: "Undo",
      run: async () => {
        const undoResult = await cascadeApply.undo(undoId);
        if (!undoResult.ok) {
          toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
        } else {
          if (subcat && !subCategories.value.includes(subcat)) {
            subCategories.value.push(subcat);
          }
          baseline.value = snapshot();
          toast.push({ severity: "info", summary: `Sub-category "${subcat}" restored`, life: 3000 });
        }
      },
    },
  });
}

function onCascadeDialogCancelled(): void {
  cascadeDialogOpen.value = false;
}

/* ── Pill kebab actions — the card emits Rename… / Delete…; the cascade
 *    dialogs they open live here. ─────────────────────────────────────── */

function onSubcatRenameClick(subcat: string): void {
  // Only meaningful for saved wildcards — new items have no server entity.
  if (!props.id) return;
  subcatRenameTarget.value = subcat;
  subcatRenameOpen.value = true;
}

function _applySubcatRename(oldName: string, newName: string): void {
  // Mirror the server-side `fix_subcat_rename` mutation on the local
  // draft state so the pills + option chips + group boxes reflect the new
  // name without a refetch. Touches the registry list, each option's
  // `sub_categories` membership, AND any axis that lists the tag — the
  // same sites the engine fixer rewrites (§4.4).
  subCategories.value = subCategories.value.map((s) => (s === oldName ? newName : s));
  for (const o of options.value) {
    if ((o.sub_categories ?? []).includes(oldName)) {
      o.sub_categories = (o.sub_categories ?? []).map((t) => (t === oldName ? newName : t));
    }
  }
  if (Object.keys(tagGroups.value).length > 0) {
    const next: Record<string, string[]> = {};
    for (const [axis, members] of Object.entries(tagGroups.value)) {
      next[axis] = members.map((m) => (m === oldName ? newName : m));
    }
    tagGroups.value = next;
  }
}

function onSubcatRenameConfirmed(result: {
  undo_entry_id: string;
  new_name: string;
  broken_refs?: Array<{ kind: string; id: string; name: string }>;
}): void {
  subcatRenameOpen.value = false;
  const oldSubcat = subcatRenameTarget.value;
  const newSubcat = result.new_name;

  // Sync local state with server mutation, then re-anchor the dirty
  // baseline so the "Unsaved" badge stays clean (cascade already
  // persisted the rename server-side).
  _applySubcatRename(oldSubcat, newSubcat);
  baseline.value = snapshot();

  // Register undo handle and show toast with Undo action.
  const undoHandle = registerCascadeUndo(result.undo_entry_id, `Renamed sub-category "${oldSubcat}"`);
  toast.push({
    severity: "success",
    summary: `Sub-category renamed to "${newSubcat}"`,
    life: 5000,
    action: {
      label: "Undo",
      run: async () => {
        const undoResult = await undoHandle.undo();
        if (!undoResult.ok) {
          toast.push({ severity: "error", summary: "Undo failed", detail: undoResult.error, life: 4000 });
        } else {
          // Reverse the local rename to match the restored server state.
          _applySubcatRename(newSubcat, oldSubcat);
          baseline.value = snapshot();
          toast.push({ severity: "info", summary: `Sub-category rename reversed`, life: 3000 });
        }
      },
    },
  });

  // Push any broken refs (user opted out of cascade) into the warnings store.
  if (result.broken_refs?.length) {
    const warnings: ResolveWarning[] = result.broken_refs.map((ref) => ({
      type: "cascade_broken_ref",
      severity: "warn" as const,
      module_id: ref.id,
      source_field: "rename-opt-out",
      position: 0,
      token_index: null,
      detail: { rename_target_id: result.undo_entry_id, broken_ref_kind: ref.kind, broken_ref_name: ref.name },
      message: `Ref to renamed sub-category may be broken (rename without cascade was selected)`,
    }));
    resolveWarnings.push(warnings);
  }
}

function onSubcatRenameCancelled(): void {
  subcatRenameOpen.value = false;
}

function _newOptionId(): string {
  // 8-hex matches the server-side backfill in `ModuleRepository._backfill_option_ids`.
  // Two random ints concatenated to dodge the .slice(2, 8) yielding 6-7 chars.
  const a = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  const b = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${a}${b}`;
}

function addOption() {
  options.value.push({ id: _newOptionId(), value: "", weight: 1, sub_categories: [] });
}

/* ── Bulk edit ──────────────────────────────────────────────────────────
 * Bulk mode adds a checkbox column + a selection toolbar that mutates every
 * checked row at once, plus an inline paste panel for bulk-adding options.
 * All mutations go through the same `options` / `subCategories` refs so
 * snapshot()/dirty tracking stays correct. */
const bulkMode = ref(false);
/* ── Reordering ─────────────────────────────────────────────────────── */

/**
 * Armed state for "Move here": the selection is chosen, the landing point is
 * not. While armed, the boundary between any two unselected rows is clickable
 * and nothing else on the row responds, so a stray click cannot edit a weight
 * instead of placing the block.
 */
const moveArmed = ref(false);

/** Index of the row being dragged, or null. */
const dragFrom = ref<number | null>(null);
/** Index whose top edge the drop line is currently showing on. */
const dragOver = ref<number | null>(null);

function onOptDragStart(i: number, ev: DragEvent): void {
  // Never while filtered: a drop between two visible rows says nothing about
  // the hidden rows between them, so there is no honest position to compute.
  if (optionFilterActive.value) { ev.preventDefault(); return; }
  dragFrom.value = i;
  ev.dataTransfer?.setData("text/plain", String(i));
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
}

function onOptDragEnd(): void {
  dragFrom.value = null;
  dragOver.value = null;
}

function onOptDragOver(i: number, ev: DragEvent): void {
  if (dragFrom.value === null) return;
  ev.preventDefault();
  dragOver.value = i;
}

function onOptDrop(i: number): void {
  const from = dragFrom.value;
  onOptDragEnd();
  if (from === null || from === i) return;
  const row = options.value[from];
  if (!row) return;
  const target = options.value[i];
  options.value = target
    ? moveSelected(options.value, new Set([row.id]), { to: "before", id: target.id })
    : moveSelected(options.value, new Set([row.id]), { to: "bottom" });
}

function moveSelectedTo(target: MoveTarget): void {
  const ids = new Set(selectedIds.value);
  const before = options.value;
  const next = moveSelected(before, ids, target);
  moveArmed.value = false;
  if (next.length === before.length && next.every((o, i) => o === before[i])) return;
  options.value = next;
  // A scattered selection collapses into one contiguous block, which is the
  // only coherent answer but still a surprise the first time — so it is
  // stated rather than left to be discovered.
  const n = ids.size;
  const where = target.to === "top" ? "to the top"
    : target.to === "bottom" ? "to the bottom"
      : "into place";
  bulkNote.value = `Moved ${n} option${n === 1 ? "" : "s"} ${where}.`;
}

/** One-step keyboard move. The only reordering that stays usable at 130 rows,
 *  where a drag turns into an auto-scroll fight. */
function nudgeOption(id: string, dir: -1 | 1): void {
  options.value = nudge(options.value, id, dir);
}

/* ── Options search ────────────────────────────────────────────────── */

/**
 * Text + tag filter over the options list.
 *
 * A wildcard here carries 130+ options; before this the only way to reach one
 * was to scroll and read. The filter narrows the VIEW only — nothing is
 * removed, and the empty state says so, because an empty table in a list you
 * can also delete rows from is an alarming thing to be shown.
 */
const optQuery = ref("");
const optTagFilter = ref<string[]>([]);
const optTagMenuOpen = ref(false);
/** Viewport coordinates for the teleported filter menu. */
const optFilterAnchor = ref({ top: 0, left: 0 });
/** True when the filter menu should grow upward instead. */
const optFilterDropUp = ref(false);

/** The filter button, kept so the menu can be re-measured against it. */
let optFilterTriggerEl: HTMLElement | null = null;

function positionFilterMenu(): void {
  const r = optFilterTriggerEl?.getBoundingClientRect();
  if (!r) return;
  // Prefer below, but flip when there is meaningfully more room above — near
  // the foot of the page a downward menu has nowhere to go, and capping its
  // height there would leave a 140px sliver.
  const below = window.innerHeight - r.bottom;
  const above = r.top;
  optFilterDropUp.value = below < 260 && above > below;
  optFilterAnchor.value = {
    top: optFilterDropUp.value ? r.top - 4 : r.bottom + 4,
    left: r.left,
  };
}

function toggleOptTagMenu(ev: MouseEvent): void {
  const opening = !optTagMenuOpen.value;
  optTagMenuOpen.value = opening;
  if (!opening) return;
  optFilterTriggerEl = (ev.currentTarget as HTMLElement | null) ?? null;
  positionFilterMenu();
}

const optionFilter = computed(() => ({
  query: optQuery.value,
  tags: optTagFilter.value,
}));
const optionFilterActive = computed(() => filterIsActive(optionFilter.value));

/** Rows to render, each keeping its ORIGINAL index. Every row action —
 *  `removeOption(i)`, the `wc-opt-row-${i}` hooks — addresses the option by its
 *  position in `options`, so filtering must not renumber them. */
const visibleOptionRows = computed<{ o: WildcardOption; i: number }[]>(() => {
  const pairs = options.value.map((o, i) => ({ o, i }));
  if (!optionFilterActive.value) return pairs;
  return pairs.filter(({ o }) => optionMatches(o, optionFilter.value));
});

/** Tags the filter is asking for, as a set — drives chip promotion below. */
const matchedTagSet = computed(() => new Set(optTagFilter.value));

function toggleOptTagFilter(tag: string): void {
  const next = new Set(optTagFilter.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  optTagFilter.value = subCategories.value.filter((t) => next.has(t));
}

function clearOptionFilter(): void {
  optQuery.value = "";
  optTagFilter.value = [];
}

const bulkAddOpen = ref(false);
// Bulk add and the AI panel show one at a time (Dumi, 2026-10-22: both
// open filled the screen); the hidden one keeps what it holds.
watch(bulkAddOpen, (open) => { if (open) aiDraftOpen.value = false; });
watch(aiDraftOpen, (open) => { if (open) bulkAddOpen.value = false; });
const selectedIds = ref<Set<string>>(new Set());
const bulkNote = ref("");

const selectedCount = computed(() => selectedIds.value.size);

/**
 * The rows select-all reaches: what the FILTER is showing, not every option.
 *
 * Every row is selectable, the null option included — selection drives moves,
 * weight and delete, all of which it takes part in. Tag actions skip it
 * separately; see `taggableSelection`.
 *
 * Scoping this to the full `options` list meant filtering 200 options down to 4,
 * clicking the header checkbox and then hitting a bulk action — delete, or set
 * weight, or a tag change — applied it to all 200. Delete at least changes the
 * row count; `setWeightSelected` rewrote every weight in the list silently, and
 * a hand-tuned distribution has no undo.
 *
 * Same fix as `useBulkSelection`'s `getVisibleIds`, which the three simpler
 * editors take. This editor predates that composable and was never migrated,
 * so it carried the bug independently.
 */
const selectableVisibleOptions = computed(() => visibleOptionRows.value.map(({ o }) => o));
const allSelected = computed(
  () =>
    selectableVisibleOptions.value.length > 0 &&
    selectableVisibleOptions.value.every((o) => selectedIds.value.has(o.id as string)),
);
/** ≥1 (but not necessarily all) VISIBLE rows checked — drives the select-all
 *  checkbox's indeterminate dash. */
const someSelected = computed(() =>
  selectableVisibleOptions.value.some((o) => selectedIds.value.has(o.id as string)),
);

/** Sub-categories present on ≥1 selected row (union), in registry order —
 *  the Remove menu's candidate list, so it only offers tags the selection
 *  actually carries (removing a tag no row has would be a no-op). */
const presentSelectedTags = computed<string[]>(() => {
  const present = new Set<string>();
  for (const o of options.value) {
    if (!isSelected(o.id)) continue;
    for (const t of o.sub_categories ?? []) present.add(t);
  }
  return subCategories.value.filter((t) => present.has(t));
});
/** Sub-categories already on EVERY selected row (intersection) — excluded
 *  from the Apply menu since applying one there changes nothing. */
const commonSelectedTags = computed<string[]>(() => {
  const sel = options.value.filter((o) => isSelected(o.id));
  if (sel.length === 0) return [];
  return subCategories.value.filter((t) =>
    sel.every((o) => (o.sub_categories ?? []).includes(t)),
  );
});
/** tag → axis hue, so the Apply/Remove menu chips read with the same colour
 *  as the pills and option-row chips (shared `tagHue`). */
const selectedTagHues = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {};
  for (const t of subCategories.value) m[t] = tagHue(t);
  return m;
});

function toggleBulkMode(): void {
  bulkMode.value = !bulkMode.value;
  if (!bulkMode.value) {
    selectedIds.value = new Set();
    bulkAddOpen.value = false;
    bulkNote.value = "";
  }
}
function isSelected(id: string | undefined): boolean {
  return typeof id === "string" && selectedIds.value.has(id);
}
function toggleSelect(id: string | undefined): void {
  if (typeof id !== "string") return;
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}
/** Adds or removes ONLY the visible rows, in both directions, so it can never
 *  reach a row the filter is hiding. A selection made under a previous query
 *  survives — `selectedCount` reports the honest total, and the bulk bar shows
 *  it. Only select-all was ever the hazard. */
function toggleSelectAll(): void {
  const visible = selectableVisibleOptions.value.map((o) => o.id as string);
  const next = new Set(selectedIds.value);
  if (allSelected.value) for (const id of visible) next.delete(id);
  else for (const id of visible) next.add(id);
  selectedIds.value = next;
}
function clearSelection(): void {
  selectedIds.value = new Set();
}
function selectedOptionList(): WildcardOption[] {
  return options.value.filter((o) => isSelected(o.id));
}

/** Existing option values (non-empty) for the bulk-add duplicate check. */
const existingOptionValues = computed(() =>
  options.value.map((o) => o.value).filter((v) => v.trim().length > 0),
);

/** Ensure a sub-category is registered, auto-creating it in the Ungrouped
 *  box when new. Returns false (and registers nothing) on an invalid name. */
function ensureSubcat(name: string): boolean {
  const raw = name.trim();
  if (!raw) return false;
  if (subCategories.value.includes(raw)) return true;
  if (validateSubcatName(raw)) return false;
  subCategories.value = [...subCategories.value, raw];
  return true;
}

/**
 * Bulk tag actions skip the null option.
 *
 * The engine refuses a null option that carries any: "null option must have no
 * sub_categories" (wildcard_handler.py). Its participation in the pool is
 * governed solely by `exclude_null`, so a tag on it could not change anything
 * even if it were allowed. Bulk edit was writing them anyway — invisibly,
 * since the row renders a dash instead of chips — and the save would have been
 * rejected server-side.
 *
 * The row stays selectable, because selection also drives moves and delete,
 * which it can take part in.
 */
function taggableSelection(): WildcardOption[] {
  return options.value.filter((o) => selectedIds.value.has(o.id) && !o.is_null);
}

function applyTagToSelected(tag: string): void {
  bulkNote.value = "";
  if (!ensureSubcat(tag)) {
    bulkNote.value = `"${tag.trim()}" is not a valid sub-category name.`;
    return;
  }
  const t = tag.trim();
  for (const o of taggableSelection()) {
    const current = new Set(o.sub_categories ?? []);
    current.add(t);
    // Re-derive in registry order so chips stay stably sorted (mirrors toggleOptionTag).
    o.sub_categories = subCategories.value.filter((s) => current.has(s));
  }
}
function removeTagFromSelected(tag: string): void {
  bulkNote.value = "";
  for (const o of taggableSelection()) {
    o.sub_categories = (o.sub_categories ?? []).filter((s) => s !== tag);
  }
}
function setWeightSelected(weight: number): void {
  bulkNote.value = "";
  // Floor at 0.01 like the per-row weight input — weight 0 never picks.
  const w = Number.isFinite(weight) && weight > 0 ? weight : 0.01;
  for (const o of selectedOptionList()) o.weight = w;
}

/* ── Bulk negative (send-to-negative) ─────────────────────────────── */

/** Rows Add / Replace write to: the selection minus the null option. The null
 *  option CAN carry a negative (edited on its own row), but a bulk phrase meant
 *  for real options is almost never meant for "nothing was picked". */
function negativeWritableSelection(): WildcardOption[] {
  return selectedOptionList().filter((o) => !o.is_null);
}
const selectedNegativeCount = computed(
  () => selectedOptionList().filter((o) => !!o.negative).length,
);
const selectedNegativeTargets = computed(() => negativeWritableSelection().length);

function addNegativeToSelected(words: string): void {
  bulkNote.value = "";
  for (const o of negativeWritableSelection()) setNegative(o, appendNegative(o.negative, words));
}
function replaceNegativeOnSelected(words: string): void {
  bulkNote.value = "";
  for (const o of negativeWritableSelection()) setNegative(o, words);
}
function clearNegativeOnSelected(): void {
  bulkNote.value = "";
  for (const o of selectedOptionList()) setNegative(o, undefined);
}

/** Bulk-delete checked options. Options referenced by constraints are kept
 *  (those need the per-option cascade review via the single-row trash) and
 *  reported so the deletion stays safe. */
function deleteSelected(): void {
  bulkNote.value = "";
  const removable = new Set<string>();
  let blocked = 0;
  for (const o of selectedOptionList()) {
    const id = o.id;
    const refd = props.id && typeof id === "string" && id && cascade.optionRefsTo(id).length > 0;
    if (refd) blocked += 1;
    else if (typeof id === "string") removable.add(id);
  }
  options.value = options.value.filter((o) => !removable.has(o.id as string));
  const next = new Set(selectedIds.value);
  for (const id of removable) next.delete(id);
  selectedIds.value = next;
  if (blocked > 0) {
    bulkNote.value = `${blocked} referenced option${blocked === 1 ? "" : "s"} kept — remove individually to review affected constraints.`;
  }
}

/** Commit bulk-added options from the paste panel: register any new tags
 *  (auto-created in Ungrouped), then append one option per parsed line with
 *  its tags in registry order. */
/**
 * A row the user has not written anything into yet.
 *
 * A new wildcard opens with two blank options so the table is not an empty
 * void. Bulk add appended past them, so a first batch left two blanks sitting
 * above everything that was just added — which then fail validation on save
 * (an option's value must be a non-empty string). Untouched blanks are
 * consumed by the incoming batch instead: they were scaffolding, not content.
 *
 * A blank the user tagged or re-weighted is NOT untouched — they were working
 * on it — so only the fully default row qualifies.
 */
function isUntouchedBlank(o: WildcardOption): boolean {
  return !o.is_null
    && (o.value ?? "").trim() === ""
    && (o.sub_categories ?? []).length === 0
    && (o.weight === 1 || o.weight === undefined)
    && !o.negative;
}

/** Make `axis` an `accepts` group, or say why its name can't be one — the
 *  same check the sub-categories card's kind toggle runs. */
function promoteToAccepts(axis: string): void {
  const refusal = acceptsPromotionRefusal(axis);
  if (refusal) {
    toast.push({ severity: "warn", ...refusal, life: 6000 });
    return;
  }
  tagGroupKinds.value = { ...tagGroupKinds.value, [axis]: "accepts" };
}

/** Tag groups from an AI draft, applied just before its options: new tags
 *  are registered, each tag moves into its group (a tag lives in one group),
 *  and "accepts" goes through the same name check as the toggle. */
function commitAiGroups(groups: AiDraftGroup[]): void {
  for (const g of groups) {
    const axis = g.name.trim();
    if (!axis || axis === OTHER_AXIS) continue;
    const members = g.tags.filter((t) => ensureSubcat(t));
    const next: Record<string, string[]> = {};
    for (const [a, ms] of Object.entries(tagGroups.value)) {
      next[a] = a === axis ? ms : ms.filter((m) => !members.includes(m));
    }
    next[axis] = [...(next[axis] ?? []), ...members.filter((m) => !(next[axis] ?? []).includes(m))];
    tagGroups.value = next;
    if (g.kind === "accepts" && tagGroupKinds.value[axis] !== "accepts") promoteToAccepts(axis);
  }
}

function commitAiDraft(parsed: ParsedBulkOption[]): void {
  commitBulkAddOptions(parsed);
  aiDraftOpen.value = false;
}

/** Apply reviewed AI edits to the draft. Rows that changed or vanished since
 *  the request are matched by id, so a stale change just doesn't land. An
 *  option other modules point at isn't removed here: that needs the cascade
 *  dialog, so it is left for the user to delete by hand. */
function applyAiEdits(action: AiWildcardEditAction, changes: AiWildcardEditChange[]): void {
  const byId = new Map(changes.map((c) => [c.option_id, c]));
  let done = 0;
  let kept = 0;
  if (action === "remove") {
    options.value = options.value.filter((o) => {
      if (typeof o.id !== "string" || !byId.has(o.id)) return true;
      if (props.id && cascade.optionRefsTo(o.id).length > 0) { kept += 1; return true; }
      done += 1;
      return false;
    });
    if (selectedIds.value.size) {
      const left = new Set(options.value.map((o) => o.id));
      selectedIds.value = new Set([...selectedIds.value].filter((id) => left.has(id)));
    }
  } else {
    for (const o of options.value) {
      const c = typeof o.id === "string" ? byId.get(o.id) : undefined;
      if (!c?.after) continue;
      if (action === "rewrite" && c.after.value) o.value = c.after.value;
      else if (action === "reweight" && typeof c.after.weight === "number") o.weight = c.after.weight;
      else if (action === "retag" && c.after.tags) {
        const tagSet = new Set(c.after.tags.filter((t) => ensureSubcat(t)).map((t) => t.trim()));
        o.sub_categories = subCategories.value.filter((s) => tagSet.has(s));
      } else continue;
      done += 1;
    }
  }
  const verb = action === "remove" ? "Removed" : "Changed";
  toast.push({ severity: "success", summary: `${verb} ${done} option${done === 1 ? "" : "s"}`, life: 2500 });
  if (kept > 0) {
    toast.push({
      severity: "warn",
      summary: `${kept} option${kept === 1 ? " is" : "s are"} used by other modules`,
      detail: "Delete those by hand so you can see what refers to them.",
      life: 6000,
    });
  }
}

function commitBulkAddOptions(parsed: ParsedBulkOption[]): void {
  bulkNote.value = "";
  let skippedTags = 0;
  // Drop the scaffolding rows first; anything the user actually touched stays.
  const blanks = options.value.filter(isUntouchedBlank).length;
  if (blanks > 0 && parsed.length > 0) {
    options.value = options.value.filter((o) => !isUntouchedBlank(o));
  }
  for (const p of parsed) {
    const tagSet = new Set<string>();
    for (const tag of p.tags) {
      if (ensureSubcat(tag)) tagSet.add(tag.trim());
      else skippedTags += 1;
    }
    options.value.push({
      id: _newOptionId(),
      value: p.value,
      weight: p.weight,
      sub_categories: subCategories.value.filter((s) => tagSet.has(s)),
      ...(p.negative ? { negative: p.negative } : {}),
    });
  }
  bulkAddOpen.value = false;
  toast.push({ severity: "success", summary: `Added ${parsed.length} option${parsed.length === 1 ? "" : "s"}`, life: 2500 });
  if (skippedTags > 0) {
    bulkNote.value = `${skippedTags} invalid tag${skippedTags === 1 ? "" : "s"} skipped.`;
  }
}

/** Returns true when the options list already contains a null option. */
const hasNullOption = computed<boolean>(
  () => options.value.some((o) => o.is_null === true),
);

/** Add the single permitted null option to the wildcard. The null
 *  option carries `value: ""`, `sub_categories: []`, and `is_null: true`;
 *  when the wildcard rolls it the engine emits an empty string —
 *  a probabilistic "no output" slot. Idempotent: no-op if one
 *  already exists. New entries land at index 0 so the editor's natural
 *  top-down read surfaces the special row first. */
function addNullOption(): void {
  if (hasNullOption.value) return;
  options.value = [
    {
      id: _newOptionId(),
      value: "",
      weight: 1,
      sub_categories: [],
      is_null: true,
    },
    ...options.value,
  ];
}

/** Move the null option (if any) to index 0. Called from the save
 *  path so serialised payloads always have null first regardless of
 *  whatever drag-sort the user did mid-edit. */

async function removeOption(idx: number): Promise<void> {
  const opt = options.value[idx];
  if (!opt) return;
  // Unsaved wildcard or option without id → splice locally, no cascade.
  if (!props.id || typeof opt.id !== "string" || !opt.id) {
    options.value.splice(idx, 1);
    return;
  }
  const refs = cascade.optionRefsTo(opt.id);
  if (refs.length === 0) {
    options.value.splice(idx, 1);
    return;
  }
  // Refs present → open the confirm dialog. The dialog calls apply via
  // useCascadeApply; on confirm we splice the option locally + show Undo.
  cascadeDialogProps.value = {
    kind: "option",
    id: opt.id,
    action: "delete",
    extra: { wildcard_id: props.id, _row_idx: idx },
  };
  cascadeDialogOpen.value = true;
}

function applyRestore(entry: ModuleHistoryEntry): void {
  name.value = entry.name;
  description.value = entry.description ?? "";
  categoryId.value = entry.category_id ?? null;
  tags.value = entry.tags ? [...entry.tags] : [];
  const p = (entry.payload ?? {}) as Partial<WildcardPayload>;
  options.value = (p.options ?? []).map((o) => ({
    ...o,
    sub_categories: Array.isArray(o.sub_categories) ? [...o.sub_categories] : [],
  }));
  subCategories.value = [...(p.sub_categories ?? [])];
  tagGroups.value = normalizeTagGroups(p.tag_groups, subCategories.value);
  tagGroupKinds.value = normalizeTagGroupKinds(p.tag_group_kinds, tagGroups.value);
  varBinding.value = (p.var_binding && p.var_binding.trim()) || toIdentifier(entry.name);
  toast.push({
    severity: "info",
    summary: "Version restored",
    detail: `Restored from ${new Date(entry.saved_at).toLocaleString()}; click Save to commit.`,
    life: 4000,
  });
}

/** The payload as Save stores it. */
function currentPayload(binding = varBinding.value.trim() || toIdentifier(name.value)): WildcardPayload {
  // The null option keeps whatever position the user gave it. The engine
  // locates it by the `is_null` flag, never by index, so pinning it to 0 on
  // save only served to undo a reorder the user had just performed.
  // Serialise tag_groups, dropping empty axes (a "+ Group" box the user
  // created but never filled) + members no longer in the registry. Omit
  // the key entirely when nothing is grouped, keeping legacy payloads
  // byte-identical when grouping is unused.
  const serializedGroups = serializeTagGroups(
    tagGroups.value, subCategories.value, ui.keepEmptyTagGroups,
  );
  const serializedKinds = serializeTagGroupKinds(tagGroupKinds.value, serializedGroups);
  return {
    // An emptied negative is stored as an ABSENT key (schema v8 stamps
    // only when a negative is really there).
    options: pruneBlankNegatives(options.value),
    sub_categories: subCategories.value,
    var_binding: binding,
    ...(serializedGroups ? { tag_groups: serializedGroups } : {}),
    ...(serializedKinds ? { tag_group_kinds: serializedKinds } : {}),
  };
}

async function save() {
  // Update varBindingError synchronously so the rollup picks it up
  // in the same tick. The validation computed reads this ref.
  const finalBinding = varBinding.value.trim() || toIdentifier(name.value);
  if (varBinding.value.trim() && !isValidVariableName(finalBinding)) {
    varBindingError.value = "Use letters, digits, underscores; must not start with a digit.";
  } else {
    varBindingError.value = "";
  }
  if (validationErrors.value.length > 0) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;
  setSaveState("saving");
  saving.value = true;
  try {
    const newPayload = currentPayload(finalBinding) as unknown as Record<string, unknown>;
    if (isEdit.value && props.id) {
      const prev = await moduleStore.get(props.id);
      const nextHistory = appendSnapshot(
        {
          name: prev.name,
          description: prev.description,
          category_id: prev.category_id,
          tags: prev.tags,
          payload: prev.payload as Record<string, unknown>,
        },
        prev.payload as Record<string, unknown>,
      );
      await moduleStore.update(props.id, {
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: { ...newPayload, history: nextHistory },
        content_rating: contentRating.value,
      });
      historyEntries.value = nextHistory;
      recent.push({ id: props.id, kind: "wildcard", name: name.value });
    } else {
      // New mode: the mount-time recent push fires next time the item opens.
      // A chat draft is created at the id its card reserved.
      const created = await moduleStore.create({
        ...draftCreateId(chatDraft),
        type: "wildcard",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: newPayload,
        content_rating: contentRating.value,
      });
      draftSaved(chatDraft, created?.id);
      chatDraft = null;
    }
    draft.discard();
    setSaveState("saved", 1500);
    baseline.value = snapshot();
    toast.push({
      severity: "success",
      summary: isEdit.value ? "Saved" : "Created",
      detail: name.value,
    });
    router.push(resolveReturnTo("/wildcards"));
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    setSaveState("error", 3000);
    toast.push({ severity: "error", summary: "Save failed", detail: saveError.value, life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() { router.push(resolveReturnTo("/wildcards")); }

useEditorShortcuts({
  onSave: () => save(),
  onCancel: () => cancel(),
  enabled: () => !saving.value,
});

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/wildcards", label: "Wildcards" },
  { label: isEdit.value ? (name.value || "Editing") : "New wildcard" },
]);

/** Set true on the first Save click while invalid; cleared on a
 *  valid save. Gates rollup visibility so the banner is feedback,
 *  not a nagging pre-emptive scolding while the user is still
 *  filling the form. */
const showErrors = ref(false);

const validationErrors = computed<EditorFieldError[]>(() => {
  const out: EditorFieldError[] = [];
  if (!name.value.trim()) {
    out.push({ field: "editor-section-identity", label: "Name", message: "Required" });
  } else {
    // Wildcard names become the `#name` segment of nested refs. The
    // canonical rule (mirrors `wp_api/_validators.py`) lives in
    // `validation/names` so the editor rejects exactly what the rename
    // dialog + server reject.
    const refErr = validateRefGrammarName(name.value);
    if (refErr) {
      out.push({
        field: "editor-section-identity",
        label: "Name",
        message: refErr,
      });
    }
  }
  if (varBindingError.value) {
    out.push({ field: "editor-section-identity", label: "$variable binding", message: varBindingError.value });
  }
  if (options.value.length === 0) {
    out.push({ field: "editor-section-options", label: "Options", message: "At least one option is required" });
  } else {
    for (let i = 0; i < options.value.length; i++) {
      const o = options.value[i];
      // Null option's `value` is intentionally empty — skip the
      // non-empty-string check for it. See spec
      // `docs/superpowers/specs/2026-05-24-null-wildcard-option-design.md`.
      if (o.is_null) continue;
      if (!o.value || !o.value.trim()) {
        out.push({ field: "editor-section-options", label: `Option #${i + 1}`, message: "Value cannot be empty" });
        break;
      }
    }
  }
  return out;
});

const visibleErrors = computed<EditorFieldError[]>(() =>
  showErrors.value ? validationErrors.value : [],
);

defineExpose({
  historyEntries, applyRestore, options, subCategories, tagGroups, renameGroup, ungroupAxis,
});
</script>

<template>
  <EditorFrame
    :save-disabled="bulkAddOpen || aiPending"
    :save-disabled-reason="aiPending
      ? 'Add or discard the AI draft first, with its own buttons'
      : 'Finish or cancel the bulk add first — use its own Add / Cancel buttons'"
    :title="isEdit ? 'Edit wildcard' : 'New wildcard'"
    back-route="/wildcards"
    back-label="Wildcards"
    :breadcrumb="breadcrumb"
    :saving="saving"
    :save-state="saveState"
    :save-error="saveError"
    :dirty="dirty"
    :history-entries="historyEntries"
    :errors="visibleErrors"
    @save="save"
    @cancel="cancel"
    @restore="applyRestore"
  >
    <template v-if="isEdit && currentRow" #header-extra>
      <SendToTestRunner v-if="props.id" :kind="'wildcard'" :id="props.id" />
      <CommunityRowActions :row="currentRow" kind="module" labeled />
    </template>
    <template v-if="isEdit" #footer-left>
      <Button
        variant="ghost"
        icon="pi-trash"
        class="wp-btn--danger"
        data-test="wc-delete-btn"
        @click="onEntityDeleteClick"
      >Delete</Button>
    </template>
    <template #draft-banner>
      <DraftBanner
        :has-draft="draft.hasDraft.value"
        :age-ms="draft.draftAge.value"
        @restore="applyDraft"
        @discard="draft.discard"
      />
    </template>
    <div id="editor-section-identity">
      <IdentityCard
        ref="identityCard"
        ai-kind="wildcard"
        :ai-payload="() => ({ var_binding: varBinding, sub_categories: subCategories, options })"
        :name="name"
        :description="description"
        :category-id="categoryId"
        :tags="tags"
        :var-binding="varBinding"
        :var-binding-error="varBindingError"
        @update:name="(v) => (name = v)"
        @update:description="(v) => (description = v)"
        @update:category-id="(v) => (categoryId = v)"
        :content-rating="contentRating"
        @update:tags="(v) => (tags = v)"
        @update:content-rating="(v) => (contentRating = v)"
        @update:var-binding="(v) => (varBinding = v)"
      />
    </div>

    <div id="editor-section-sub-categories">
      <WildcardSubcategoriesCard
        ref="subcatCard"
        v-model:open="subcatOpen"
        v-model:sub-categories="subCategories"
        v-model:tag-groups="tagGroups"
        v-model:tag-group-kinds="tagGroupKinds"
        :options="options"
        :var-binding="varBinding"
        @rename-tag="onSubcatRenameClick"
        @delete-tag="(tag: string) => void onSubcatDeleteClick(tag)"
      />
    </div>

    <div id="editor-section-options">
    <Card :title="`Options (${options.length})`" :padding="false" sticky-header>
      <template #actions>
        <!-- One row. The filter and the row-count belong with Bulk edit / Add
             option: they all act on the same list, and splitting them over two
             bars made the header taller than the first option. The filter takes
             the flexible width; the buttons keep their intrinsic size. -->
        <OptionFilterBar
          v-if="options.length > 8"
          v-model:query="optQuery"
          :total="options.length"
          :shown="visibleOptionRows.length"
          :active="optionFilterActive"
          :all-tags="subCategories"
          :groups="subcatGroups"
          :selected-tags="optTagFilter"
          :menu-open="optTagMenuOpen"
          :anchor="optFilterAnchor"
          :drop-up="optFilterDropUp"
          :tag-style="chipStyle"
          @toggle-menu="toggleOptTagMenu"
          @toggle-tag="toggleOptTagFilter"
          @clear="clearOptionFilter"
        />
        <Button
          size="sm"
          :variant="bulkMode ? 'secondary' : 'ghost'"
          icon="pi-check-square"
          data-test="wc-bulk-toggle"
          @click="toggleBulkMode"
        >{{ bulkMode ? "Done" : "Bulk edit" }}</Button>
        <Button
          v-if="bulkMode"
          size="sm"
          variant="ghost"
          icon="pi-clipboard"
          data-test="wc-bulk-add" data-ai-anchor="bulk-add" data-ai-label="Bulk add button"
          @click="bulkAddOpen = !bulkAddOpen"
        >Bulk add</Button>
        <Button
          v-if="ai.config.value?.enabled"
          size="sm"
          :variant="aiDraftOpen ? 'secondary' : 'ghost'"
          icon="pi-microchip-ai"
          data-test="wc-ai-draft" data-ai-anchor="ai-panel-button" data-ai-label="AI button (draft or edit options)"
          :title="!aiDraftOpen && aiPending ? 'Your AI draft is waiting here' : undefined"
          @click="aiDraftOpen = !aiDraftOpen"
        >{{ !aiDraftOpen && aiPending ? "AI · draft" : "AI" }}</Button>
        <Button
          size="sm"
          variant="ghost"
          icon="pi-ban"
          :disabled="hasNullOption"
          data-test="wc-add-null"
          @click="addNullOption"
        >Add null</Button>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="wc-add-opt" data-ai-anchor="add-option" data-ai-label="Add option button" @click="addOption">
          Add option
        </Button>
      </template>
      <template #subheader>
      <div v-if="bulkMode && (selectedCount > 0 || bulkNote)" class="wpc-bulk-controls">
        <SelectionToolbar
          v-if="selectedCount > 0"
          :count="selectedCount"
          :tags="subCategories"
          :common-tags="commonSelectedTags"
          :present-tags="presentSelectedTags"
          :tag-hues="selectedTagHues"
          reorderable
          :move-armed="moveArmed"
          negatives
          :negative-count="selectedNegativeCount"
          :negative-targets="selectedNegativeTargets"
          @apply-tag="applyTagToSelected"
          @remove-tag="removeTagFromSelected"
          @set-weight="setWeightSelected"
          @negative-add="addNegativeToSelected"
          @negative-replace="replaceNegativeOnSelected"
          @negative-clear="clearNegativeOnSelected"
          @move-top="moveSelectedTo({ to: 'top' })"
          @move-bottom="moveSelectedTo({ to: 'bottom' })"
          @move-here="moveArmed = !moveArmed"
          @delete-selected="deleteSelected"
          @clear="clearSelection"
        />
        <p v-if="bulkNote" class="wpc-bulk-note" role="status">{{ bulkNote }}</p>
      </div>
      </template>
      <!-- Not in the sticky subheader: a tall panel there covered the
           options and the page couldn't scroll past it. Bulk add and the AI
           panel show one at a time; each keeps what it holds while hidden. -->
      <div
        v-if="bulkMode && (bulkAddOpen || bulkPending)"
        v-show="bulkAddOpen"
        class="wpc-bulk-controls wpc-ai-controls"
      >
        <BulkAddPanel
          mode="options"
          :existing-values="existingOptionValues"
          :existing-tags="subCategories"
          @commit-options="commitBulkAddOptions"
          @cancel="bulkAddOpen = false; bulkPending = false"
          @update:pending="(v: boolean) => (bulkPending = v)"
        />
      </div>
      <!-- Kept (hidden) while it holds a draft: Close used to throw it away. -->
      <div
        v-if="ai.config.value?.enabled && (aiDraftOpen || aiPending)"
        v-show="aiDraftOpen"
        class="wpc-bulk-controls wpc-ai-controls"
      >
        <AiWildcardPanel
          ref="aiPanel"
          :module-id="props.id"
          :name="name"
          :var-binding="varBinding"
          :options="options"
          :selected-ids="selectedIds"
          :existing-tags="subCategories"
          :tag-groups="tagGroups"
          :tag-group-kinds="tagGroupKinds"
          :description="description"
          :labels="tags"
          @commit-groups="commitAiGroups"
          @commit-options="commitAiDraft"
          @apply-edits="applyAiEdits"
          @cancel="aiDraftOpen = false"
          @update:pending="(v: boolean) => (aiPending = v)"
        />
      </div>
      <table class="wp-table wp-options-table" data-ai-anchor="options" data-ai-label="Options list">
        <thead>
          <tr>
            <th v-if="bulkMode" scope="col" class="opt-col-check">
              <Checkbox
                :model-value="allSelected"
                :indeterminate="someSelected"
                aria-label="Select all options"
                data-test="wc-bulk-select-all"
                @update:model-value="toggleSelectAll"
              />
            </th>
            <th scope="col" class="opt-col-grip"><span class="wp-sr-only">Reorder</span></th>
            <th scope="col" class="opt-col-weight">Weight</th>
            <th scope="col">Value</th>
            <th scope="col" class="opt-col-sub">Sub-category</th>
            <th scope="col" class="opt-col-prob">Probability</th>
            <th scope="col" class="opt-col-trash"><span class="wp-sr-only">Remove option</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="{ o, i } in visibleOptionRows"
            :key="o.id"
            :data-test="o.is_null ? 'wc-opt-row-null' : `wc-opt-row-${i}`"
            :class="{
              'wc-opt-row--null': o.is_null,
              'wc-opt-row--fallback': o.fallback,
              'wc-opt-row--selected': bulkMode && isSelected(o.id),
              'wc-opt-row--dragging': dragFrom === i,
              'wc-opt-row--dropbefore': dragOver === i && dragFrom !== null && dragFrom !== i,
              'wc-opt-row--cargo': moveArmed && isSelected(o.id),
              'wc-opt-row--landing': moveArmed && !isSelected(o.id),
              'wc-opt-row--broken': (!o.is_null && optionBrokenRefs(o.value).length > 0)
                || optionBrokenRefs(o.negative ?? '').length > 0,
            }"
            @dragover="onOptDragOver(i, $event)"
            @drop.prevent="onOptDrop(i)"
            @click="moveArmed && !isSelected(o.id)
              ? moveSelectedTo({ to: 'before', id: o.id })
              : undefined"
          >
            <!-- Landing point for an armed "Move here". A zero-height row
                 would be unclickable, so the strip lives inside the first cell
                 of the row it lands ABOVE. -->
            <td v-if="bulkMode" class="opt-col-check">
              <button
                type="button"
                class="wp-check"
                role="checkbox"
                :aria-checked="isSelected(o.id)"
                :data-checked="isSelected(o.id) ? 'true' : 'false'"
                :aria-label="`Select option ${i + 1}`"
                :data-test="`wc-opt-check-${i}`"
                @click="toggleSelect(o.id)"
              >
                <svg v-if="isSelected(o.id)" viewBox="0 0 12 12" fill="none" style="display:block">
                  <path d="M3 6.2l2.2 2.2L9 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </td>
            <td class="opt-col-grip">
              <!-- The only pointer affordance the value cell's contenteditable
                   does not poison: a press here is unambiguous, because it is
                   not a text surface. Hidden until row hover so the resting
                   table looks unchanged; disabled while a filter is active,
                   since dropping between two visible rows says nothing about
                   the hidden ones between them. The bulk moves above stay
                   available there — their destination is absolute. -->
              <button
                type="button"
                class="opt-grip"
                :disabled="optionFilterActive || undefined"
                :title="optionFilterActive
                  ? 'Dragging is off while a filter is active — use Bulk edit ▸ Top / Bottom / Move here'
                  : 'Drag to reorder · Alt+↑/↓ to move one step'"
                :aria-label="`Reorder ${o.value || 'option'}`"
                :data-test="`wc-opt-grip-${i}`"
                draggable="true"
                @dragstart="onOptDragStart(i, $event)"
                @dragend="onOptDragEnd"
                @keydown.alt.up.prevent="nudgeOption(o.id, -1)"
                @keydown.alt.down.prevent="nudgeOption(o.id, 1)"
              ><i class="pi pi-bars" aria-hidden="true" /></button>
            </td>
            <td>
              <Input
                :model-value="o.weight"
                type="number"
                size="sm"
                min="0.01"
                step="0.1"
                aria-label="Option weight"
                @update:model-value="(v) => {
                  // Clamp to >0 — weight 0 or negative never picks
                  // (probability normalises away). Editor floors at
                  // 0.01 so a typo can't silently disable an option.
                  // To disable an option, use the per-instance toggle
                  // in the Context node (engine respects that).
                  const n = Number(v);
                  o.weight = Number.isFinite(n) && n > 0 ? n : 0.01;
                }"
              />
            </td>
            <td>
              <span v-if="o.is_null" class="wc-null-chip" aria-label="null option (resolves to empty)">
                <i class="pi pi-ban" aria-hidden="true" />
                <span>null</span>
              </span>
              <!-- `wrap`: option values run from one tag to a whole paragraph.
                   Without it the field clipped behind a horizontal scroll at a
                   fixed 34px, so a long value was effectively invisible.
                   Single-value semantics are unchanged — Enter still commits. -->
              <RichTextInput
                v-else
                v-model="o.value"
                surface="wildcard"
                wrap
                :module-id="props.id"
                :ref-suggestions="wcSuggestions"
                :uuid-to-name="nameByUuid"
                :uuid-to-sub-categories="uuidToSubCategories"
                :uuid-to-option-tag-sets="uuidToOptionTagSets"
                :uuid-to-tag-groups="uuidToTagGroups"
                :uuid-to-has-null="uuidToHasNull"
                :uuid-to-options-count="uuidToOptionsCount"
                placeholder="value (type @ for nested wildcards · {a|b|c} for inline choices)"
                aria-label="Option value"
              />
              <div
                v-if="!o.is_null && optionBrokenRefs(o.value).length"
                class="wc-broken-note"
                :data-test="`wc-opt-broken-${i}`"
              >
                <i class="pi pi-exclamation-triangle" aria-hidden="true" />
                <span>{{ optionBrokenRefs(o.value).join(", ") }} not in the library · click the chip to point it at a module</span>
              </div>
              <!-- Send-to-negative: same grammar as the value (text, {a|b},
                   @{ref}). The null option may carry one too — "nothing was
                   picked" can still keep words out of the image. -->
              <NegativeField
                :model-value="o.negative"
                surface="wildcard"
                label="option"
                :test-id="`wc-opt-neg-${i}`"
                :broken-refs="optionBrokenRefs(o.negative ?? '')"
                :module-id="props.id"
                :ref-suggestions="wcSuggestions"
                :uuid-to-name="nameByUuid"
                :uuid-to-sub-categories="uuidToSubCategories"
                :uuid-to-option-tag-sets="uuidToOptionTagSets"
                :uuid-to-tag-groups="uuidToTagGroups"
                :uuid-to-has-null="uuidToHasNull"
                :uuid-to-options-count="uuidToOptionsCount"
                @update:model-value="(v: string | undefined) => setNegative(o, v)"
              />
            </td>
            <td>
              <span v-if="o.is_null" class="wc-em-dash" aria-hidden="true">—</span>
              <!-- Per-option grouped multi-select (§4.3, H2): assigned
                   tags render as removable chips (coloured by axis) and a
                   chevron opens a grouped checkbox picker. Membership only
                   — no boolean expression here. -->
              <OptionTagsCell
                v-else
                :option-id="o.id"
                :tags="o.sub_categories ?? []"
                :view="optionTagView(o)"
                :expanded="expandedOptTags.has(o.id)"
                :picker-open="openOptTagPicker === o.id"
                :anchor="optTagAnchor"
                :drop-up="pickerDropUp"
                :groups="optionTagGroups"
                :all-tags="subCategories"
                :tag-style="chipStyle"
                @toggle-tag="(t: string) => toggleOptionTag(o, t)"
                @toggle-expanded="toggleOptTagsExpanded(o.id)"
                @toggle-picker="(ev: MouseEvent) => toggleOptTagPicker(o.id, ev)"
              />
            </td>
            <td>
              <OptionProbabilityCell
                :percent="probabilityFor(o)"
                :is-null="!!o.is_null"
                :fallback="!!o.fallback"
                :index="i"
                @toggle-fallback="toggleFallback(o)"
              />
            </td>
            <td>
              <Button
                size="sm"
                variant="ghost"
                icon="pi-trash"
                class="wp-btn--danger"
                aria-label="Remove option"
                @click="removeOption(i)"
              />
            </td>
          </tr>
          <tr v-if="!options.length">
            <td :colspan="bulkMode ? 6 : 5" class="opt-empty">No options yet.</td>
          </tr>
          <tr v-if="optionFilterActive && visibleOptionRows.length === 0">
            <td :colspan="bulkMode ? 6 : 5" class="wc-optfilter__empty" data-test="wc-opt-noresults">
              <b>No option matches this filter</b>
              All {{ options.length }} are still here — only the view is filtered.
              <button type="button" class="wc-optfilter__clear" @click="clearOptionFilter">Clear filter</button>
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
    </div>

    <!-- CascadeConfirmDialog: shown when a sub-category pill X-click has
         downstream refs (refs > 0). Teleports to body internally. -->
    <CascadeConfirmDialog
      v-if="cascadeDialogProps"
      :open="cascadeDialogOpen"
      v-bind="cascadeDialogProps"
      @confirmed="onCascadeDialogConfirmed"
      @cancelled="onCascadeDialogCancelled"
    />

    <!-- CascadeRenameDialog: opened by the pencil button on a sub-category
         chip. Cascades the rename to any modules referencing this subcat. -->
    <CascadeRenameDialog
      v-if="props.id && subcatRenameTarget"
      :open="subcatRenameOpen"
      kind="subcategory"
      :id="props.id"
      :extra="{ subcat_name: subcatRenameTarget }"
      :initial-name="subcatRenameTarget"
      @confirmed="onSubcatRenameConfirmed"
      @cancelled="onSubcatRenameCancelled"
    />

    <!-- ConfirmDialog lives INSIDE EditorFrame so the template has a single
         root vnode. Multi-root templates break the parent RouterView's
         <Transition mode="out-in"> after this component unmounts — the
         transition tracker desyncs and the destination view never paints.
         Dialog still Teleports to body via its internal <Teleport>; the
         source placement here only affects vnode tracking. -->
    <ConfirmDialog
      :visible="showConfirm"
      :title="bulkPending || aiPending ? 'Discard un-added options?' : 'Discard unsaved changes?'"
      :body="aiPending
        ? 'The AI draft holds options you have not added. Leaving discards them.'
        : bulkPending
          ? 'The bulk add box still holds options you have not added. Leaving discards them.'
          : 'You have unsaved edits. Leaving this page will discard them.'"
      confirm-label="Discard & leave"
      cancel-label="Stay"
      variant="danger"
      @confirm="onConfirmLeave"
      @cancel="onCancelLeave"
    />
  </EditorFrame>
</template>

<style scoped>
.sub-add-row {
  display: flex;
  gap: var(--wp-space-4);
  margin-bottom: var(--wp-space-5);
}
.sub-add-row > :first-child { flex: 1; }
.sub-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-3);
}
.wp-subcat-chip-row {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
/* Pencil rename button uses the shared <Button variant="ghost" size="sm">.
 * Override sits at 0,0,1,1 to bump the at-rest opacity down so the
 * affordance reads as secondary next to the primary remove chip. */
.wp-subcat-chip-row .wp-subcat-rename-btn {
  opacity: 0.65;
}
.wp-subcat-chip-row .wp-subcat-rename-btn:hover,
.wp-subcat-chip-row .wp-subcat-rename-btn:focus-visible {
  opacity: 1;
}
.wp-options-table {
  font-size: var(--wp-text-sm);
}
.opt-col-weight { width: 90px; }
.opt-col-sub { width: 200px; }
.opt-col-check { width: 34px; text-align: center; }
.wc-opt-row--selected > td { background: color-mix(in oklab, var(--wp-accent) 8%, transparent); }
.wpc-bulk-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px 14px;
}
.wpc-ai-controls { border-bottom: 1px solid var(--wp-border); }
.wpc-bulk-note {
  margin: 0;
  font-size: 12px;
  color: var(--wp-warn);
}
.opt-col-prob { width: 130px; }
.opt-col-trash { width: 40px; }
.opt-empty {
  text-align: center;
  padding: var(--wp-space-6);
  color: var(--wp-text-dim);
}
/* Null option chip — used for the value-column placeholder on a row
 * whose option carries is_null=true. Visually distinct from the
 * RichTextInput pills used by normal option values so users see at a
 * glance that this row will resolve to nothing. */
.wc-null-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: color-mix(in srgb, var(--wp-text-muted) 12%, transparent);
  border: 1px dashed var(--wp-border);
  border-radius: 4px;
  color: var(--wp-text-muted);
  font-family: var(--wp-font-mono, monospace);
  font-size: var(--wp-text-sm);
}
.wc-null-chip .pi { font-size: 12px; }
.wc-opt-row--fallback > td { background: color-mix(in oklab, var(--wp-accent-500) 4%, transparent); }
.wc-em-dash {
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono, monospace);
  opacity: 0.55;
  padding: 0 var(--wp-space-4);
}
.wc-opt-row--null {
  background: color-mix(in srgb, var(--wp-text) 2%, transparent);
}
/* An option holding a ref that points at nothing: red rail on the leading
   cell plus a faint wash, so the row is findable in a long table. */
.wc-opt-row--broken > td {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 6%, transparent);
}
.wc-opt-row--broken > td:first-child {
  box-shadow: inset 3px 0 0 var(--wp-danger, #ef4444);
}
.wc-broken-note {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  margin-top: var(--wp-space-2);
  font-size: var(--wp-text-xs);
  color: var(--wp-danger, #ef4444);
}

/* Teleported to <body>, so coordinates are viewport-relative and no ancestor
   can clip it. z-index sits above the editor chrome but below modals. */
/* ── Reordering ─────────────────────────────────────────────────────── */
.opt-col-grip { width: 26px; }
/* The only pointer affordance the value cell's contenteditable does not
   poison. Hidden until row hover so the resting table is unchanged. */
.opt-grip {
  display: grid;
  place-items: center;
  width: 18px;
  height: 22px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim);
  font-size: 11px;
  cursor: grab;
  opacity: 0;
  transition: opacity 0.1s;
}
tr:hover .opt-grip { opacity: 0.7; }
.opt-grip:hover { opacity: 1; background: var(--wp-bg-3); }
.opt-grip:focus-visible { opacity: 1; outline: 2px solid var(--wp-accent-500); outline-offset: 1px; }
.opt-grip:disabled { cursor: not-allowed; }
tr:hover .opt-grip:disabled { opacity: 0.2; }

/* The dragged row stays put, dimmed — pulling it out of the table reflows
   every row below and the drop target moves out from under the cursor. */
.wc-opt-row--dragging > td { opacity: 0.45; background: var(--wp-bg-3); }
.wc-opt-row--dropbefore > td { box-shadow: inset 0 2px 0 var(--wp-accent-500); }

/* "Move here" armed: the selection is the cargo, so it dims; every other row
   becomes a landing point. */
.wc-opt-row--cargo > td { opacity: 0.4; }
.wc-opt-row--landing { cursor: pointer; }
.wc-opt-row--landing:hover > td {
  box-shadow: inset 0 2px 0 var(--wp-accent-500);
  background: color-mix(in oklab, var(--wp-accent-500) 8%, transparent);
}

/* Also styled inside OptionFilterBar; this copy serves the no-results row. */
.wc-optfilter__clear {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--wp-text-muted); font: 11px var(--wp-font-sans);
  text-decoration: underline;
}
.wc-optfilter__empty {
  padding: var(--wp-space-6) var(--wp-space-5);
  text-align: center; color: var(--wp-text-dim); font-size: 12px;
}
.wc-optfilter__empty b {
  display: block; color: var(--wp-text-muted); font-weight: 600;
  margin-bottom: var(--wp-space-2);
}
.wc-optfilter__empty .wc-optfilter__clear { margin-left: var(--wp-space-3); }

.opt-tags__picker {
  position: fixed;
  z-index: 3000;
  min-width: 210px;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg);
}
/* The cap and the scrolling moved OFF the menu and onto the list inside it, so
   the search box stays pinned while the tags scroll under it.
   `overscroll-behavior: contain` is the fix for the scroll escaping: without
   it, reaching either end of this list hands the remaining wheel delta to the
   page, and the whole editor lurches. */
.opt-tags__scroll {
  max-height: 240px;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
}
.opt-tags__search {
  display: flex;
  align-items: center;
  gap: var(--wp-space-2);
  padding: 3px var(--wp-space-3); /* audit-exempt: compact inline search */
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim);
}
.opt-tags__search .pi { font-size: 10px; }
.opt-tags__search input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--wp-text);
  font: 11px var(--wp-font-sans);
}
/* Flip the option tag picker above its trigger near the page bottom (#4). */
/* Flipped above the trigger. `bottom: calc(100% + 4px)` used to do this
   against the absolutely-positioned parent; with `position: fixed` that would
   resolve against the viewport and land nowhere useful. The inline `top` is
   set to the trigger's TOP edge in this case, so shifting up by the menu's own
   height puts its bottom edge exactly there — no height measurement needed. */
.opt-tags__picker--up {
  transform: translateY(-100%);
}
.opt-tags__empty {
  margin: 0;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
}
.opt-tags__section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.opt-tags__section-name {
  font-size: var(--wp-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--wp-text-dim);
  padding: 0 4px 2px;
}
.opt-tags__toggle {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: 4px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  text-align: left;
  border-radius: var(--wp-radius-sm);
}
.opt-tags__toggle:hover {
  background: var(--wp-bg-3);
}
.opt-tags__toggle-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex: none;
  border: 1.5px solid color-mix(in srgb, var(--chip-hue) 55%, var(--wp-border-strong));
  border-radius: 4px;
  color: var(--chip-hue);
}
/* Selected row: tint the whole toggle + bold it + fill the check box so
 * the "on" state reads at a glance, independent of the (possibly grey)
 * axis hue — the prior 22%-tint-on-the-box-only was near-invisible. */
.opt-tags__toggle.is-on {
  background: color-mix(in srgb, var(--chip-hue) 18%, var(--wp-bg-2));
  color: var(--wp-text);
  font-weight: 600;
}
.opt-tags__toggle.is-on .opt-tags__toggle-box {
  background: var(--chip-hue);
  border-color: var(--chip-hue);
  color: var(--wp-bg-1);
}
</style>
