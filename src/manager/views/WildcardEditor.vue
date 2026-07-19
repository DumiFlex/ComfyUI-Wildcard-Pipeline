<script setup lang="ts">
/**
 * WildcardEditor — Wave 4 port of `WildcardEditor` in `screens/editors.jsx`.
 *
 * Sections:
 *  1. Identity (name + category + description + tags + `$varBinding`)
 *  2. Sub-categories group boxes (one per `tag_groups` axis + an
 *     ungrouped box; each box owns its pills + an inline "+ tag", §4.3/H1)
 *  3. Options table (weight + value RichTextInput + a per-option grouped
 *     multi-select for `sub_categories[]`, §4.3/H2)
 *
 * Save flow appends a snapshot to `payload.history` (utils/history.ts) so
 * the EditorFrame's history button works on the next mount.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import type { SaveState, EditorFieldError } from "../components/EditorFrame.types";
import { useRouter, useRoute } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import CommunityRowActions from "../components/CommunityRowActions.vue";
import Input from "../components/ui/Input.vue";
import RichTextInput from "../components/RichTextInput.vue";
import BulkAddPanel from "../components/BulkAddPanel.vue";
import SelectionToolbar from "../components/SelectionToolbar.vue";
import Checkbox from "../components/ui/Checkbox.vue";
import type { ParsedBulkOption } from "../utils/bulkParse";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { axisHueAt, UNGROUPED_HUE } from "../../components/shared/axis-color";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import DraftBanner from "../components/DraftBanner.vue";
import { useReturnTo } from "../composables/useReturnTo";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useRecentStore } from "../stores/recentStore";
import { toIdentifier, VALID_IDENTIFIER_RE } from "../utils/slug";
import { validateSubcatName } from "@/manager/parsing/subcatFilter";
import {
  buildWildcardRefData,
  collectLibraryWildcardRefs,
} from "../utils/library-suggestions";
import { appendSnapshot, readHistory } from "../utils/history";
import { formatProbability } from "../utils/percent";
import type {
  ModuleHistoryEntry,
  WildcardOption,
  WildcardPayload,
} from "../api/types";
import { useCascadeStore } from "../cascade/cascade-store";
import { useCascadeApply } from "../cascade/useCascadeApply";
import { registerCascadeUndo } from "../cascade/undo-stack-integration";
import CascadeConfirmDialog from "../cascade/CascadeConfirmDialog.vue";
import CascadeRenameDialog from "../cascade/CascadeRenameDialog.vue";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import type { ResolveWarning } from "../utils/resolveTokens";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const route = useRoute();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
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
const options = ref<WildcardOption[]>([
  { id: `opt_${Math.random().toString(16).slice(2, 8)}`, value: "", weight: 1, sub_categories: [] },
  { id: `opt_${Math.random().toString(16).slice(2, 8)}`, value: "", weight: 1, sub_categories: [] },
]);
/** Which group box currently has its inline "+ tag" input open, plus
 *  its draft text + live validation error. `OTHER_AXIS` is the synthetic
 *  ungrouped box (tags added there go to the registry but no axis). */
const OTHER_AXIS = "__ungrouped__";
const addTagAxis = ref<string | null>(null);
const addTagDraft = ref("");
const addTagError = ref("");
/** Which pill's kebab menu is open, as `<axis>::<tag>` (axis namespaces
 *  the key so the same tag in two boxes doesn't collide). */
const openKebab = ref<string | null>(null);
/** The "Move to group…" submenu target — `<axis>::<tag>` of the pill
 *  whose move picker is expanded. */
const moveMenuFor = ref<string | null>(null);
/** Which option row's tag picker is expanded (option id), H2. */
const openOptTagPicker = ref<string | null>(null);
/** When a menu opens too close to the viewport bottom we flip it to open
 *  upward so it isn't clipped off the end of the page (bugs #1/#4). */
const kebabDropUp = ref(false);
const pickerDropUp = ref(false);
/** Drag-and-drop state: which pill tag is being dragged + which group box
 *  it's currently hovering, for the drop highlight (bug #2). */
const draggedTag = ref<string | null>(null);
const dragOverAxis = ref<string | null>(null);
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
    options: options.value,
  });
}

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => snapshot() !== baseline.value,
);

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
      options: typeof options.value;
    };
    name.value = parsed.name;
    description.value = parsed.description;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    varBinding.value = parsed.varBinding;
    subCategories.value = parsed.subCategories;
    tagGroups.value = parsed.tagGroups ?? {};
    options.value = parsed.options;
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

interface SubcatGroup {
  /** Axis name, or the OTHER_AXIS sentinel for the ungrouped box. */
  axis: string;
  /** Registry tags in this box (group members ∩ registry, in registry order). */
  tags: string[];
  /** True for the synthetic ungrouped box (no rename/move-target). */
  isOther: boolean;
}

const subcatGroups = computed<SubcatGroup[]>(() => {
  const groups: SubcatGroup[] = [];
  const claimed = new Set<string>();
  for (const [axis, members] of Object.entries(tagGroups.value)) {
    // Keep registry order so a tag's position is stable across boxes.
    const tags = subCategories.value.filter(
      (t) => Array.isArray(members) && members.includes(t),
    );
    tags.forEach((t) => claimed.add(t));
    // Named axes always render (even when empty) so a freshly-created
    // "+ Group" box is visible and can receive its first tag.
    groups.push({ axis, tags, isOther: false });
  }
  const ungrouped = subCategories.value.filter((t) => !claimed.has(t));
  // The ungrouped box only appears when it has tags OR there are no named
  // axes at all (so a brand-new wildcard still shows one box to add into).
  if (ungrouped.length > 0 || groups.length === 0) {
    groups.push({ axis: OTHER_AXIS, tags: ungrouped, isOther: true });
  }
  return groups;
});

/** Index of the axis a tag belongs to (-1 when ungrouped) — drives the
 *  per-axis chip hue via the shared `axisHueAt` palette so a tag reads
 *  with the same colour across every surface. */
function axisIndexOf(tag: string): number {
  const axes = Object.keys(tagGroups.value);
  for (let i = 0; i < axes.length; i++) {
    if (tagGroups.value[axes[i]]?.includes(tag)) return i;
  }
  return -1;
}

function tagHue(tag: string): string {
  return axisHueAt(axisIndexOf(tag));
}

function chipStyle(tag: string): Record<string, string> {
  return { "--chip-hue": tagHue(tag) };
}

/** Hue for a whole group box, keyed by axis NAME (vs `tagHue`, keyed by a
 *  member tag). Drives the coloured group header + left accent so each axis
 *  reads as a distinct colour cluster (#8). OTHER_AXIS stays neutral. */
function axisHue(axis: string): string {
  if (axis === OTHER_AXIS) return UNGROUPED_HUE;
  return axisHueAt(Object.keys(tagGroups.value).indexOf(axis));
}

/** How many options carry this tag — the pill's `(count)` badge. */
function tagUsageCount(tag: string): number {
  return options.value.filter((o) => (o.sub_categories ?? []).includes(tag)).length;
}

function kebabKey(axis: string, tag: string): string {
  return `${axis}::${tag}`;
}

/** True when the trigger that fired `ev` sits within `menuPx` of the
 *  viewport bottom — i.e. a downward menu would be clipped, so flip up. */
function shouldDropUp(ev: MouseEvent | undefined, menuPx: number): boolean {
  const el = ev?.currentTarget as HTMLElement | null;
  const r = el?.getBoundingClientRect();
  return !!r && window.innerHeight - r.bottom < menuPx;
}

function toggleKebab(axis: string, tag: string, ev?: MouseEvent): void {
  const key = kebabKey(axis, tag);
  const opening = openKebab.value !== key;
  openKebab.value = opening ? key : null;
  moveMenuFor.value = null;
  if (opening) kebabDropUp.value = shouldDropUp(ev, 200);
}

function closeMenus(): void {
  openKebab.value = null;
  moveMenuFor.value = null;
}

/** Close every transient overlay: kebab + its submenu, the inline add-tag
 *  input, and the per-option tag picker. Used by the document-level
 *  outside-click + Escape handlers (bug #3). */
function closeAllMenus(): void {
  closeMenus();
  cancelAddTag();
  openOptTagPicker.value = null;
}

/** Outside-click: any pointer landing outside an open menu / its trigger
 *  dismisses everything. Clicks inside these regions are handled by their
 *  own (`@click.stop`) handlers, so we bail when the target is within one. */
function onDocPointerDown(e: MouseEvent): void {
  const t = e.target as HTMLElement | null;
  if (
    t?.closest(
      ".subcat-pill, .subcat-menu, .subcat-addtag, .subcat-addtag__open, .opt-tags",
    )
  ) {
    return;
  }
  closeAllMenus();
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeAllMenus();
}

/* ── Inline "+ tag" per group ──────────────────────────────────────── */

function openAddTag(axis: string): void {
  addTagAxis.value = axis;
  addTagDraft.value = "";
  addTagError.value = "";
}

function cancelAddTag(): void {
  addTagAxis.value = null;
  addTagDraft.value = "";
  addTagError.value = "";
}

/** Validate + commit a new tag into the registry and (when not the
 *  ungrouped box) the target axis. Validation mirrors the shared parser's
 *  `validateSubcatName` (whitespace / reserved / disallowed-char rules)
 *  so the SPA rejects exactly what the engine + TS validator reject. */
function commitAddTag(axis: string): void {
  const raw = addTagDraft.value.trim();
  if (!raw) { cancelAddTag(); return; }
  const err = validateSubcatName(raw);
  if (err) { addTagError.value = err; return; }
  if (subCategories.value.includes(raw)) {
    addTagError.value = `"${raw}" already exists`;
    return;
  }
  subCategories.value = [...subCategories.value, raw];
  if (axis !== OTHER_AXIS) {
    const members = tagGroups.value[axis] ?? [];
    tagGroups.value = { ...tagGroups.value, [axis]: [...members, raw] };
  }
  // Keep the input open + cleared so several tags can be added in a row.
  addTagDraft.value = "";
  addTagError.value = "";
}

/* ── "+ Group" + group rename / ungroup ─────────────────────────────── */

/** Create a new empty axis with an auto-incrementing default name. */
function addGroup(): void {
  let n = Object.keys(tagGroups.value).length + 1;
  let candidate = `group ${n}`;
  while (tagGroups.value[candidate] !== undefined) {
    n += 1;
    candidate = `group ${n}`;
  }
  tagGroups.value = { ...tagGroups.value, [candidate]: [] };
  // Open its add-tag input straight away so the new box is usable.
  openAddTag(candidate);
}

/** Rename an axis in place (UI-only — axis names are not part of the ref
 *  grammar, so no cascade needed). Preserves insertion order + members. */
function renameGroup(oldAxis: string, nextAxis: string): void {
  const trimmed = nextAxis.trim();
  if (!trimmed || trimmed === oldAxis) return;
  if (tagGroups.value[trimmed] !== undefined) return; // name collision — ignore
  const next: Record<string, string[]> = {};
  for (const [axis, members] of Object.entries(tagGroups.value)) {
    next[axis === oldAxis ? trimmed : axis] = members;
  }
  tagGroups.value = next;
}

/** Disband an axis — its tags fall back into the ungrouped box (they
 *  stay in the registry, just lose their grouping). */
function ungroupAxis(axis: string): void {
  if (tagGroups.value[axis] === undefined) return;
  const next = { ...tagGroups.value };
  delete next[axis];
  tagGroups.value = next;
}

/** Destinations the "Move to group…" submenu offers for a pill in
 *  `fromAxis`: every other named axis + an "ungrouped" entry, minus the
 *  axis the pill already lives in. */
function moveTargets(fromAxis: string): Array<{ axis: string; label: string }> {
  const out: Array<{ axis: string; label: string }> = [];
  for (const axis of Object.keys(tagGroups.value)) {
    if (axis === fromAxis) continue;
    out.push({ axis, label: axis });
  }
  if (fromAxis !== OTHER_AXIS) {
    out.push({ axis: OTHER_AXIS, label: "ungrouped" });
  }
  return out;
}

/** Move a tag from its current axis into `targetAxis` (OTHER_AXIS =
 *  ungroup it). A tag lives in at most one axis (§2.2). */
function moveTagToGroup(tag: string, targetAxis: string): void {
  const next: Record<string, string[]> = {};
  for (const [axis, members] of Object.entries(tagGroups.value)) {
    next[axis] = members.filter((m) => m !== tag);
  }
  if (targetAxis !== OTHER_AXIS) {
    next[targetAxis] = [...(next[targetAxis] ?? []), tag];
  }
  tagGroups.value = next;
  closeMenus();
}

/* ── Drag-and-drop pills between group boxes (bug #2) ───────────────── */

function onPillDragStart(tag: string, e: DragEvent): void {
  draggedTag.value = tag;
  closeMenus();
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tag);
  }
}

function onPillDragEnd(): void {
  draggedTag.value = null;
  dragOverAxis.value = null;
}

function onGroupDragOver(axis: string): void {
  if (draggedTag.value !== null) dragOverAxis.value = axis;
}

function onGroupDragLeave(axis: string): void {
  if (dragOverAxis.value === axis) dragOverAxis.value = null;
}

/** Drop a dragged pill into `axis` (OTHER_AXIS box = ungroup). Reuses the
 *  same move routine the kebab "Move to group…" submenu calls. */
function onGroupDrop(axis: string): void {
  const tag = draggedTag.value;
  draggedTag.value = null;
  dragOverAxis.value = null;
  if (tag !== null) moveTagToGroup(tag, axis);
}

/* ── Per-option grouped multi-select (§4.3, H2) ─────────────────────── */

/** Box model for the option tag picker — same axis grouping as the
 *  registry boxes but used to render the grouped checkbox sections. */
const optionTagGroups = computed<SubcatGroup[]>(() => subcatGroups.value);

function toggleOptTagPicker(optionId: string, ev?: MouseEvent): void {
  const opening = openOptTagPicker.value !== optionId;
  openOptTagPicker.value = opening ? optionId : null;
  if (opening) pickerDropUp.value = shouldDropUp(ev, 280);
}

function optionHasTag(o: WildcardOption, tag: string): boolean {
  return (o.sub_categories ?? []).includes(tag);
}

/** Toggle a tag's membership on an option. Preserves registry order so
 *  the chips render in a stable sequence regardless of click order. */
function toggleOptionTag(o: WildcardOption, tag: string): void {
  const current = new Set(o.sub_categories ?? []);
  if (current.has(tag)) current.delete(tag);
  else current.add(tag);
  o.sub_categories = subCategories.value.filter((t) => current.has(t));
}

const totalWeight = computed(() => {
  const sum = options.value.reduce((acc, o) => acc + (Number(o.weight) || 0), 0);
  return sum > 0 ? sum : 1;
});

function probabilityFor(o: WildcardOption): number {
  return ((Number(o.weight) || 0) / totalWeight.value) * 100;
}

/** Coerce a raw `payload.tag_groups` into the editor's reactive shape:
 *  drop non-array members, keep only tags that are in the registry, and
 *  preserve insertion order. A tag claimed by two axes (shouldn't happen
 *  per §2.2) is kept only in the first that lists it. */
function normalizeTagGroups(
  raw: unknown,
  registry: string[],
): Record<string, string[]> {
  if (typeof raw !== "object" || raw === null) return {};
  const reg = new Set(registry);
  const seen = new Set<string>();
  const out: Record<string, string[]> = {};
  for (const [axis, members] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(members)) { out[axis] = []; continue; }
    const kept: string[] = [];
    for (const m of members) {
      if (typeof m === "string" && reg.has(m) && !seen.has(m)) {
        kept.push(m);
        seen.add(m);
      }
    }
    out[axis] = kept;
  }
  return out;
}

/** Build the `payload.tag_groups` to persist: keep only members still in
 *  the registry, drop axes that end up empty, and return `null` when
 *  nothing is grouped so the payload omits the key entirely. */
function serializeTagGroups(): Record<string, string[]> | null {
  const reg = new Set(subCategories.value);
  const out: Record<string, string[]> = {};
  for (const [axis, members] of Object.entries(tagGroups.value)) {
    const kept = members.filter((m) => reg.has(m));
    if (kept.length > 0) out[axis] = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}

onUnmounted(() => {
  document.removeEventListener("click", onDocPointerDown);
  document.removeEventListener("keydown", onDocKeydown);
});

onMounted(async () => {
  // Outside-click + Escape dismissal for all transient menus (bug #3).
  document.addEventListener("click", onDocPointerDown);
  document.addEventListener("keydown", onDocKeydown);
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
  baseline.value = snapshot();
});

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

/* ── Pill kebab actions (Rename / Move / Delete) ────────────────────── */

/** Kebab → Rename… — closes the menu and opens the existing cascade
 *  rename dialog (expression-aware via Chunk E). */
function onKebabRename(subcat: string): void {
  closeMenus();
  onSubcatRenameClick(subcat);
}

/** Kebab → Delete… — closes the menu and runs the existing cascade
 *  delete path (silent when no refs, confirm dialog when refs > 0). */
function onKebabDelete(subcat: string): void {
  closeMenus();
  void onSubcatDeleteClick(subcat);
}

/** Kebab → Move to group… — open the inline move submenu for this pill. */
function onKebabMove(axis: string, tag: string): void {
  moveMenuFor.value = kebabKey(axis, tag);
}

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
const bulkAddOpen = ref(false);
const selectedIds = ref<Set<string>>(new Set());
const bulkNote = ref("");

/** Options eligible for bulk selection — the null option is excluded since
 *  its weight + sub-categories are meaningless. */
const selectableOptions = computed(() => options.value.filter((o) => !o.is_null));
const selectedCount = computed(() => selectedIds.value.size);
const allSelected = computed(
  () =>
    selectableOptions.value.length > 0 &&
    selectableOptions.value.every((o) => selectedIds.value.has(o.id as string)),
);
/** ≥1 (but not necessarily all) selectable rows checked — drives the
 *  select-all checkbox's indeterminate dash. */
const someSelected = computed(() =>
  selectableOptions.value.some((o) => selectedIds.value.has(o.id as string)),
);

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
function toggleSelectAll(): void {
  if (allSelected.value) selectedIds.value = new Set();
  else selectedIds.value = new Set(selectableOptions.value.map((o) => o.id as string));
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

function applyTagToSelected(tag: string): void {
  bulkNote.value = "";
  if (!ensureSubcat(tag)) {
    bulkNote.value = `"${tag.trim()}" is not a valid sub-category name.`;
    return;
  }
  const t = tag.trim();
  for (const o of selectedOptionList()) {
    const current = new Set(o.sub_categories ?? []);
    current.add(t);
    // Re-derive in registry order so chips stay stably sorted (mirrors toggleOptionTag).
    o.sub_categories = subCategories.value.filter((s) => current.has(s));
  }
}
function removeTagFromSelected(tag: string): void {
  bulkNote.value = "";
  for (const o of selectedOptionList()) {
    o.sub_categories = (o.sub_categories ?? []).filter((s) => s !== tag);
  }
}
function setWeightSelected(weight: number): void {
  bulkNote.value = "";
  // Floor at 0.01 like the per-row weight input — weight 0 never picks.
  const w = Number.isFinite(weight) && weight > 0 ? weight : 0.01;
  for (const o of selectedOptionList()) o.weight = w;
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
function commitBulkAddOptions(parsed: ParsedBulkOption[]): void {
  bulkNote.value = "";
  let skippedTags = 0;
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
function hoistNullFirst<T extends { is_null?: boolean }>(list: T[]): T[] {
  const idx = list.findIndex((o) => o.is_null === true);
  if (idx <= 0) return list;
  const out = [...list];
  const [n] = out.splice(idx, 1);
  out.unshift(n);
  return out;
}

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
  varBinding.value = (p.var_binding && p.var_binding.trim()) || toIdentifier(entry.name);
  toast.push({
    severity: "info",
    summary: "Version restored",
    detail: `Restored from ${new Date(entry.saved_at).toLocaleString()}; click Save to commit.`,
    life: 4000,
  });
}

async function save() {
  // Update varBindingError synchronously so the rollup picks it up
  // in the same tick. The validation computed reads this ref.
  const finalBinding = varBinding.value.trim() || toIdentifier(name.value);
  if (varBinding.value.trim() && !VALID_IDENTIFIER_RE.test(finalBinding)) {
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
    // Re-hoist any null option to index 0 before persisting. Drag-sort
    // is allowed to land it anywhere during editing; the serialised
    // payload always pins the null option first.
    const sortedOptions = hoistNullFirst(options.value);
    if (sortedOptions !== options.value) options.value = sortedOptions;
    // Serialise tag_groups, dropping empty axes (a "+ Group" box the user
    // created but never filled) + members no longer in the registry. Omit
    // the key entirely when nothing is grouped, keeping legacy payloads
    // byte-identical when grouping is unused.
    const serializedGroups = serializeTagGroups();
    const payload: WildcardPayload = {
      options: sortedOptions,
      sub_categories: subCategories.value,
      var_binding: finalBinding,
      ...(serializedGroups ? { tag_groups: serializedGroups } : {}),
    };
    const newPayload = payload as unknown as Record<string, unknown>;
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
      // New mode: moduleStore.create() does not expose the new id on the
      // returned row in a way that's stable across mock/real backends.
      // The next time the user opens this item the mount-time push fires.
      await moduleStore.create({
        type: "wildcard",
        name: name.value, description: description.value,
        category_id: categoryId.value, tags: tags.value,
        payload: newPayload,
        content_rating: contentRating.value,
      });
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
    // Wildcard names become the `#name` segment of nested refs.
    // Forbidding the grammar-reserved chars here mirrors
    // `wp_api/_validators.py:REF_GRAMMAR_FORBIDDEN_CHARS` so the
    // server never has to reject a save the editor already accepted.
    const REF_FORBIDDEN = /[{}:#@,]/;
    const bad = name.value.match(REF_FORBIDDEN);
    if (bad) {
      out.push({
        field: "editor-section-identity",
        label: "Name",
        message: `Cannot contain "${bad[0]}" (reserved by the @{uuid#name:subcat} ref grammar)`,
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

defineExpose({ historyEntries, applyRestore, options, subCategories, tagGroups });
</script>

<template>
  <EditorFrame
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
      <Card title="Sub-Categories">
        <template #actions>
          <span class="wp-card__hint">Group tags into axes — used to filter the pool</span>
        </template>
        <!-- Group boxes: one per tag_groups axis + a trailing ungrouped
             box. Each box owns its pills (⠿ name (count) ⋯) + an inline
             "+ tag". Adding is contextual per group — no global add bar. -->
        <div class="subcat-groups" @click="closeMenus">
          <section
            v-for="group in subcatGroups"
            :key="group.axis"
            class="subcat-group"
            :class="{ 'subcat-group--drop': dragOverAxis === group.axis && draggedTag !== null }"
            :style="{ '--group-hue': axisHue(group.axis) }"
            data-test="subcat-group"
            @dragover.prevent="onGroupDragOver(group.axis)"
            @dragleave="onGroupDragLeave(group.axis)"
            @drop.prevent="onGroupDrop(group.axis)"
          >
            <header class="subcat-group__head">
              <input
                v-if="!group.isOther"
                class="subcat-group__name"
                :value="group.axis"
                :aria-label="`Rename group ${group.axis}`"
                :data-test="`subcat-group-name-${group.axis}`"
                @change="(e) => renameGroup(group.axis, (e.target as HTMLInputElement).value)"
                @keydown.enter.prevent="(e) => (e.target as HTMLInputElement).blur()"
              />
              <span v-else class="subcat-group__name subcat-group__name--other">ungrouped</span>
              <button
                v-if="!group.isOther"
                type="button"
                class="subcat-group__ungroup"
                :aria-label="`Disband group ${group.axis}`"
                :data-test="`subcat-ungroup-${group.axis}`"
                title="Disband group (tags stay, lose their axis)"
                @click.stop="ungroupAxis(group.axis)"
              ><i class="pi pi-link" aria-hidden="true" /></button>
            </header>

            <div class="subcat-group__pills">
              <span
                v-for="tag in group.tags"
                :key="tag"
                class="subcat-pill"
                :class="{ 'subcat-pill--dragging': draggedTag === tag }"
                :style="chipStyle(tag)"
                draggable="true"
                @dragstart="onPillDragStart(tag, $event)"
                @dragend="onPillDragEnd"
              >
                <span class="subcat-pill__grip" aria-hidden="true">⠿</span>
                <span class="subcat-pill__name">{{ tag }}</span>
                <span class="subcat-pill__count" :title="`${tagUsageCount(tag)} option(s) use this tag`">{{ tagUsageCount(tag) }}</span>
                <button
                  type="button"
                  class="subcat-pill__kebab"
                  :aria-label="`Actions for ${tag}`"
                  :aria-expanded="openKebab === kebabKey(group.axis, tag)"
                  :data-test="`subcat-kebab-${tag}`"
                  @click.stop="toggleKebab(group.axis, tag, $event)"
                >⋯</button>

                <!-- Kebab menu: Rename / Move to group… / Delete. Rename
                     + Delete route through the existing cascade dialogs. -->
                <div
                  v-if="openKebab === kebabKey(group.axis, tag)"
                  class="subcat-menu"
                  :class="{ 'subcat-menu--up': kebabDropUp }"
                  role="menu"
                  @click.stop
                >
                  <button
                    type="button"
                    class="subcat-menu__item"
                    role="menuitem"
                    data-test="subcat-rename"
                    @click="onKebabRename(tag)"
                  ><i class="pi pi-pencil" aria-hidden="true" /> Rename…</button>
                  <button
                    type="button"
                    class="subcat-menu__item"
                    role="menuitem"
                    data-test="subcat-move"
                    :aria-expanded="moveMenuFor === kebabKey(group.axis, tag)"
                    @click="onKebabMove(group.axis, tag)"
                  ><i class="pi pi-arrow-right-arrow-left" aria-hidden="true" /> Move to group…</button>
                  <div
                    v-if="moveMenuFor === kebabKey(group.axis, tag)"
                    class="subcat-menu__sub"
                    role="menu"
                  >
                    <button
                      v-for="dest in moveTargets(group.axis)"
                      :key="dest.axis"
                      type="button"
                      class="subcat-menu__item subcat-menu__item--sub"
                      role="menuitem"
                      :data-test="`subcat-move-to-${dest.axis}`"
                      @click="moveTagToGroup(tag, dest.axis)"
                    >{{ dest.label }}</button>
                  </div>
                  <button
                    type="button"
                    class="subcat-menu__item subcat-menu__item--danger"
                    role="menuitem"
                    data-test="subcat-delete"
                    @click="onKebabDelete(tag)"
                  ><i class="pi pi-trash" aria-hidden="true" /> Delete…</button>
                </div>
              </span>

              <!-- Inline "+ tag" for this group. Collapsed to a button;
                   expands to a validated input. -->
              <span v-if="addTagAxis === group.axis" class="subcat-addtag">
                <input
                  v-model="addTagDraft"
                  class="subcat-addtag__input"
                  :class="{ 'subcat-addtag__input--invalid': addTagError }"
                  :data-test="`group-addtag-input-${group.axis}`"
                  placeholder="new tag"
                  spellcheck="false"
                  autocapitalize="off"
                  autocomplete="off"
                  @keydown.enter.prevent="commitAddTag(group.axis)"
                  @keydown.esc.prevent="cancelAddTag"
                  @blur="cancelAddTag"
                />
              </span>
              <button
                v-else
                type="button"
                class="subcat-addtag__open"
                :data-test="`group-addtag-${group.axis}`"
                @click.stop="openAddTag(group.axis)"
              ><i class="pi pi-plus" aria-hidden="true" /> tag</button>
            </div>

            <p
              v-if="addTagAxis === group.axis && addTagError"
              class="subcat-addtag__error"
              :data-test="`group-addtag-error-${group.axis}`"
            >{{ addTagError }}</p>
          </section>

          <button
            type="button"
            class="subcat-add-group"
            data-test="subcat-add-group"
            @click.stop="addGroup"
          ><i class="pi pi-plus" aria-hidden="true" /> Group</button>
        </div>
      </Card>
    </div>

    <div id="editor-section-options">
    <Card :title="`Options (${options.length})`" :padding="false" sticky-header>
      <template #actions>
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
          data-test="wc-bulk-add"
          @click="bulkAddOpen = !bulkAddOpen"
        >Bulk add</Button>
        <Button
          size="sm"
          variant="ghost"
          icon="pi-ban"
          :disabled="hasNullOption"
          data-test="wc-add-null"
          @click="addNullOption"
        >Add null</Button>
        <Button size="sm" variant="primary" icon="pi-plus" data-test="wc-add-opt" @click="addOption">
          Add option
        </Button>
      </template>
      <div v-if="bulkMode && (bulkAddOpen || selectedCount > 0 || bulkNote)" class="wpc-bulk-controls">
        <BulkAddPanel
          v-if="bulkAddOpen"
          mode="options"
          :existing-values="existingOptionValues"
          :existing-tags="subCategories"
          @commit-options="commitBulkAddOptions"
          @cancel="bulkAddOpen = false"
        />
        <SelectionToolbar
          v-if="selectedCount > 0"
          :count="selectedCount"
          :tags="subCategories"
          @apply-tag="applyTagToSelected"
          @remove-tag="removeTagFromSelected"
          @set-weight="setWeightSelected"
          @delete-selected="deleteSelected"
          @clear="clearSelection"
        />
        <p v-if="bulkNote" class="wpc-bulk-note" role="status">{{ bulkNote }}</p>
      </div>
      <table class="wp-table wp-options-table">
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
            <th scope="col" class="opt-col-weight">Weight</th>
            <th scope="col">Value</th>
            <th scope="col" class="opt-col-sub">Sub-category</th>
            <th scope="col" class="opt-col-prob">Probability</th>
            <th scope="col" class="opt-col-trash"><span class="wp-sr-only">Remove option</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(o, i) in options"
            :key="o.id"
            :data-test="o.is_null ? 'wc-opt-row-null' : `wc-opt-row-${i}`"
            :class="{ 'wc-opt-row--null': o.is_null, 'wc-opt-row--selected': bulkMode && isSelected(o.id) }"
          >
            <td v-if="bulkMode" class="opt-col-check">
              <button
                v-if="!o.is_null"
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
              <RichTextInput
                v-else
                v-model="o.value"
                surface="wildcard"
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
            </td>
            <td>
              <span v-if="o.is_null" class="wc-em-dash" aria-hidden="true">—</span>
              <!-- Per-option grouped multi-select (§4.3, H2): assigned
                   tags render as removable chips (coloured by axis) and a
                   chevron opens a grouped checkbox picker. Membership only
                   — no boolean expression here. -->
              <div v-else class="opt-tags" @click.stop>
                <div class="opt-tags__control">
                  <span
                    v-for="tag in (o.sub_categories ?? [])"
                    :key="tag"
                    class="opt-tags__chip"
                    :style="chipStyle(tag)"
                  >
                    {{ tag }}
                    <button
                      type="button"
                      class="opt-tags__chip-x"
                      :aria-label="`Remove ${tag} from option`"
                      @click.stop="toggleOptionTag(o, tag)"
                    >×</button>
                  </span>
                  <span v-if="!(o.sub_categories ?? []).length" class="opt-tags__placeholder">(none)</span>
                  <button
                    type="button"
                    class="opt-tags__chevron"
                    :class="{ 'opt-tags__chevron--open': openOptTagPicker === o.id }"
                    :aria-label="`Edit sub-categories for option`"
                    :aria-expanded="openOptTagPicker === o.id"
                    :data-test="`opt-tags-${o.id}`"
                    @click.stop="toggleOptTagPicker(o.id, $event)"
                  ><i class="pi pi-chevron-down" aria-hidden="true" /></button>
                </div>

                <!-- Grouped checkbox picker: one section per axis +
                     ungrouped. Each toggle gets is-on when selected. -->
                <div
                  v-if="openOptTagPicker === o.id"
                  class="opt-tags__picker"
                  :class="{ 'opt-tags__picker--up': pickerDropUp }"
                  role="menu"
                  @click.stop
                >
                  <p v-if="!subCategories.length" class="opt-tags__empty">
                    No sub-categories yet — add some above.
                  </p>
                  <div
                    v-for="grp in optionTagGroups"
                    :key="grp.axis"
                    class="opt-tags__section"
                  >
                    <span class="opt-tags__section-name">{{ grp.isOther ? "ungrouped" : grp.axis }}</span>
                    <button
                      v-for="tag in grp.tags"
                      :key="tag"
                      type="button"
                      class="opt-tags__toggle"
                      :class="{ 'is-on': optionHasTag(o, tag) }"
                      :style="chipStyle(tag)"
                      role="menuitemcheckbox"
                      :aria-checked="optionHasTag(o, tag)"
                      :data-test="`opt-tag-toggle-${o.id}-${tag}`"
                      @click.stop="toggleOptionTag(o, tag)"
                    >
                      <span class="opt-tags__toggle-box" aria-hidden="true">
                        <svg v-if="optionHasTag(o, tag)" width="8" height="8" viewBox="0 0 12 12">
                          <path d="M2.5 6.5 L5 9 L9.5 3.5" fill="none" stroke="currentColor"
                                stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                      </span>
                      {{ tag }}
                    </button>
                  </div>
                </div>
              </div>
            </td>
            <td>
              <div class="opt-prob">
                <div class="opt-prob__bar">
                  <div class="opt-prob__fill" :style="{ width: probabilityFor(o) + '%' }" />
                </div>
                <span class="opt-prob__value wp-mono">{{ formatProbability(probabilityFor(o)) }}</span>
              </div>
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
      title="Discard unsaved changes?"
      body="You have unsaved edits. Leaving this page will discard them."
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
.opt-prob {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
}
.opt-prob__bar {
  flex: 1;
  height: 6px;
  background: var(--wp-bg-3);
  border-radius: 999px;
  overflow: hidden;
}
.opt-prob__fill {
  height: 100%;
  background: var(--wp-accent-gradient);
}
.opt-prob__value {
  width: 32px;
  text-align: right;
  font-size: var(--wp-text-xs);
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
.wc-em-dash {
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono, monospace);
  opacity: 0.55;
  padding: 0 var(--wp-space-4);
}
.wc-opt-row--null {
  background: color-mix(in srgb, var(--wp-text) 2%, transparent);
}

/* ── Sub-category group boxes (H1) ───────────────────────────────── */
.subcat-groups {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
}
.subcat-group {
  border: 1px solid var(--wp-border);
  /* Coloured left accent keyed to the axis hue so each group reads as a
   * distinct cluster at a glance (#8). Ungrouped (--group-hue = text-dim)
   * stays neutral. */
  border-left: 3px solid color-mix(in srgb, var(--group-hue, var(--wp-border)) 60%, var(--wp-border));
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
  padding: var(--wp-space-4);
  transition: border-color 0.12s, background 0.12s;
}
/* Highlight a group box while a dragged pill hovers over it (bug #2). */
.subcat-group--drop {
  border-color: var(--wp-accent-500);
  background: color-mix(in srgb, var(--wp-accent-500) 8%, var(--wp-bg-2));
}
.subcat-group__head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  margin-bottom: var(--wp-space-3);
}
.subcat-group__name {
  font-size: var(--wp-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--group-hue, var(--wp-text-dim)) 80%, var(--wp-text));
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--wp-radius-sm);
  padding: 3px 6px;
  min-width: 0;
  max-width: 220px;
}
.subcat-group__name:hover,
.subcat-group__name:focus-visible {
  border-color: var(--wp-border);
  background: var(--wp-bg-1);
  color: var(--wp-text);
  outline: none;
}
.subcat-group__name--other {
  font-style: italic;
  padding-left: 0;
  cursor: default;
}
.subcat-group__ungroup {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text-dim);
  border-radius: var(--wp-radius-sm);
}
.subcat-group__ungroup:hover {
  color: var(--wp-text);
  background: var(--wp-bg-3);
}
.subcat-group__pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wp-space-3);
}

/* Pill: ⠿ name (count) ⋯ — tinted by its axis hue (--chip-hue). */
.subcat-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  border: 1px solid color-mix(in srgb, var(--chip-hue) 55%, var(--wp-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-hue) 17%, var(--wp-bg-1));
  font-size: var(--wp-text-sm);
  line-height: 1;
}
.subcat-pill[draggable="true"] {
  cursor: grab;
}
.subcat-pill--dragging {
  opacity: 0.45;
}
.subcat-pill__grip {
  color: var(--wp-text-dim);
  cursor: grab;
  font-size: 11px;
}
.subcat-pill__name {
  color: var(--wp-text);
  font-weight: 500;
}
.subcat-pill__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-hue) 22%, var(--wp-bg-3));
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
  font-variant-numeric: tabular-nums;
}
.subcat-pill__kebab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text-dim);
  border-radius: 999px;
  font-size: 14px;
  line-height: 1;
}
.subcat-pill__kebab:hover {
  color: var(--wp-text);
  background: var(--wp-bg-3);
}

/* Kebab dropdown menu. */
.subcat-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  padding: var(--wp-space-2);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg);
}
/* Flip the kebab menu above its trigger near the page bottom (bug #1). */
.subcat-menu--up {
  top: auto;
  bottom: calc(100% + 4px);
}
.subcat-menu__item {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  padding: 6px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  text-align: left;
  border-radius: var(--wp-radius-sm);
}
.subcat-menu__item:hover {
  background: var(--wp-bg-3);
}
.subcat-menu__item .pi {
  font-size: 12px;
  color: var(--wp-text-dim);
}
.subcat-menu__item--sub {
  padding-left: var(--wp-space-5);
}
.subcat-menu__item--danger {
  color: var(--wp-danger-text, var(--wp-danger));
}
.subcat-menu__item--danger .pi {
  color: inherit;
}
.subcat-menu__sub {
  display: flex;
  flex-direction: column;
  margin: 2px 0 2px var(--wp-space-3);
  padding-left: var(--wp-space-2);
  border-left: 1px solid var(--wp-border);
}

/* Inline "+ tag" (per group) + "+ Group". */
.subcat-addtag__open,
.subcat-add-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px dashed var(--wp-border-strong);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-sm);
}
.subcat-addtag__open:hover,
.subcat-add-group:hover {
  color: var(--wp-text);
  border-color: var(--wp-accent-500);
}
.subcat-add-group {
  margin-top: var(--wp-space-3);
  align-self: flex-start;
}
.subcat-addtag__input {
  padding: 3px 10px;
  width: 130px;
  border: 1px solid var(--wp-accent-500);
  border-radius: 999px;
  background: var(--wp-bg-1);
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  outline: none;
}
.subcat-addtag__input--invalid {
  border-color: var(--wp-danger);
}
.subcat-addtag__error {
  margin: var(--wp-space-2) 0 0;
  color: var(--wp-danger-text, var(--wp-danger));
  font-size: var(--wp-text-xs);
}

/* ── Per-option grouped multi-select (H2) ────────────────────────── */
.opt-tags {
  position: relative;
}
.opt-tags__control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.opt-tags__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 8px;
  border: 1px solid color-mix(in srgb, var(--chip-hue) 45%, var(--wp-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--chip-hue) 12%, var(--wp-bg-1));
  color: var(--wp-text);
  font-size: var(--wp-text-xs);
  line-height: 1.4;
}
.opt-tags__chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--wp-text-dim);
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
}
.opt-tags__chip-x:hover {
  color: var(--wp-text);
  background: var(--wp-bg-3);
}
.opt-tags__placeholder {
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
  font-style: italic;
}
.opt-tags__chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-1);
  cursor: pointer;
  color: var(--wp-text-dim);
  font-size: 11px;
}
.opt-tags__chevron:hover {
  color: var(--wp-text);
  border-color: var(--wp-border-strong);
}
.opt-tags__chevron--open {
  color: var(--wp-accent-text);
  border-color: var(--wp-accent-500);
}

.opt-tags__picker {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  min-width: 210px;
  max-height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
  padding: var(--wp-space-3);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg);
}
/* Flip the option tag picker above its trigger near the page bottom (#4). */
.opt-tags__picker--up {
  top: auto;
  bottom: calc(100% + 4px);
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
