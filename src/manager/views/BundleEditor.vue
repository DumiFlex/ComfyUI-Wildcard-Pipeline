<script lang="ts">
/**
 * Pure helpers for BundleEditor, exported from a plain (non-setup)
 * `<script>` block so they're unit-testable without mounting the view.
 */
import type { ExtractedModule } from "../../components/context/bundles/extract-to-library";
import { walkRemap } from "../../components/context/bundles/uuid-remap";
import { MAX_KNOWN_SCHEMA_VERSION, type RawPayload } from "../import-export/migrations";

/** Engine `type` (singular) → install-envelope bucket (plural). The five
 *  module subtypes share one server table but live in distinct envelope
 *  arrays; `fixed_values` is identical in both spaces. */
const TYPE_TO_BUCKET: Record<string, keyof RawPayload> = {
  wildcard: "wildcards",
  fixed_values: "fixed_values",
  combine: "combines",
  derivation: "derivations",
  constraint: "constraints",
};

/**
 * Group extracted leaf modules into the install envelope `installEnvelope`
 * accepts (top-level `schema_version` + plural per-type arrays). Each module
 * is emitted as an engine-row entity (`{ id, type, name, payload, ...}`),
 * carrying `description`/`tags` only when present so we don't write empty
 * keys the engine importer would otherwise have to ignore.
 *
 * Stamped with `MAX_KNOWN_SCHEMA_VERSION` — these rows came straight out of
 * a live library bundle (already current shape), so they need no migration;
 * stamping CURRENT (the chain head, which lags) would make `parsePayload`
 * try to forward-migrate shapes that are already at head.
 */
export function buildExtractEnvelope(modules: ExtractedModule[]): RawPayload {
  const envelope: RawPayload = {
    schema_version: MAX_KNOWN_SCHEMA_VERSION,
    bundles: [],
    wildcards: [],
    fixed_values: [],
    combines: [],
    derivations: [],
    constraints: [],
    categories: [],
    templates: [],
  };
  for (const m of modules) {
    const bucket = TYPE_TO_BUCKET[m.type];
    if (!bucket) continue; // unknown/bundle type — skip rather than crash
    const entity: Record<string, unknown> = {
      id: m.id,
      type: m.type,
      name: m.name,
      payload: m.payload,
    };
    if (m.description !== undefined) entity.description = m.description;
    if (m.tags !== undefined) entity.tags = m.tags;
    (envelope[bucket] as Array<Record<string, unknown>>).push(entity);
  }
  return envelope;
}

/**
 * Relink a bundle's frozen children to freshly-installed module ids after
 * "extract to library". `extractBundleChildren` mints new ids for the
 * extracted leaves but does NOT touch the source bundle, so its children
 * still point at the OLD ids and read as "target module missing". This
 * rewrites each child's whole-string `id` AND any intra-bundle ref (a
 * constraint's `source_wildcard_id` / `target_wildcard_id`, a nested
 * `@{uuid}` in option text) via `walkRemap` using the same remap table.
 *
 * Ids absent from `remap` (refs pointing OUTSIDE the extracted set) pass
 * through verbatim — they keep resolving against whatever else lives in
 * the library. Pure: returns a new array, never mutates the input.
 */
export function relinkChildren<T extends Record<string, unknown>>(
  children: T[],
  remap: Record<string, string>,
): T[] {
  return walkRemap(children, remap) as T[];
}

/**
 * True iff ANY child no longer resolves to a row in its kind's id-set:
 * bundle-typed children (`type:"bundle"`) are looked up in `bundleIds`,
 * every other (leaf module) child in `moduleIds`. Discrimination matches
 * `validateBundle` — a child whose id lives only in the wrong set still
 * dangles. Drives the extract button's enabled state: extract is a heal
 * action, only offered when something actually needs relinking.
 */
export function computeHasDangling(
  children: ReadonlyArray<{ id?: unknown; type?: unknown }>,
  moduleIds: ReadonlySet<string>,
  bundleIds: ReadonlySet<string>,
): boolean {
  return children.some((c) => {
    if (typeof c.id !== "string") return true;
    const ids = c.type === "bundle" ? bundleIds : moduleIds;
    return !ids.has(c.id);
  });
}
</script>

<script setup lang="ts">
/**
 * BundleEditor — SPA editor for library-tracked bundles.
 *
 * Task 2: interactive children list — drag reorder, enable/disable toggle,
 * duplicate, remove. Children mutations live in a local ref and persist
 * via a single bundles.update PUT on Save. Task 3 adds the right-side
 * snapshot edit pane.
 *
 * Route shape mirrors the other kind editors:
 *   /bundles/new            → create-mode (disabled Save, points user to Context widget)
 *   /bundles/:id/edit       → edit-mode
 */
import { computed, onMounted, ref, toRaw } from "vue";
import type { BreadcrumbItem } from "../components/Breadcrumb.types";
import type { SaveState, EditorFieldError } from "../components/EditorFrame.types";
import { useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Button from "../components/ui/Button.vue";
import CommunityRowActions from "../components/CommunityRowActions.vue";
import DraftBanner from "../components/DraftBanner.vue";
import ColorPicker from "../components/ColorPicker.vue";
import BundleChildRow from "../components/BundleChildRow.vue";
import BundleChildPane from "../components/BundleChildPane.vue";
import BundleAddChildModal from "../components/BundleAddChildModal.vue";
import ConfirmDialog from "../../components/shared/ConfirmDialog.vue";
import { useToast } from "../composables/useToast";
import { useUnsavedGuard } from "../composables/useUnsavedGuard";
import { useEditorShortcuts } from "../composables/useEditorShortcuts";
import { useEditorDraft } from "../composables/useEditorDraft";
import { useReturnTo } from "../composables/useReturnTo";
import { useBundleStore } from "../stores/bundleStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useModuleStore } from "../stores/moduleStore";
import { useRecentStore } from "../stores/recentStore";
import { useCascadeStore } from "../cascade/cascade-store";
import { useCascadeApply } from "../cascade/useCascadeApply";
import CascadeConfirmDialog from "../cascade/CascadeConfirmDialog.vue";
import PillCountBadge from "../cascade/PillCountBadge.vue";
import type { BundleRow, ModuleRow } from "../api/types";
import type { ModuleEntry } from "../../widgets/_shared";
import {
  extractBundleChildren,
  type ExtractableChild,
} from "../../components/context/bundles/extract-to-library";
import { installEnvelope } from "../import-export/install";
import { api } from "../api/client";

const props = defineProps<{ id?: string }>();

const router = useRouter();
const { resolveReturnTo } = useReturnTo();
const store = useBundleStore();
const currentRow = computed(() =>
  props.id ? store.catalog.find((b) => b.id === props.id) ?? null : null,
);
const categoryStore = useCategoryStore();
const moduleStore = useModuleStore();
const toast = useToast();
const recent = useRecentStore();
const cascade = useCascadeStore();
const cascadeApply = useCascadeApply();

const cascadeDialogOpen = ref(false);

const cascadeRefs = computed(() => {
  if (!props.id) return [];
  return cascade.refsTo("bundle", props.id);
});

async function onEntityDeleteClick(): Promise<void> {
  if (!props.id) return;
  // Always confirm — see WildcardEditor for the rationale.
  cascadeDialogOpen.value = true;
}

function onCascadeDialogConfirmed(result: { undo_entry_id: string; affected_count: number }): void {
  cascadeDialogOpen.value = false;
  store.remove(props.id!);
  const undoId = result.undo_entry_id;
  const count = result.affected_count;
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
  router.push(resolveReturnTo("/bundles"));
}

const addModalOpen = ref(false);

/** Default bundle frame color when user hasn't picked one. Resolved
 *  at mount from the `--wp-bundle-default` CSS token (see
 *  `tokens.css`), with a slate-700 hard fallback for unit-test envs
 *  where `getComputedStyle` returns "". This keeps the editor picker,
 *  the Bundles list swatch, the Dashboard swatch, and the canvas
 *  frame all paint the same colour for "no explicit colour", and
 *  retheming is a one-line token change.
 *
 *  Previous version hardcoded `#6366f1` (indigo) which diverged from
 *  the slate token the canvas + dashboard actually paint with — list
 *  showed slate, picker showed indigo, neither agreed with the user
 *  intent the comment claimed. */
const DEFAULT_COLOR_FALLBACK = "#334155";
const defaultColor = ref<string>(DEFAULT_COLOR_FALLBACK);

function resolveDefaultColor(): void {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--wp-bundle-default")
    .trim();
  if (v) defaultColor.value = v;
}

const COLOR_PRESETS = [
  "#6366f1", "#7c3aed", "#a78bfa", "#22d3ee", "#34d399",
  "#fbbf24", "#f472b6", "#fb7185", "#ef4444", "#46566B",
  "#10b981", "#f59e0b",
];

const loading = ref(false);
const saving = ref(false);
const saveState = ref<SaveState>("idle");
const saveError = ref<string>("");
let saveStateTimer: ReturnType<typeof setTimeout> | null = null;

function setSaveState(next: SaveState, ttl?: number): void {
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  saveState.value = next;
  if (ttl && (next === "saved" || next === "error")) {
    saveStateTimer = setTimeout(() => {
      if (saveState.value === next) saveState.value = "idle";
    }, ttl);
  }
}
const original = ref<BundleRow | null>(null);

const name = ref("");
const description = ref("");
const color = ref<string>(defaultColor.value);
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const contentRating = ref<"safe" | "nsfw">("safe");

/** Mutable local copy of bundle children. Edits in the row stack
 *  (and the side pane in Task 3) update this; Save persists it via PUT. */
const children = ref<Array<Record<string, unknown>>>([]);

/** Last-saved baseline state per child, keyed by id. Used by
 *  BundleChildRow to decide whether to render SNAPSHOT or
 *  SNAPSHOT · EDITED — the pill resets to plain SNAPSHOT after every
 *  successful save (current children become the new baseline). */
const baselineByChildId = ref<Map<string, string>>(new Map());

/** `patchInstance` writes `null` to a field rather than deleting the key
 *  when the user reverts a value back to library default. For the
 *  EDITED diff we want those null overrides to be indistinguishable
 *  from "field never set" — otherwise the pill never clears even when
 *  the user manually returns every field to its starting value. Strip
 *  null/undefined entries from `instance` before serializing. */
function normalizeChild(c: Record<string, unknown>): Record<string, unknown> {
  // Bundle-typed children are references — the only persistent state
  // is {id, type, name?, color?}. The GET-expanded `children` array and
  // the `_resolved_from` / `_missing_ref` markers are server-side view
  // augmentations that must NOT enter the dirty-check shape: when the
  // referenced bundle changes server-side, those fields drift and would
  // falsely flag the OUTER bundle as having unsaved local edits.
  if (c.type === "bundle") {
    const ref: Record<string, unknown> = { id: c.id, type: "bundle" };
    if (typeof c.name === "string") ref.name = c.name;
    if (typeof c.color === "string" || c.color === null) ref.color = c.color;
    return ref;
  }
  const inst = c.instance as Record<string, unknown> | undefined;
  if (!inst) return c;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inst)) {
    if (v !== null && v !== undefined) cleaned[k] = v;
  }
  return { ...c, instance: cleaned };
}

function snapshotBaseline(rows: Array<Record<string, unknown>>): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of rows) {
    const id = c.id as string | undefined;
    if (id) m.set(id, JSON.stringify(normalizeChild(c)));
  }
  return m;
}

/** Drag-reorder state. Source index captured on dragstart, target on
 *  dragover. Cleared on drop / cancel. Drives the data-drag-over
 *  styling for the drop-line indicator. */
const dragSourceIdx = ref<number | null>(null);
const dragOverIdx = ref<number | null>(null);

/** Side-pane selection — null when no child is being edited. */
const selectedChildId = ref<string | null>(null);

const isEdit = computed(() => !!props.id);

// Unsaved-changes guard
const bundleBaseline = ref<string>("");

function bundleSnapshot(): string {
  return JSON.stringify({
    name: name.value,
    description: description.value,
    color: color.value,
    categoryId: categoryId.value,
    tags: tags.value,
    children: children.value.map(normalizeChild),
  });
}

const { showConfirm, dirty, onConfirmLeave, onCancelLeave } = useUnsavedGuard(
  () => bundleSnapshot() !== bundleBaseline.value,
);

const draft = useEditorDraft({
  kind: "bundle",
  id: props.id ?? "new",
  dirty,
  snapshot: bundleSnapshot,
});

function applyDraft(): void {
  const snap = draft.restore();
  if (!snap) return;
  try {
    const parsed = JSON.parse(snap) as {
      name: string;
      description: string;
      color: string;
      categoryId: string | null;
      tags: string[];
      children: Array<Record<string, unknown>>;
    };
    name.value = parsed.name;
    description.value = parsed.description;
    color.value = parsed.color;
    categoryId.value = parsed.categoryId;
    tags.value = parsed.tags;
    children.value = Array.isArray(parsed.children) ? parsed.children : [];
  } catch {
    toast.push({ severity: "error", summary: "Draft restore failed", life: 3000 });
  }
}

const selectedChild = computed<Record<string, unknown> | null>(() => {
  const id = selectedChildId.value;
  if (!id) return null;
  return children.value.find((c) => (c.id as string) === id) ?? null;
});

const selectedChildIdx = computed<number>(() => {
  const id = selectedChildId.value;
  if (!id) return -1;
  return children.value.findIndex((c) => (c.id as string) === id);
});

/** Set of child ids whose current normalized state diverges from the
 *  last-saved baseline. Drives the SNAPSHOT · EDITED pill on each row.
 *  Recomputes reactively as children mutate, so reverting overrides
 *  back to baseline (even via "no override" null writes) clears the
 *  pill without an explicit reset. */
const editedChildIds = computed<Set<string>>(() => {
  const out = new Set<string>();
  for (const c of children.value) {
    const id = c.id as string | undefined;
    if (!id) continue;
    const base = baselineByChildId.value.get(id);
    if (base === undefined) {
      out.add(id); // new row, no baseline yet
      continue;
    }
    if (JSON.stringify(normalizeChild(c)) !== base) out.add(id);
  }
  return out;
});

const childrenSubtitle = computed<string>(() => {
  if (!selectedChildId.value || !selectedChild.value) {
    return "Frozen snapshots — click row to edit on the right.";
  }
  // Bundle-typed children are LIVE references, not snapshots — the
  // subtitle has to match the pane banner or the user will think
  // they're about to edit a private copy.
  if (selectedChild.value.type === "bundle") {
    const name = (selectedChild.value.name as string | undefined) ?? "(unnamed bundle)";
    return `Viewing reference to ${name} — click × on the pane to close`;
  }
  const meta = selectedChild.value.meta as { name?: string } | undefined;
  const name = meta?.name ?? "(unnamed)";
  return `Editing snapshot of ${name} — click × on the pane to close`;
});

onMounted(async () => {
  // Pull the bundle-default token from CSS so the picker shows the
  // same colour the canvas + Dashboard + Bundles list paint when the
  // row carries no explicit colour. Must run before the `color.value =
  // row.color || defaultColor.value` line below so a freshly-loaded row
  // with NULL colour shows the token-derived swatch, not the hardcoded
  // fallback.
  resolveDefaultColor();
  // Refresh the editor's local `color` ref if it's still on the
  // pre-resolve fallback — covers the "create new bundle" path where
  // the ref initialised before the token was readable.
  if (color.value === DEFAULT_COLOR_FALLBACK) {
    color.value = defaultColor.value;
  }
  await categoryStore.fetchAll();
  // Catalog loads power the add-child library picker AND
  // ConstraintMatrixSection's sub-category lookups inside the pane.
  // Bundle catalog drives the new tier-2 reference picker — fetched in
  // parallel since the two stores are independent.
  try {
    await Promise.all([moduleStore.fetchCatalog(), store.fetchCatalog()]);
  } catch (e) {
    toast.push({ severity: "error", summary: "Failed to load library", detail: String(e), life: 3000 });
  }
  if (!props.id) {
    bundleBaseline.value = bundleSnapshot();
    return;
  }
  loading.value = true;
  try {
    const row = await store.get(props.id);
    original.value = row;
    name.value = row.name;
    description.value = row.description ?? "";
    color.value = row.color || defaultColor.value;
    categoryId.value = row.category_id;
    tags.value = [...(row.tags ?? [])];
    contentRating.value = row.content_rating ?? "safe";
    children.value = Array.isArray(row.children)
      ? row.children.map((c) => ({ ...(c as Record<string, unknown>) }))
      : [];
    baselineByChildId.value = snapshotBaseline(children.value);
    recent.push({ id: props.id, kind: "bundle", name: name.value });
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  } finally {
    loading.value = false;
  }
  bundleBaseline.value = bundleSnapshot();
});

function cancel() {
  router.push(resolveReturnTo("/bundles"));
}

// BundleEditor deliberately does not redirect on save. Bundles are edited
// iteratively (add children, reorder, recolor); jumping back to the list
// after every save would force the user to re-enter the editor for each
// tweak. cancel() uses resolveReturnTo for the explicit-exit path.
async function save() {
  if (!isEdit.value || !props.id) {
    toast.push({
      severity: "info",
      summary: "Create from Context",
      detail: "New bundles are created by wrapping modules in the Context widget.",
      life: 4000,
    });
    return;
  }
  if (validationErrors.value.length > 0) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;
  setSaveState("saving");
  saving.value = true;
  try {
    // Normalise "still at the resolved default" back to NULL so the
    // server stores "no explicit colour" instead of pinning the row to
    // the current token value (which would freeze the colour across
    // theme switches + future token retunes).
    const colorOut = color.value === defaultColor.value ? null : color.value;
    const updated = await store.update(props.id, {
      name: name.value.trim(),
      description: description.value,
      color: colorOut,
      category_id: categoryId.value,
      tags: [...tags.value],
      children: stripBundleChildrenForSave(children.value),
      content_rating: contentRating.value,
    });
    original.value = updated;
    children.value = Array.isArray(updated.children)
      ? updated.children.map((c) => ({ ...(c as Record<string, unknown>) }))
      : [];
    baselineByChildId.value = snapshotBaseline(children.value);
    bundleBaseline.value = bundleSnapshot();
    draft.discard();
    recent.push({ id: props.id, kind: "bundle", name: updated.name });
    setSaveState("saved", 1500);
    toast.push({ severity: "success", summary: "Saved", detail: updated.name });
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    setSaveState("error", 3000);
    toast.push({ severity: "error", summary: "Save failed", detail: saveError.value, life: 4000 });
  } finally {
    saving.value = false;
  }
}

/** True while an extract-to-library run is in flight — disables the
 *  toolbar button so a double-click can't fire two installs. */
const extracting = ref(false);

/** Whether any child currently dangles (its id resolves to no library
 *  row of its kind). Extract is a heal action — relinking a bundle whose
 *  children all resolve would only churn ids for no benefit — so the
 *  button is gated on this. Recomputes as the module/bundle catalogs
 *  load and after extract relinks + refetches. */
const hasDanglingChildren = computed<boolean>(() =>
  computeHasDangling(
    children.value,
    new Set(moduleStore.catalog.map((m) => m.id)),
    new Set(store.catalog.map((b) => b.id)),
  ),
);

/**
 * Extract this bundle's leaf children into standalone library modules
 * (Feature 4). Runs the pure `extractBundleChildren` transform (fresh
 * ids + intra-bundle ref remap), groups the result into an install
 * envelope, and reuses `installEnvelope` — the same atomic
 * commit pipeline the Import tab + community embed use — so migrations,
 * integrity checks, and collision handling all apply for free.
 *
 * Nested bundles are skipped by the helper (a bundle isn't a leaf
 * module); the skipped count is surfaced in the success toast. On
 * success the module catalog is refreshed so the new rows appear
 * immediately in the add-child picker + library views.
 */
async function extractToLibrary(): Promise<void> {
  if (extracting.value) return;
  const { modules, remap, skipped } = extractBundleChildren(
    children.value as unknown as ExtractableChild[],
  );
  if (modules.length === 0) {
    toast.push({ severity: "info", summary: "Nothing to extract", life: 3000 });
    return;
  }
  extracting.value = true;
  try {
    const envelope = buildExtractEnvelope(modules);
    const result = await installEnvelope(
      { envelope },
      { importExport: api.importExport },
    );
    if (result.ok) {
      let detail = `Extracted ${modules.length} module${modules.length === 1 ? "" : "s"} to your library`;
      if (skipped > 0) {
        detail += `, ${skipped} nested bundle${skipped === 1 ? "" : "s"} skipped`;
      }
      toast.push({ severity: "success", summary: "Extracted to library", detail, life: 4000 });
      // Refresh the catalog so the freshly-installed modules show up in
      // the add-child picker + Library views without a manual reload —
      // AND so hasDanglingChildren re-evaluates against the new module
      // ids once the relink lands below.
      try {
        await moduleStore.fetchCatalog();
      } catch {
        // Non-fatal: the install already committed; a stale catalog
        // self-heals on next navigation. Don't surface as an error.
      }
      // Relink the bundle's frozen children to the freshly-installed
      // module ids so the bundle resolves ("target module missing"
      // clears). relinkChildren (walkRemap) rewrites each child's
      // whole-string `id` + any intra-bundle ref. `save()` then PUTs the
      // relinked children via bundles.update; it deliberately does NOT
      // navigate away (see save() docs), so the user stays in the healed
      // editor — no separate bundle-update call needed.
      children.value = relinkChildren(
        toRaw(children.value),
        remap,
      ) as typeof children.value;
      await save();
    } else {
      toast.push({
        severity: "error",
        summary: "Extract failed",
        detail: result.error?.message ?? "Extract failed",
        life: 4000,
      });
    }
  } catch (e) {
    toast.push({
      severity: "error",
      summary: "Extract failed",
      detail: e instanceof Error ? e.message : String(e),
      life: 4000,
    });
  } finally {
    extracting.value = false;
  }
}

useEditorShortcuts({
  onSave: () => save(),
  onCancel: () => cancel(),
  enabled: () => !saving.value,
});

/** Snapshot a library module into a bundle child entry.
 *
 *  Critical: the snapshot's `id` MUST be the library uuid (`row.id`),
 *  NOT a fresh local id. Bundle insertion at runtime treats the child's
 *  `id` as the library link — Context-side `buildBundleInsertion`
 *  preserves it verbatim, and the engine's drift / missing-from-library
 *  scanners match against it. A random id surfaces every child as
 *  "missing in library" on the ComfyUI side. `meta.library_name`
 *  carries the canonical name so "reset overrides" can restore the
 *  display name without hitting the server (denormalized at snapshot
 *  time). Matches `toChildSnapshot` in ContextWidget for in-graph
 *  Wrap-in-bundle. */
function onAddPick(row: ModuleRow) {
  const snapshot: Record<string, unknown> = {
    id: row.id,
    type: row.type,
    enabled: true,
    collapsed: false,
    meta: { name: row.name, library_name: row.name },
    payload: row.payload ?? {},
    payload_hash: row.payload_hash,
    instance: {},
    entries: [],
  };
  children.value = [...children.value, snapshot];
}

/** Pick a bundle as a child — stored as a reference, NOT a snapshot.
 *  See `_validate_bundle_refs` in wp_api/bundles.py: bundle children
 *  persist as id-only pointers, and GET /bundles/{id} expands them
 *  inline on read. Display fields cached so the parent renders a
 *  placeholder if the referenced bundle is later deleted.
 *
 *  Inner children are attached inline at pick time so the SPA's
 *  in-memory shape matches what the GET expander would produce on
 *  reload — pane summaries (inner-count) and any future canvas insert
 *  pre-flatten then read the right data immediately. The save path
 *  strips this back to the reference shape (stripBundleChildrenForSave)
 *  so the wire payload stays canonical. */
function onAddBundlePick(row: BundleRow) {
  const ref: Record<string, unknown> = {
    id: row.id,
    type: "bundle",
    name: row.name,
    color: row.color,
    children: Array.isArray(row.children) ? [...row.children] : [],
    _resolved_from: row.id,
  };
  children.value = [...children.value, ref];
}

/** Strip bundle-typed children down to their reference shape before
 *  sending a PUT to the API. The GET response server-expands references
 *  by attaching the inner bundle's current children inline; saving that
 *  expanded form back would persist a stale snapshot the server would
 *  have to defensively strip anyway. Doing it here keeps the wire
 *  payload small and the intent explicit.
 *
 *  Leaf children (wildcard / fixed_values / combine / derivation /
 *  constraint) pass through unchanged. */
function stripBundleChildrenForSave(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((c) => {
    if (c.type !== "bundle") return { ...c };
    const ref: Record<string, unknown> = { id: c.id, type: "bundle" };
    if (typeof c.name === "string") ref.name = c.name;
    if (typeof c.color === "string" || c.color === null) ref.color = c.color;
    return ref;
  });
}

/** Tier-1 bundles eligible to be referenced as a child of THIS bundle.
 *  Filter out:
 *  - The bundle currently being edited (self-reference rejected by API).
 *  - Any bundle that already contains a bundle child (would make this
 *    bundle's reference a tier-3 structure — API rejects it, so hide
 *    rather than offer a click that fails). */
const eligibleBundles = computed<BundleRow[]>(() => {
  return store.catalog.filter((b) => {
    if (props.id && b.id === props.id) return false;
    const hasBundleChild = (b.children ?? []).some(
      (c) => typeof c === "object" && c !== null && (c as { type?: string }).type === "bundle",
    );
    return !hasBundleChild;
  });
});

function onToggleChild(idx: number) {
  const next = [...children.value];
  const current = next[idx];
  next[idx] = { ...current, enabled: current.enabled === false };
  children.value = next;
}

function onDuplicateChild(idx: number) {
  const src = children.value[idx];
  if (!src) return;
  // Keep the library uuid — multi-instance bundles intentionally share
  // `id` across siblings (per buildBundleInsertion docs). Per-instance
  // disambiguation lives in `_uid`, which gets stamped on insert into
  // a Context node, not here at bundle-edit time.
  const copy = { ...src };
  const next = [...children.value];
  next.splice(idx + 1, 0, copy);
  children.value = next;
}

function onRemoveChild(idx: number) {
  const removedId = children.value[idx]?.id as string | undefined;
  if (removedId && removedId === selectedChildId.value) {
    selectedChildId.value = null;
  }
  const next = [...children.value];
  next.splice(idx, 1);
  children.value = next;
}

function onSelectChild(idx: number) {
  const c = children.value[idx];
  if (!c) return;
  const id = (c.id as string) ?? null;
  // Toggle off if clicking the already-selected row.
  selectedChildId.value = id === selectedChildId.value ? null : id;
}

function onPaneClose() {
  selectedChildId.value = null;
}

function onPaneUpdate(patch: Partial<ModuleEntry>) {
  const idx = selectedChildIdx.value;
  if (idx < 0) return;
  const next = [...children.value];
  next[idx] = { ...next[idx], ...(patch as Record<string, unknown>) };
  children.value = next;
}

function onDragStart(idx: number, evt: DragEvent) {
  dragSourceIdx.value = idx;
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = "move";
    // Firefox needs setData for the drag to fire at all.
    evt.dataTransfer.setData("text/plain", String(idx));
  }
}
function onDragOver(idx: number, evt: DragEvent) {
  if (dragSourceIdx.value === null || dragSourceIdx.value === idx) return;
  evt.preventDefault();
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
  if (dragOverIdx.value !== idx) dragOverIdx.value = idx;
}
function onDragLeave() {
  dragOverIdx.value = null;
}
function onDrop(idx: number, evt: DragEvent) {
  evt.preventDefault();
  const from = dragSourceIdx.value;
  dragSourceIdx.value = null;
  dragOverIdx.value = null;
  if (from === null || from === idx) return;
  const next = [...children.value];
  const [moved] = next.splice(from, 1);
  next.splice(idx, 0, moved);
  children.value = next;
}
function onDragEnd() {
  dragSourceIdx.value = null;
  dragOverIdx.value = null;
}

const breadcrumb = computed<BreadcrumbItem[]>(() => [
  { to: "/dashboard", label: "Library" },
  { to: "/bundles", label: "Bundles" },
  { label: isEdit.value ? (name.value || original.value?.name || "Editing") : "New bundle" },
]);

/** Gates the field-error rollup. Flipped on the first invalid Save
 *  attempt; reset when the form becomes valid (handled by the
 *  computed's emptiness). */
const showErrors = ref(false);

const validationErrors = computed<EditorFieldError[]>(() => {
  const out: EditorFieldError[] = [];
  if (!name.value.trim()) {
    out.push({ field: "editor-section-identity", label: "Name", message: "Required" });
  }
  return out;
});

const visibleErrors = computed<EditorFieldError[]>(() =>
  showErrors.value ? validationErrors.value : [],
);
</script>

<template>
  <EditorFrame
    :title="isEdit ? (original?.name || 'Loading…') : 'New bundle'"
    back-route="/bundles"
    back-label="Bundles"
    :breadcrumb="breadcrumb"
    :saving="saving"
    :save-state="saveState"
    :save-error="saveError"
    :dirty="dirty"
    :save-disabled="!isEdit"
    :errors="visibleErrors"
    @save="save"
    @cancel="cancel"
  >
    <template v-if="isEdit" #header-extra>
      <span v-if="cascadeRefs.length > 0" class="wp-editor-used-by">
        used by <PillCountBadge :count="cascadeRefs.length" />
      </span>
      <Button
        variant="ghost"
        icon="pi-clone"
        data-test="bd-extract-btn"
        :loading="extracting"
        :disabled="!isEdit || children.length === 0 || !hasDanglingChildren"
        :title="!hasDanglingChildren ? 'All children are linked — nothing to extract' : undefined"
        @click="extractToLibrary"
      >Extract to library</Button>
      <CommunityRowActions
        v-if="currentRow"
        :row="currentRow"
        kind="bundle"
        labeled
      />
    </template>
    <template v-if="isEdit" #footer-left>
      <Button
        variant="ghost"
        icon="pi-trash"
        class="wp-btn--danger"
        data-test="bd-delete-btn"
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
    <div v-if="loading" class="wp-dim wp-bundle-editor__loading">Loading bundle…</div>

    <template v-else>
      <div id="editor-section-identity">
        <IdentityCard
          :name="name"
          :description="description"
          :category-id="categoryId"
          :tags="tags"
          @update:name="(v) => (name = v)"
          @update:description="(v) => (description = v)"
          @update:category-id="(v) => (categoryId = v)"
          :content-rating="contentRating"
          @update:tags="(v) => (tags = v)"
          @update:content-rating="(v) => (contentRating = v)"
        >
          <template #nameLeading>
            <ColorPicker
              v-model="color"
              :presets="COLOR_PRESETS"
              aria-label="Bundle frame color"
            />
          </template>
        </IdentityCard>
      </div>

      <Card
        :title="`Children (${children.length})`"
        :subtitle="childrenSubtitle"
      >
        <div class="wp-bundle-children-grid">
          <div class="wp-bundle-children-stack" data-test="bundle-children-list">
            <div
              v-if="!children.length"
              class="wp-dim wp-bundle-editor__empty"
            >
              This bundle has no children yet.
            </div>
            <BundleChildRow
              v-for="(child, idx) in children"
              :key="`${(child.id as string) ?? ''}_${idx}`"
              :child="child"
              :idx="idx"
              :selected="(child.id as string) === selectedChildId"
              :edited="editedChildIds.has((child.id as string) ?? '')"
              :class="dragOverIdx === idx ? 'wp-bundle-children-stack__drag-over' : null"
              @toggle="onToggleChild(idx)"
              @duplicate="onDuplicateChild(idx)"
              @remove="onRemoveChild(idx)"
              @select="onSelectChild(idx)"
              @drag-start="(e) => onDragStart(idx, e)"
              @drag-over="(e) => onDragOver(idx, e)"
              @drag-leave="onDragLeave"
              @drop="(e) => onDrop(idx, e)"
              @drag-end="onDragEnd"
            />
            <button
              type="button"
              class="wp-bundle-add-btn"
              data-test="bundle-add-open"
              @click="addModalOpen = true"
            >
              <i class="pi pi-plus" aria-hidden="true" />
              add child from library
            </button>
          </div>
          <BundleChildPane
            :child="selectedChild"
            :sibling-modules="children"
            @update="onPaneUpdate"
            @close="onPaneClose"
          />
        </div>
      </Card>

      <BundleAddChildModal
        :visible="addModalOpen"
        :modules="moduleStore.catalog"
        :bundles="eligibleBundles"
        @close="addModalOpen = false"
        @pick="onAddPick"
        @pick-bundle="onAddBundlePick"
      />
    </template>

    <!-- CascadeConfirmDialog: shown when entity has downstream refs. -->
    <CascadeConfirmDialog
      v-if="isEdit && props.id"
      :open="cascadeDialogOpen"
      kind="bundle"
      :id="props.id"
      action="delete"
      @confirmed="onCascadeDialogConfirmed"
      @cancelled="cascadeDialogOpen = false"
    />
    <!-- ConfirmDialog inside EditorFrame to keep template single-root;
         see WildcardEditor for the multi-root Transition explanation. -->
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
.wp-editor-used-by {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
}
.wp-bundle-editor__loading { padding: var(--wp-space-8) 0; text-align: center; }
.wp-bundle-editor__empty { padding: var(--wp-space-6) 0; font-size: var(--wp-text-base); }

.wp-bundle-children-grid {
  display: grid;
  grid-template-columns: minmax(380px, 1fr) minmax(420px, 1.4fr);
  gap: var(--wp-space-5);
  align-items: start;
}
.wp-bundle-children-stack {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
  min-width: 0;
}
.wp-bundle-children-stack__drag-over {
  box-shadow: 0 -2px 0 var(--wp-accent-500);
}
.wp-bundle-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--wp-space-4);
  width: 100%;
  padding: var(--wp-space-4);
  margin-top: var(--wp-space-2);
  border: 1px dashed var(--wp-border-strong, var(--wp-border));
  border-radius: var(--wp-radius, 4px);
  background: transparent;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}
.wp-bundle-add-btn:hover {
  border-style: solid;
  border-color: var(--wp-accent-500);
  color: var(--wp-accent-500);
  background: color-mix(in oklab, var(--wp-accent-500) 7%, transparent);
}
</style>
