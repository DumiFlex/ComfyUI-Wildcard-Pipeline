<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Checkbox from "../components/ui/Checkbox.vue";
import Field from "../components/ui/Field.vue";
import Icon, { ICON_SM } from "../components/ui/Icon.vue";
import Input from "../components/ui/Input.vue";
import Select from "../components/ui/Select.vue";
import { useToast } from "../composables/useToast";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import { catChipStyle } from "../utils/catChip";
import { api, ApiError } from "../api/client";
import type { BundleRow, CategoryRow, ImportBundle, ModuleRow } from "../api/types";
import ExportTab from "../import-export/ExportTab.vue";
import ImportTab from "../import-export/ImportTab.vue";
import ImportPicker from "../import-export/ImportPicker.vue";
import ConflictModal from "../import-export/ConflictModal.vue";
import { detectCollisions, type LibraryRow } from "../import-export/collision";
import {
  buildCommitPayload,
  type CommitPayload,
  type Decision,
  type EntityKind,
  type ResolvedEntity,
  type ResolvedCategoryEntity,
  type ResolvedSelection,
} from "../import-export/commit";
import {
  discoverBrokenRefsForImport,
  type ImportedConstraint,
  type ImportedWildcard,
} from "../import-export/broken-refs";
import type {
  BatchConflict,
  PerItemDecision,
  PerItemIssue,
} from "../import-export/conflict-types";
import type { ModuleRow as FingerprintModuleRow } from "../import-export/fingerprint";
import type { RawPayload } from "../import-export/migrations";
import type { IntegrityWarning } from "../import-export/parse";
import {
  buildFilteredBundle,
  bundleSizeBytes,
  classifyBundle,
  classifyCategory,
  classifyModule,
  formatBytes,
  GROUPS,
  groupForModule,
  presetFavoritesOnly,
  presetFull,
  presetWildcardsOnly,
  selectionCounts,
  selectionKey,
  type ConflictKind,
  type ConflictResult,
  type GroupKey,
  type GroupMeta,
} from "../utils/bundleSelection";

type Mode = "export" | "export-v2" | "import" | "import-v2";

const toast = useToast();

const mode = ref<Mode>("export");

// ---------- Source library state (fetched once on mount) ----------

const localModules = ref<ModuleRow[]>([]);
const localCategories = ref<CategoryRow[]>([]);
const localBundles = ref<BundleRow[]>([]);

const refreshing = ref(false);

async function loadLibrary() {
  refreshing.value = true;
  try {
    const [mods, cats, buns] = await Promise.all([
      api.modules.list({ limit: 1000 }),
      api.categories.list(),
      api.bundles.list({ limit: 1000 }),
    ]);
    localModules.value = mods.items;
    localCategories.value = cats.items;
    localBundles.value = buns.items;
  } catch (e) {
    toast.push({
      severity: "error",
      summary: "Failed to load library",
      detail: String(e), life: 4000,
    });
  } finally {
    refreshing.value = false;
  }
}

onMounted(loadLibrary);

// ---------- Export tab state ----------

const exportSelected = ref<Set<string>>(new Set());
const exportSearch = ref("");
const exportOpenGroups = ref<Set<GroupKey>>(new Set());

// Initial seed: "Full library" once data lands.
let didSeedExport = false;
function seedExportIfReady() {
  if (didSeedExport) return;
  if (
    localModules.value.length === 0
    && localCategories.value.length === 0
    && localBundles.value.length === 0
  ) return;
  exportSelected.value = presetFull(
    localModules.value, localCategories.value, localBundles.value,
  );
  didSeedExport = true;
}
const seedWatcher = computed(() =>
  localModules.value.length + localCategories.value.length + localBundles.value.length,
);

function modulesForGroup(g: GroupMeta, list: ModuleRow[]): ModuleRow[] {
  if (g.type === null) return [];
  return list.filter((m) => m.type === g.type);
}

function matchesSearch(name: string, id: string, q: string): boolean {
  if (!q.trim()) return true;
  const t = q.trim().toLowerCase();
  return name.toLowerCase().includes(t) || id.toLowerCase().includes(t);
}

interface RowItem {
  id: string;
  name: string;
  category_id?: string | null;
  is_favorite?: boolean;
  tags?: string[];
}

function rowsForGroup(g: GroupMeta, q: string): RowItem[] {
  if (g.key === "category") {
    return localCategories.value
      .filter((c) => matchesSearch(c.name, c.id, q))
      .map((c) => ({ id: c.id, name: c.name }));
  }
  if (g.key === "bundle") {
    return localBundles.value
      .filter((b) => matchesSearch(b.name, b.id, q))
      .map((b) => ({
        id: b.id, name: b.name,
        category_id: b.category_id, is_favorite: b.is_favorite,
        tags: b.tags,
      }));
  }
  return modulesForGroup(g, localModules.value)
    .filter((m) => matchesSearch(m.name, m.id, q))
    .map((m) => ({
      id: m.id, name: m.name,
      category_id: m.category_id, is_favorite: m.is_favorite,
      tags: m.tags,
    }));
}

function exportRowKey(g: GroupMeta, id: string): string {
  return selectionKey(g.key, id);
}

function isExportSelected(g: GroupMeta, id: string): boolean {
  return exportSelected.value.has(exportRowKey(g, id));
}

function toggleExportRow(g: GroupMeta, id: string) {
  const k = exportRowKey(g, id);
  const next = new Set(exportSelected.value);
  if (next.has(k)) next.delete(k); else next.add(k);
  exportSelected.value = next;
}

function setGroupAll(g: GroupMeta, on: boolean, q: string) {
  const next = new Set(exportSelected.value);
  for (const row of rowsForGroup(g, q)) {
    const k = exportRowKey(g, row.id);
    if (on) next.add(k); else next.delete(k);
  }
  exportSelected.value = next;
}

function toggleGroupOpen(key: GroupKey) {
  const next = new Set(exportOpenGroups.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  exportOpenGroups.value = next;
}

function isGroupOpen(g: GroupMeta, q: string): boolean {
  if (q.trim()) return true;
  return exportOpenGroups.value.has(g.key);
}

interface GroupCheckState { all: boolean; some: boolean }

function groupCheckState(g: GroupMeta, q: string): GroupCheckState {
  const rows = rowsForGroup(g, q);
  if (rows.length === 0) return { all: false, some: false };
  const sel = rows.filter((r) => isExportSelected(g, r.id)).length;
  return { all: sel === rows.length, some: sel > 0 && sel < rows.length };
}

const exportCounts = computed(() => selectionCounts(exportSelected.value));

const filteredBundle = computed<ImportBundle>(() =>
  buildFilteredBundle({
    modules: localModules.value,
    categories: localCategories.value,
    bundles: localBundles.value,
    selected: exportSelected.value,
  }),
);
const bundleBytes = computed(() => bundleSizeBytes(filteredBundle.value));

const categoryById = computed(() => {
  const m = new Map<string, CategoryRow>();
  for (const c of localCategories.value) m.set(c.id, c);
  return m;
});

function presetApplyFull() {
  exportSelected.value = presetFull(
    localModules.value, localCategories.value, localBundles.value,
  );
}
function presetApplyWildcards() {
  exportSelected.value = presetWildcardsOnly(localModules.value);
}
function presetApplyFavorites() {
  exportSelected.value = presetFavoritesOnly(localModules.value, localBundles.value);
}

function downloadBundle() {
  const bundle = filteredBundle.value;
  const bundleCount = bundle.bundles?.length ?? 0;
  if (
    bundle.modules.length === 0
    && bundle.categories.length === 0
    && bundleCount === 0
  ) return;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const yyyymmdd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  a.download = `wildcard-pipeline-${bundle.modules.length}-modules-${yyyymmdd}.json`;
  a.click();
  URL.revokeObjectURL(url);
  const parts = [
    `${bundle.modules.length} modules`,
    `${bundleCount} bundles`,
    `${bundle.categories.length} categories`,
  ];
  toast.push({
    severity: "success", summary: "Exported",
    detail: parts.join(" · "),
    life: 2500,
  });
}

// ---------- Import tab state ----------

const fileInputRef = ref<HTMLInputElement | null>(null);
const dropActive = ref(false);
const dropInvalid = ref(false);
const parsing = ref(false);
const parseError = ref<string | null>(null);
const parsedBundle = ref<ImportBundle | null>(null);
const parsedFileName = ref<string>("");
const parsedFileSizeKb = ref<string>("");

const importSelected = ref<Set<string>>(new Set());
const importOpenGroups = ref<Set<GroupKey>>(new Set([
  "wildcard", "fixed_values", "combine", "derivation", "constraint", "bundle", "category",
]));

type ConflictMode = "rename" | "overwrite" | "skip";
const conflictMode = ref<ConflictMode>("rename");
const conflictModeOptions = [
  { value: "rename",    label: "Rename (keep both)" },
  { value: "overwrite", label: "Overwrite existing" },
  { value: "skip",      label: "Skip conflicting items" },
];

const importing = ref(false);

const localModulesById = computed(() => {
  const m = new Map<string, ModuleRow>();
  for (const x of localModules.value) m.set(x.id, x);
  return m;
});
const localCategoriesById = computed(() => {
  const m = new Map<string, CategoryRow>();
  for (const x of localCategories.value) m.set(x.id, x);
  return m;
});
const localBundlesById = computed(() => {
  const m = new Map<string, BundleRow>();
  for (const x of localBundles.value) m.set(x.id, x);
  return m;
});

interface ImportRow {
  id: string;
  name: string;
  group: GroupKey;
  conflict: ConflictResult;
}

const parsedRows = computed<ImportRow[]>(() => {
  const b = parsedBundle.value;
  if (!b) return [];
  const out: ImportRow[] = [];
  for (const m of b.modules ?? []) {
    out.push({
      id: m.id, name: m.name,
      group: groupForModule(m.type),
      conflict: classifyModule(m, localModulesById.value),
    });
  }
  for (const bun of b.bundles ?? []) {
    out.push({
      id: bun.id, name: bun.name,
      group: "bundle",
      conflict: classifyBundle(bun, localBundlesById.value),
    });
  }
  for (const c of b.categories ?? []) {
    out.push({
      id: c.id, name: c.name,
      group: "category",
      conflict: classifyCategory(c, localCategoriesById.value),
    });
  }
  return out;
});

function parsedRowsForGroup(g: GroupMeta): ImportRow[] {
  return parsedRows.value.filter((r) => r.group === g.key);
}

function importRowKey(group: GroupKey, id: string): string {
  return selectionKey(group, id);
}
function isImportSelected(group: GroupKey, id: string): boolean {
  return importSelected.value.has(importRowKey(group, id));
}
function toggleImportRow(group: GroupKey, id: string) {
  const k = importRowKey(group, id);
  const next = new Set(importSelected.value);
  if (next.has(k)) next.delete(k); else next.add(k);
  importSelected.value = next;
}
function setImportGroupAll(g: GroupMeta, on: boolean) {
  const next = new Set(importSelected.value);
  for (const r of parsedRowsForGroup(g)) {
    const k = importRowKey(g.key, r.id);
    if (on) next.add(k); else next.delete(k);
  }
  importSelected.value = next;
}
function importGroupCheckState(g: GroupMeta): GroupCheckState {
  const rows = parsedRowsForGroup(g);
  if (rows.length === 0) return { all: false, some: false };
  const sel = rows.filter((r) => isImportSelected(g.key, r.id)).length;
  return { all: sel === rows.length, some: sel > 0 && sel < rows.length };
}
function isImportGroupOpen(key: GroupKey): boolean {
  return importOpenGroups.value.has(key);
}
function toggleImportGroupOpen(key: GroupKey) {
  const next = new Set(importOpenGroups.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  importOpenGroups.value = next;
}

function selectAllParsed() {
  const next = new Set<string>();
  for (const r of parsedRows.value) next.add(importRowKey(r.group, r.id));
  importSelected.value = next;
}
function clearParsedSelection() {
  importSelected.value = new Set();
}

const importCounts = computed(() => selectionCounts(importSelected.value));

interface FinalActionTotals {
  willCreate: number;
  willUpdate: number;
  willSkip: number;
  conflictCount: number;
}
const finalActionTotals = computed<FinalActionTotals>(() => {
  let willCreate = 0;
  let willUpdate = 0;
  let willSkip = 0;
  let conflictCount = 0;
  for (const r of parsedRows.value) {
    const picked = isImportSelected(r.group, r.id);
    const c: ConflictKind = r.conflict.kind;
    if (c === "exists" || c === "modified") conflictCount += 1;
    if (!picked) continue;
    if (c === "new") {
      willCreate += 1;
    } else {
      if (conflictMode.value === "skip") willSkip += 1;
      else if (conflictMode.value === "overwrite") willUpdate += 1;
      else willCreate += 1;
    }
  }
  return { willCreate, willUpdate, willSkip, conflictCount };
});

function badgeClass(kind: ConflictKind): string {
  if (kind === "new") return "wp-io-badge wp-io-badge--new";
  if (kind === "modified") return "wp-io-badge wp-io-badge--mod";
  return "wp-io-badge wp-io-badge--exists";
}
function badgeLabel(kind: ConflictKind): string {
  if (kind === "new") return "new";
  if (kind === "modified") return "modified";
  return "exists";
}

/** Best-effort early-check that the dragged file is JSON-ish. The
 *  dataTransfer.items API exposes MIME type during dragover (but not
 *  the file name). Falls back to "valid" when the source doesn't
 *  announce a type so non-Chromium browsers don't reject everything. */
function dragHasJsonFile(dt: DataTransfer | null): boolean {
  if (!dt) return true;
  for (const item of dt.items) {
    if (item.kind !== "file") continue;
    if (!item.type) return true; // unknown — let it through, validated post-drop
    return /(^|\/)json$/i.test(item.type);
  }
  return true;
}

function onPickFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) handleFile(f);
}
function onDrop(e: DragEvent) {
  e.preventDefault();
  dropActive.value = false;
  dropInvalid.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (!/\.json$/i.test(f.name) && !/(^|\/)json$/i.test(f.type)) {
    parseError.value = "Only .json bundles are supported.";
    return;
  }
  handleFile(f);
}
function onDragOver(e: DragEvent) {
  e.preventDefault();
  dropActive.value = true;
  dropInvalid.value = !dragHasJsonFile(e.dataTransfer);
}
function onDragLeave() {
  dropActive.value = false;
  dropInvalid.value = false;
}

async function handleFile(file: File) {
  parseError.value = null;
  parsedBundle.value = null;
  importSelected.value = new Set();
  parsedFileName.value = file.name;
  parsedFileSizeKb.value = (file.size / 1024).toFixed(1);
  parsing.value = true;
  // Yield so the parsing UI paints before file.text() blocks the main
  // thread on a multi-MB bundle. Both reads + JSON.parse can take a
  // measurable fraction of a second on large libraries.
  await new Promise((r) => setTimeout(r, 0));
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || data.version !== 1) {
      throw new Error("Not a valid wildcard-pipeline bundle (missing version: 1).");
    }
    const bundle: ImportBundle = {
      version: 1,
      exported_at: data.exported_at,
      modules: Array.isArray(data.modules) ? data.modules : [],
      categories: Array.isArray(data.categories) ? data.categories : [],
      bundles: Array.isArray(data.bundles) ? data.bundles : [],
    };
    parsedBundle.value = bundle;
    selectAllParsed();
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : String(err);
    parsedBundle.value = null;
  } finally {
    parsing.value = false;
    if (fileInputRef.value) fileInputRef.value.value = "";
  }
}

function clearImport() {
  parsedBundle.value = null;
  parsedFileName.value = "";
  parsedFileSizeKb.value = "";
  parseError.value = null;
  importSelected.value = new Set();
}

async function runImport() {
  const b = parsedBundle.value;
  if (!b) return;

  const pickedModules: ModuleRow[] = [];
  const pickedCategories: CategoryRow[] = [];
  const pickedBundles: BundleRow[] = [];

  for (const r of parsedRows.value) {
    if (!isImportSelected(r.group, r.id)) continue;
    if (r.conflict.kind !== "new" && conflictMode.value === "skip") continue;
    if (r.group === "category") {
      const cat = b.categories.find((c) => c.id === r.id);
      if (cat) pickedCategories.push(cat);
    } else if (r.group === "bundle") {
      const bun = (b.bundles ?? []).find((x) => x.id === r.id);
      if (!bun) continue;
      // Rename strategy: stamp a fresh id + "(imported)" suffix so the
      // existing local bundle is left untouched. Overwrite mode is
      // deferred — backend currently rejects ON CONFLICT and we don't
      // ship an UPDATE path through /wp/api/import, so for now both
      // rename and overwrite use the rename-keep-both behavior.
      if (r.conflict.kind !== "new") {
        pickedBundles.push({
          ...bun,
          id: `${bun.id}${shortRand().slice(0, 4)}`.slice(0, 8),
          name: `${bun.name} (imported)`,
        });
      } else {
        pickedBundles.push(bun);
      }
    } else {
      const mod = b.modules.find((m) => m.id === r.id);
      if (!mod) continue;
      if (r.conflict.kind !== "new" && conflictMode.value === "rename") {
        pickedModules.push({
          ...mod,
          id: `${mod.id}_imp${shortRand()}`,
          name: `${mod.name} (imported)`,
        });
      } else if (r.conflict.kind !== "new" && conflictMode.value === "overwrite") {
        pickedModules.push(mod);
      } else {
        pickedModules.push(mod);
      }
    }
  }

  const partial: ImportBundle = {
    version: 1,
    exported_at: b.exported_at,
    modules: pickedModules,
    categories: pickedCategories,
    bundles: pickedBundles,
  };

  importing.value = true;
  try {
    const result = await api.importBundle(partial);
    const parts = [`${result.modules_imported} modules`];
    if (result.bundles_imported !== undefined) parts.push(`${result.bundles_imported} bundles`);
    parts.push(`${result.categories_imported} categories`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    toast.push({
      severity: "success",
      summary: "Imported",
      detail: parts.join(" · "),
      life: 4000,
    });
    clearImport();
    await loadLibrary();
  } catch (e) {
    toast.push({
      severity: "error", summary: "Import failed",
      detail: String(e), life: 5000,
    });
  } finally {
    importing.value = false;
  }
}

function shortRand(): string {
  return Math.random().toString(16).slice(2, 8);
}

function setMode(next: Mode) {
  mode.value = next;
}

// ---------- Import tab (v2 — 7-bucket parse + picker + commit) ----------
//
// Pipeline:
//   1. `ImportTab` parses a payload → emits `payload-ready`.
//   2. `ImportPicker` lets the user pick ids → emits `selection-ready`.
//   3. This view runs the collision + integrity scan:
//        - For the 5 module buckets, `detectCollisions(incoming, library)`
//          classifies each picked entity into no-collision / silent-skip
//          / conflict against the live DB.
//        - `integrityWarnings` (from parse) is converted into per-item
//          `fingerprint-mismatch` issues. Tier-3 + broken-inner-ref are
//          deferred per Item 4 spec (no production-grade detector yet).
//      Silent-skip ids are dropped from the selection (true dup → no
//      work for the server, no user-visible action).
//      If `batchConflicts.length + perItemIssues.length > 0`, the
//      ConflictModal opens. Otherwise we skip straight to commit.
//   4. On `commit-ready` (or directly when no modal opens) we build a
//      `ResolvedSelection`, call `buildCommitPayload`, POST to
//      `/wp/api/import/commit`.
//   5. On success: reload library, run `discoverBrokenRefsForImport`
//      over the just-committed wildcards + constraints, push the
//      resulting warnings into the shared `useResolveWarnings` store so
//      Wildcard / Constraint editors surface them inline. The success
//      toast carries an Undo action that calls
//      `/wp/api/import/undo` + clears the matching warnings.
//
// Strict TS: no `any`, no `as any`. Every payload row is typed as
// `Record<string, unknown> & { id: string }`; field reads use narrow
// `typeof` / property guards before treating fields as strings.

interface ImportV2State {
  /**
   * Stable per-payload id. Used as `:key` on <ImportPicker> so Vue
   * unmounts + remounts the picker on every payload swap — that resets
   * the picker's internal `seeded`/`selected` state so a stale selection
   * from a prior file (which would be an orphan id the server can't
   * find) can't leak into the Continue emit.
   */
  id: string;
  payload: RawPayload;
  migratedCount: number;
  integrityWarnings: IntegrityWarning[];
}

/** Picked entity carrying enough context to route the partitioner. */
interface SelectedEntity {
  /** Server bucket the entity routes to. */
  kind: EntityKind;
  /** Raw row from the payload. Always has `id`; other fields opaque. */
  entity: Record<string, unknown> & { id: string };
  /** Collision state. Computed at orchestrator entry from `detectCollisions`. */
  collision: "no-collision" | "silent-skip" | "conflict";
}

const importV2State = ref<ImportV2State | null>(null);
const importV2Selection = ref<Set<string> | null>(null);
const importV2Committing = ref(false);
const conflictsOpen = ref(false);
const batchConflicts = ref<BatchConflict[]>([]);
const perItemIssues = ref<PerItemIssue[]>([]);
/** Snapshot of the selection-resolution scan, stashed when the modal
 *  opens so the commit-ready callback can build a `ResolvedSelection`
 *  without recomputing collisions against a possibly-stale library. */
const pendingSelection = ref<SelectedEntity[]>([]);

const resolveWarningsStore = useResolveWarnings();

/**
 * Map from `EntityKind` discriminant to the corresponding bucket on
 * `RawPayload`. The 5 module kinds + bundle map to plural array names;
 * category → "categories". Used by `buildSelectedEntities` to walk
 * every picked id back to its source bucket. Type narrows to only the
 * array-typed fields of `RawPayload` (excludes `schema_version: number`)
 * so the row iterator is statically `Record<string, unknown>[]`.
 */
type RawPayloadArrayKey = Exclude<keyof RawPayload, "schema_version">;
const BUCKET_FOR_KIND: Record<EntityKind, RawPayloadArrayKey> = {
  bundle: "bundles",
  wildcard: "wildcards",
  fixed_values: "fixed_values",
  combine: "combines",
  derivation: "derivations",
  constraint: "constraints",
  category: "categories",
};

const ALL_KINDS: EntityKind[] = [
  "bundle", "wildcard", "fixed_values", "combine",
  "derivation", "constraint", "category",
];

/** Module kinds carry `snapshot_fingerprint` and route through the
 *  collision detector. Bundles + categories don't. */
const MODULE_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  "wildcard", "fixed_values", "combine", "derivation", "constraint",
]);

/**
 * Narrow `unknown` to `Record<string, unknown> & { id: string }`. The
 * picker filters its emit to ids that exist in the payload so this
 * guard succeeds in practice; defensive in case of stale state.
 */
function hasStringId(row: Record<string, unknown>): row is Record<string, unknown> & { id: string } {
  return typeof row.id === "string" && row.id.length > 0;
}

/** Build a `LibraryRow` map keyed by id for the collision detector.
 *  Module + bundle rows both carry an optional `snapshot_fingerprint`
 *  on the wire (added by migration 006); we lift only that field. */
function buildLibraryMap(): Map<string, LibraryRow> {
  const m = new Map<string, LibraryRow>();
  // Use unknown-cast through index signatures because ModuleRow / BundleRow
  // do not statically expose snapshot_fingerprint (added post-API typing).
  for (const row of localModules.value as unknown as Array<Record<string, unknown> & { id: string }>) {
    const fp = row.snapshot_fingerprint;
    m.set(row.id, { snapshot_fingerprint: typeof fp === "string" ? fp : undefined });
  }
  for (const row of localBundles.value as unknown as Array<Record<string, unknown> & { id: string }>) {
    const fp = row.snapshot_fingerprint;
    m.set(row.id, { snapshot_fingerprint: typeof fp === "string" ? fp : undefined });
  }
  return m;
}

/**
 * Reactive view of the same library map for `<ImportPicker>` to consume
 * via its `libraryRows` prop. Recomputes whenever the live library
 * reloads (after a successful import, after undo, on initial mount) so
 * the inline conflict badges in the picker reflect the current state of
 * the DB — not whatever was visible when the user first opened the
 * import payload.
 *
 * Bundles get a `LibraryRow` entry too (snapshot_fingerprint may be
 * undefined for them — that's fine, the picker only id-presence-checks
 * bundles for the inline badge).
 */
const libraryRowsForPicker = computed<Map<string, LibraryRow>>(() => {
  // Re-uses `buildLibraryMap` so module + bundle rows stay in lockstep
  // with the commit-time partitioner; no risk of divergent badge logic.
  return buildLibraryMap();
});

/**
 * Walk every selected id back to its source bucket and collect
 * `SelectedEntity` records. Ids that point at no bucket (defensive —
 * picker filtered to valid ids) are silently dropped. Collision state
 * runs only for module kinds; bundles + categories are always
 * treated as `no-collision` because the partitioner has no replace
 * semantic for them in this version.
 */
function buildSelectedEntities(
  payload: RawPayload,
  selection: Set<string>,
  library: Map<string, LibraryRow>,
): SelectedEntity[] {
  const result: SelectedEntity[] = [];
  // Group payload entities by id for cheap lookup.
  type Hit = { kind: EntityKind; entity: Record<string, unknown> & { id: string } };
  const idIndex = new Map<string, Hit>();
  for (const kind of ALL_KINDS) {
    const arr = payload[BUCKET_FOR_KIND[kind]];
    for (const row of arr) {
      if (!hasStringId(row)) continue;
      if (!idIndex.has(row.id)) idIndex.set(row.id, { kind, entity: row });
    }
  }
  // Pre-compute collision states once per kind for the module buckets.
  const moduleEntitiesByKind: Record<string, Array<FingerprintModuleRow & { id: string }>> = {};
  for (const id of selection) {
    const hit = idIndex.get(id);
    if (!hit) continue;
    if (!MODULE_KINDS.has(hit.kind)) continue;
    const list = moduleEntitiesByKind[hit.kind] ?? [];
    list.push(hit.entity as unknown as FingerprintModuleRow & { id: string });
    moduleEntitiesByKind[hit.kind] = list;
  }
  const collisionByKind: Record<string, Record<string, "no-collision" | "silent-skip" | "conflict">> = {};
  for (const [kind, rows] of Object.entries(moduleEntitiesByKind)) {
    collisionByKind[kind] = detectCollisions(rows, library);
  }
  for (const id of selection) {
    const hit = idIndex.get(id);
    if (!hit) continue;
    const collision = MODULE_KINDS.has(hit.kind)
      ? (collisionByKind[hit.kind]?.[id] ?? "no-collision")
      : "no-collision";
    result.push({ kind: hit.kind, entity: hit.entity, collision });
  }
  return result;
}

/** Map a payload entity's optional `name` field (always `string` when
 *  present) onto the `PerItemIssue.entity.name` slot used by the modal. */
function entityNameOf(entity: Record<string, unknown>): string | undefined {
  const n = entity.name;
  return typeof n === "string" ? n : undefined;
}

/** Convert parse-time `IntegrityWarning`s into per-item issues the
 *  modal renders + the user must resolve. Only `fingerprint-mismatch`
 *  is surfaced today (Task 21 parse pipeline emits exactly that). */
function buildPerItemIssues(
  selected: SelectedEntity[],
  integrityWarnings: IntegrityWarning[],
): PerItemIssue[] {
  const pickedIds = new Set(selected.map((s) => s.entity.id));
  const out: PerItemIssue[] = [];
  for (const w of integrityWarnings) {
    if (!w.id || !pickedIds.has(w.id)) continue;
    const hit = selected.find((s) => s.entity.id === w.id);
    if (!hit) continue;
    const name = entityNameOf(hit.entity);
    out.push({
      kind: "fingerprint-mismatch",
      entity: name ? { id: w.id, name } : { id: w.id },
      detail: { reason: w.reason, field: w.field },
    });
  }
  return out;
}

/** Build `BatchConflict[]` from module-kind entities marked `"conflict"`. */
function buildBatchConflicts(selected: SelectedEntity[]): BatchConflict[] {
  const out: BatchConflict[] = [];
  for (const s of selected) {
    if (s.collision !== "conflict") continue;
    out.push({ kind: s.kind, id: s.entity.id, entity: s.entity });
  }
  return out;
}

/**
 * Convert the user's `{batchDefault, perItemDecisions}` resolution into a
 * `ResolvedSelection` shaped for `buildCommitPayload`. The decision for
 * each entity follows these rules:
 *
 *   - `silent-skip` → never reaches the commit (excluded upstream).
 *   - Per-item issue resolved → use that decision verbatim:
 *       * `skip`    → drop
 *       * `replace` → `{kind: "replace"}`
 *       * `accept`  → `{kind: "add"}` (proceed despite the warning)
 *       * `rename`  → `{kind: "rename", new_id, new_name}`
 *   - Batch conflict resolved by `batchDefault`:
 *       * `skip`    → drop
 *       * `replace` → `{kind: "replace"}`
 *   - Everything else → `{kind: "add"}`
 *
 * Categories are routed straight to `categories` with `{kind: "add"}`
 * (the `CategoryDecision` constraint downstream rejects anything else
 * at compile time).
 */
function partitionSelection(
  selected: SelectedEntity[],
  resolution: { batchDefault: "skip" | "replace"; perItemDecisions: Record<string, PerItemDecision> },
  perItemIds: ReadonlySet<string>,
): ResolvedSelection {
  const out: ResolvedSelection = {
    bundles: [], wildcards: [], fixed_values: [], combines: [],
    derivations: [], constraints: [], categories: [],
  };
  for (const s of selected) {
    if (s.collision === "silent-skip") continue;
    let decision: Decision | null;
    if (perItemIds.has(s.entity.id)) {
      const pd = resolution.perItemDecisions[s.entity.id];
      if (!pd) {
        // Missing decision for a per-item issue means the modal closed
        // without resolving it — should not happen in normal UX since the
        // Import button stays disabled until every per-item row has a
        // decision. Log for diagnostics rather than silently dropping.
        console.warn(
          `[import-commit] no decision recorded for per-item issue ${s.entity.id}; dropping`,
        );
        decision = null;
      } else if (pd.kind === "skip") {
        decision = null;
      } else if (pd.kind === "replace") {
        decision = { kind: "replace" };
      } else if (pd.kind === "accept") {
        decision = { kind: "add" };
      } else if (pd.kind === "rename") {
        if (!pd.new_id || !pd.new_name) {
          console.warn(
            `[import-commit] rename decision for ${s.entity.id} missing new_id/new_name; dropping`,
          );
          decision = null;
        } else {
          decision = { kind: "rename", new_id: pd.new_id, new_name: pd.new_name };
        }
      } else {
        decision = null;
      }
    } else if (s.collision === "conflict") {
      decision = resolution.batchDefault === "replace"
        ? { kind: "replace" }
        : null;
    } else {
      decision = { kind: "add" };
    }
    if (!decision) continue;
    if (s.kind === "category") {
      // Type narrowing — categories only support `add`. If we somehow
      // end up here with replace/rename it's a programmer error (the
      // earlier branches don't put categories into per-item or batch
      // conflict buckets), so coerce to add and stash the warning.
      const decKind: "add" = "add";
      const entry: ResolvedCategoryEntity = { entity: s.entity, decision: { kind: decKind } };
      out.categories.push(entry);
      continue;
    }
    const entry: ResolvedEntity = { entity: s.entity, decision };
    switch (s.kind) {
      case "bundle":      out.bundles.push(entry); break;
      case "wildcard":    out.wildcards.push(entry); break;
      case "fixed_values":out.fixed_values.push(entry); break;
      case "combine":     out.combines.push(entry); break;
      case "derivation":  out.derivations.push(entry); break;
      case "constraint":  out.constraints.push(entry); break;
    }
  }
  return out;
}

/** Convenience: return the wildcards + constraints from a CommitPayload
 *  routed into the shape `discoverBrokenRefsForImport` expects. */
function extractWildcardsAndConstraints(payload: CommitPayload): {
  wildcards: ImportedWildcard[];
  constraints: ImportedConstraint[];
} {
  const wildcards: ImportedWildcard[] = [];
  const constraints: ImportedConstraint[] = [];
  const acceptRow = (kind: EntityKind, row: Record<string, unknown>) => {
    if (typeof row.id !== "string" || row.id.length === 0) return;
    if (kind === "wildcard") {
      const opts = row.options;
      wildcards.push({
        id: row.id,
        options: Array.isArray(opts)
          ? opts as Array<{ value: unknown; weight?: number }>
          : undefined,
      });
    } else if (kind === "constraint") {
      const p = row.payload;
      const payloadObj = p && typeof p === "object" ? p as Record<string, unknown> : null;
      const src = payloadObj?.source_wildcard_id;
      const tgt = payloadObj?.target_wildcard_id;
      constraints.push({
        id: row.id,
        payload: {
          source_wildcard_id: typeof src === "string" ? src : undefined,
          target_wildcard_id: typeof tgt === "string" ? tgt : undefined,
        },
      });
    }
  };
  for (const a of payload.adds) acceptRow(a.kind, a.entity);
  for (const r of payload.replaces) acceptRow(r.kind, r.new_content);
  for (const r of payload.renames) acceptRow(r.kind, r.content);
  return { wildcards, constraints };
}

/** Collect every id the commit payload will land in the library so the
 *  broken-ref walker can answer "is this referenced id present?". For
 *  renames the new id is the live-DB id post-commit. */
function commitPayloadIds(payload: CommitPayload): Set<string> {
  const ids = new Set<string>();
  for (const a of payload.adds) {
    if (typeof a.entity.id === "string") ids.add(a.entity.id);
  }
  for (const r of payload.replaces) ids.add(r.id);
  for (const r of payload.renames) ids.add(r.new_id);
  return ids;
}

function onImportV2PayloadReady(
  payload: RawPayload,
  migratedCount: number,
  integrityWarnings: IntegrityWarning[],
): void {
  // Fresh id per payload-ready call so the picker remounts (`:key` change).
  // `Date.now().toString(36)` matches the codebase's existing id pattern
  // (see useToast.ts:28, DerivationEditor.vue:134) and avoids depending on
  // `crypto.randomUUID` — not used elsewhere in this project.
  const id = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  importV2State.value = { id, payload, migratedCount, integrityWarnings };
  // Reset any prior selection / modal state when a new payload lands.
  importV2Selection.value = null;
  conflictsOpen.value = false;
  batchConflicts.value = [];
  perItemIssues.value = [];
  pendingSelection.value = [];
}

/**
 * Picker `selection-ready` handler — kicks off the commit pipeline.
 * Stashes the selection for diagnostic display, computes collisions
 * and per-item issues, and either opens the ConflictModal or commits
 * directly when no conflicts surface.
 */
async function onImportV2SelectionReady(ids: Set<string>): Promise<void> {
  const state = importV2State.value;
  if (!state) return;
  importV2Selection.value = ids;
  const library = buildLibraryMap();
  const selected = buildSelectedEntities(state.payload, ids, library);
  pendingSelection.value = selected;
  const bConflicts = buildBatchConflicts(selected);
  const issues = buildPerItemIssues(selected, state.integrityWarnings);
  batchConflicts.value = bConflicts;
  perItemIssues.value = issues;
  if (bConflicts.length > 0 || issues.length > 0) {
    conflictsOpen.value = true;
    return;
  }
  // Frictionless path — no conflicts at all → commit with all `add`s.
  await runCommit({ batchDefault: "skip", perItemDecisions: {} });
}

function onConflictCommitReady(resolution: {
  batchDefault: "skip" | "replace";
  perItemDecisions: Record<string, PerItemDecision>;
}): void {
  conflictsOpen.value = false;
  void runCommit(resolution);
}

function onConflictCancel(): void {
  // Leave selection intact so the user can re-trigger after adjusting
  // upstream state — just close the modal.
  conflictsOpen.value = false;
}

async function runCommit(resolution: {
  batchDefault: "skip" | "replace";
  perItemDecisions: Record<string, PerItemDecision>;
}): Promise<void> {
  const selected = pendingSelection.value;
  if (selected.length === 0) return;
  const perItemIds = new Set(perItemIssues.value.map((p) => p.entity.id));
  const selection = partitionSelection(selected, resolution, perItemIds);
  const payload = buildCommitPayload(selection);
  // Short-circuit if every selected entity resolved to a drop (e.g. the
  // whole selection is silent-skip duplicates or batchDefault=skip with no
  // per-item overrides). User intent ("import these") is already satisfied
  // because the library matches — skip the no-op server round-trip and
  // surface a non-success info toast so it's clear nothing was added.
  const totalOps = payload.adds.length + payload.replaces.length + payload.renames.length;
  if (totalOps === 0) {
    toast.push({
      severity: "info",
      summary: "Nothing to import",
      detail: "All selected items are duplicates of existing library entries.",
      life: 4000,
    });
    clearImportV2();
    return;
  }
  importV2Committing.value = true;
  try {
    const result = await api.importExport.commit(payload);
    // Reload library before we compute broken refs so the just-committed
    // ids land in the libraryIds set.
    await loadLibrary();
    const libraryIds = new Set<string>();
    for (const m of localModules.value) libraryIds.add(m.id);
    for (const b of localBundles.value) libraryIds.add(b.id);
    // Belt-and-suspenders — also add ids from the payload itself in
    // case the reload is still in-flight when the broken-ref walker
    // runs (loadLibrary is awaited above; this just hardens against
    // ordering edge cases).
    const committedIds = commitPayloadIds(payload);
    for (const id of committedIds) libraryIds.add(id);
    const { wildcards, constraints } = extractWildcardsAndConstraints(payload);
    // Clear stale broken_ref_on_import warnings for any entity touched by
    // this commit before pushing the fresh batch. Re-importing a wildcard
    // (or replacing it) must wipe its prior broken-ref state so the fresh
    // discovery pass decides what's still broken against the new library.
    // `clearForModule` removes ALL warnings for that module_id — broader
    // than filtering by type. Acceptable because `broken_ref_on_import`
    // is currently the only producer pushing into the store; revisit if
    // another source starts publishing per-module warnings.
    for (const id of committedIds) {
      resolveWarningsStore.clearForModule(id);
    }
    const brokenWarnings = discoverBrokenRefsForImport(wildcards, constraints, libraryIds);
    if (brokenWarnings.length > 0) {
      resolveWarningsStore.push(brokenWarnings);
    }
    const undoId = result.undo_entry_id;
    const summary = result.summary ?? {};
    const added = summary.added ?? payload.adds.length;
    const replaced = summary.replaced ?? payload.replaces.length;
    const renamed = summary.renamed ?? payload.renames.length;
    toast.push({
      severity: "success",
      summary: "Import committed",
      detail: `${added} added · ${replaced} replaced · ${renamed} renamed`,
      action: { label: "Undo", run: () => undoImport(undoId) },
      life: 8000,
    });
    importV2State.value = null;
    importV2Selection.value = null;
    pendingSelection.value = [];
    batchConflicts.value = [];
    perItemIssues.value = [];
  } catch (err) {
    const message = err instanceof ApiError
      ? `${err.status}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    toast.push({
      severity: "error",
      summary: "Import failed",
      detail: message,
      life: 5000,
    });
    // Preserve selection + state so the user can retry.
  } finally {
    importV2Committing.value = false;
  }
}

async function undoImport(undoEntryId: string): Promise<void> {
  try {
    await api.importExport.undo(undoEntryId);
    await loadLibrary();
    resolveWarningsStore.clearByType("broken_ref_on_import");
    toast.push({ severity: "info", summary: "Import undone", life: 4000 });
  } catch (err) {
    const message = err instanceof ApiError
      ? `${err.status}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    toast.push({
      severity: "error", summary: "Undo failed", detail: message, life: 5000,
    });
  }
}

function clearImportV2() {
  importV2State.value = null;
  importV2Selection.value = null;
  conflictsOpen.value = false;
  batchConflicts.value = [];
  perItemIssues.value = [];
  pendingSelection.value = [];
}

// Run seed once mount loads data.
watch(
  () => seedWatcher.value,
  () => seedExportIfReady(),
  { immediate: true },
);
</script>

<template>
  <div class="wp-page wp-io-page">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Import / Export</h1>
        <p class="wp-page__subtitle">
          Pick exactly what to ship in or out — full library, by kind, or individual modules. Workflow files are NOT handled here.
        </p>
      </div>
      <div class="wp-page__actions">
        <Button
          variant="ghost"
          icon="pi pi-refresh"
          aria-label="Refresh library"
          :disabled="refreshing"
          :class="{ 'wp-refresh-btn--spin': refreshing }"
          @click="loadLibrary"
        >Refresh</Button>
      </div>
    </div>

    <div class="wp-tabs wp-io-tabs" role="tablist" aria-label="Import / Export mode">
      <button
        type="button" role="tab" class="wp-tab"
        :data-active="mode === 'export' ? 'true' : 'false'"
        :aria-selected="mode === 'export'"
        data-test="io-tab-export"
        @click="setMode('export')"
      >
        <Icon name="pi-download" /> Export
      </button>
      <button
        type="button" role="tab" class="wp-tab"
        :data-active="mode === 'export-v2' ? 'true' : 'false'"
        :aria-selected="mode === 'export-v2'"
        data-test="io-tab-export-v2"
        @click="setMode('export-v2')"
      >
        <Icon name="pi-download" /> Export (preview)
      </button>
      <button
        type="button" role="tab" class="wp-tab"
        :data-active="mode === 'import' ? 'true' : 'false'"
        :aria-selected="mode === 'import'"
        data-test="io-tab-import"
        @click="setMode('import')"
      >
        <Icon name="pi-upload" /> Import (legacy)
      </button>
      <button
        type="button" role="tab" class="wp-tab"
        :data-active="mode === 'import-v2' ? 'true' : 'false'"
        :aria-selected="mode === 'import-v2'"
        data-test="io-tab-import-v2"
        @click="setMode('import-v2')"
      >
        <Icon name="pi-upload" /> Import (preview)
      </button>
    </div>

    <!-- Export tab (v2 — 7-bucket picker, POST /wp/api/export/build) -->
    <div
      v-if="mode === 'export-v2'"
      class="wp-io-export-v2-pane"
      data-test="io-export-v2-pane"
    >
      <ExportTab />
    </div>

    <!-- Export tab -->
    <div v-if="mode === 'export'" class="wp-io-grid" data-test="io-export-pane">
      <Card title="Pick what to export" :padding="false">
        <template #actions>
          <Button
            variant="ghost" size="sm"
            data-test="io-export-select-all"
            @click="presetApplyFull"
          >Select all</Button>
          <Button
            variant="ghost" size="sm"
            data-test="io-export-select-none"
            @click="exportSelected = new Set()"
          >None</Button>
        </template>

        <div class="wp-io-toolbar">
          <div class="wp-io-presets">
            <Button
              variant="ghost" size="sm" icon="pi-database"
              data-test="io-preset-full"
              @click="presetApplyFull"
            >Full library</Button>
            <Button
              variant="ghost" size="sm" icon="pi-sparkles"
              data-test="io-preset-wildcards"
              @click="presetApplyWildcards"
            >Wildcards only</Button>
            <Button
              variant="ghost" size="sm" icon="pi-star-fill"
              data-test="io-preset-favorites"
              @click="presetApplyFavorites"
            >Favorites only</Button>
          </div>
          <Input
            v-model="exportSearch"
            icon="pi-search"
            placeholder="Search modules to filter…"
            aria-label="Search modules"
            data-test="io-export-search"
            class="wp-io-search"
          />
        </div>

        <div class="wp-io-tree">
          <div
            v-for="g in GROUPS"
            :key="g.key"
            class="wp-io-group"
            :data-test="`io-export-group-${g.key}`"
          >
            <div class="wp-io-group__head" @click="toggleGroupOpen(g.key)">
              <span class="wp-io-group__check" @click.stop>
                <Checkbox
                  :model-value="groupCheckState(g, exportSearch).all"
                  :data-test="`io-export-group-check-${g.key}`"
                  :aria-label="`Select all ${g.label}`"
                  @update:model-value="(v: boolean) => setGroupAll(g, v, exportSearch)"
                />
              </span>
              <span
                class="wp-io-group__icon"
                :style="{ color: g.color, background: `color-mix(in oklab, ${g.color} 18%, transparent)` }"
              >
                <Icon :name="g.icon" />
              </span>
              <span class="wp-io-group__label">{{ g.label }}</span>
              <span class="wp-io-group__count">
                {{ rowsForGroup(g, exportSearch).filter((r) => isExportSelected(g, r.id)).length }}
                /
                {{ rowsForGroup(g, exportSearch).length }}
              </span>
              <span class="wp-spacer" />
              <Icon
                :name="isGroupOpen(g, exportSearch) ? 'pi-chevron-down' : 'pi-chevron-right'"
                :size="ICON_SM"
              />
            </div>
            <div v-if="isGroupOpen(g, exportSearch)" class="wp-io-group__body">
              <div
                v-for="row in rowsForGroup(g, exportSearch)"
                :key="`${g.key}:${row.id}`"
                class="wp-io-row"
                :data-test="`io-export-row-${row.id}`"
                @click="toggleExportRow(g, row.id)"
              >
                <Checkbox
                  :model-value="isExportSelected(g, row.id)"
                  @update:model-value="toggleExportRow(g, row.id)"
                  @click.stop
                />
                <span class="wp-io-row__name">{{ row.name }}</span>
                <span
                  v-if="row.category_id && categoryById.get(row.category_id)"
                  class="wp-cat-chip"
                  :style="catChipStyle(categoryById.get(row.category_id)!.color)"
                >{{ categoryById.get(row.category_id)?.name }}</span>
                <span class="wp-id">{{ row.id }}</span>
              </div>
              <div
                v-if="rowsForGroup(g, exportSearch).length === 0"
                class="wp-io-row__empty wp-dim"
              >No matches.</div>
            </div>
          </div>
        </div>
      </Card>

      <div class="wp-io-side">
        <Card title="Bundle summary">
          <dl class="wp-io-stats" data-test="io-export-summary">
            <dt>Wildcards</dt><dd>{{ exportCounts.wildcard }}</dd>
            <dt>Fixed values</dt><dd>{{ exportCounts.fixed_values }}</dd>
            <dt>Combines</dt><dd>{{ exportCounts.combine }}</dd>
            <dt>Derivations</dt><dd>{{ exportCounts.derivation }}</dd>
            <dt>Constraints</dt><dd>{{ exportCounts.constraint }}</dd>
            <dt>Bundles</dt><dd>{{ exportCounts.bundle }}</dd>
            <dt>Categories</dt><dd>{{ exportCounts.category }}</dd>
          </dl>
          <div class="wp-divider" />
          <dl class="wp-io-stats">
            <dt>Total selected</dt><dd>{{ exportCounts.total }}</dd>
            <dt>Bundle version</dt><dd>1</dd>
            <dt>Est. size</dt><dd data-test="io-export-size">{{ formatBytes(bundleBytes) }}</dd>
          </dl>
          <Button
            variant="primary"
            icon="pi-download"
            class="wp-io-download"
            :disabled="exportCounts.total === 0"
            data-test="io-export-download"
            @click="downloadBundle"
          >Download bundle</Button>
        </Card>
      </div>
    </div>

    <!-- Import tab -->
    <div v-else-if="mode === 'import'" class="wp-io-grid" data-test="io-import-pane">
      <div class="wp-io-import-main">
        <Card title="Source bundle">
          <p class="wp-io-help wp-dim">
            Drop a <code class="wp-mono">.json</code> bundle. You'll see its contents listed
            before anything is merged — pick exactly what you want.
          </p>
          <input
            ref="fileInputRef"
            type="file"
            accept="application/json,.json"
            class="wp-io-file-hidden"
            data-test="io-file-input"
            aria-label="Bundle JSON file"
            @change="onPickFile"
          />
          <div
            class="wp-io-drop"
            :data-active="dropActive ? 'true' : 'false'"
            :data-invalid="dropInvalid ? 'true' : 'false'"
            :data-parsing="parsing ? 'true' : 'false'"
            :aria-busy="parsing || undefined"
            data-test="io-dropzone"
            @click="!parsing && fileInputRef?.click()"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
            <Icon
              v-if="parsing"
              name="spin pi-spinner"
              :size="22"
            />
            <Icon
              v-else-if="dropInvalid"
              name="pi-times-circle"
              :size="22"
            />
            <Icon
              v-else
              name="pi-cloud-upload"
              :size="22"
            />
            <div class="wp-io-drop__title">
              <template v-if="parsing">Parsing {{ parsedFileName }}…</template>
              <template v-else-if="dropInvalid">Only .json files accepted</template>
              <template v-else>{{ parsedFileName || "Drop a .json file or click to browse" }}</template>
            </div>
            <div class="wp-io-drop__hint wp-dim">
              <template v-if="parsing">Reading {{ parsedFileSizeKb }} KB</template>
              <template v-else-if="parsedFileName">{{ parsedFileSizeKb }} KB · click to replace</template>
              <template v-else>Up to 10 MB</template>
            </div>
          </div>
          <div v-if="parseError" class="wp-io-error" data-test="io-parse-error">
            <Icon name="pi-exclamation-triangle" /> {{ parseError }}
          </div>
        </Card>

        <Card v-if="parsedBundle" title="Pick what to import" :padding="false">
          <template #actions>
            <Button
              variant="ghost" size="sm"
              data-test="io-import-select-all"
              @click="selectAllParsed"
            >Select all</Button>
            <Button
              variant="ghost" size="sm"
              data-test="io-import-select-none"
              @click="clearParsedSelection"
            >None</Button>
          </template>
          <div class="wp-io-tree">
            <template v-for="g in GROUPS" :key="g.key">
              <div
                v-if="parsedRowsForGroup(g).length > 0"
                class="wp-io-group"
                :data-test="`io-import-group-${g.key}`"
              >
                <div class="wp-io-group__head" @click="toggleImportGroupOpen(g.key)">
                  <span class="wp-io-group__check" @click.stop>
                    <Checkbox
                      :model-value="importGroupCheckState(g).all"
                      :data-test="`io-import-group-check-${g.key}`"
                      :aria-label="`Select all ${g.label}`"
                      @update:model-value="(v: boolean) => setImportGroupAll(g, v)"
                    />
                  </span>
                  <span
                    class="wp-io-group__icon"
                    :style="{ color: g.color, background: `color-mix(in oklab, ${g.color} 18%, transparent)` }"
                  >
                    <Icon :name="g.icon" />
                  </span>
                  <span class="wp-io-group__label">{{ g.label }}</span>
                  <span class="wp-io-group__count">{{ parsedRowsForGroup(g).length }} in bundle</span>
                  <span class="wp-spacer" />
                  <Icon
                    :name="isImportGroupOpen(g.key) ? 'pi-chevron-down' : 'pi-chevron-right'"
                    :size="ICON_SM"
                  />
                </div>
                <div v-if="isImportGroupOpen(g.key)" class="wp-io-group__body">
                  <div
                    v-for="row in parsedRowsForGroup(g)"
                    :key="`${row.group}:${row.id}`"
                    class="wp-io-row"
                    :data-test="`io-import-row-${row.id}`"
                    @click="toggleImportRow(row.group, row.id)"
                  >
                    <Checkbox
                      :model-value="isImportSelected(row.group, row.id)"
                      @update:model-value="toggleImportRow(row.group, row.id)"
                      @click.stop
                    />
                    <span class="wp-io-row__name">{{ row.name }}</span>
                    <span
                      :class="badgeClass(row.conflict.kind)"
                      :data-test="`io-import-badge-${row.id}`"
                    >{{ badgeLabel(row.conflict.kind) }}</span>
                    <span
                      v-if="row.conflict.existingId"
                      class="wp-id"
                      :title="`Existing local id: ${row.conflict.existingId}`"
                    >{{ row.conflict.existingId }}</span>
                    <span v-else class="wp-id">{{ row.id }}</span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </Card>
      </div>

      <div v-if="parsedBundle" class="wp-io-side">
        <Card title="Import summary">
          <dl class="wp-io-stats" data-test="io-import-summary">
            <dt>In bundle</dt><dd>{{ parsedRows.length }}</dd>
            <dt>Selected</dt><dd>{{ importCounts.total }}</dd>
            <dt>Conflicts</dt>
            <dd :class="finalActionTotals.conflictCount ? 'wp-io-warn' : ''">
              {{ finalActionTotals.conflictCount }}
            </dd>
          </dl>
          <div class="wp-divider" />

          <Field label="On conflict">
            <Select
              v-model="conflictMode"
              :options="conflictModeOptions"
              aria-label="On conflict"
              data-test="io-conflict-mode"
            />
          </Field>

          <div class="wp-divider" />
          <dl class="wp-io-stats">
            <dt>Will create</dt><dd>{{ finalActionTotals.willCreate }}</dd>
            <dt>Will update</dt><dd>{{ finalActionTotals.willUpdate }}</dd>
            <dt>Will skip</dt><dd>{{ finalActionTotals.willSkip }}</dd>
          </dl>

          <div class="wp-io-actions">
            <Button
              variant="primary"
              icon="pi-check"
              :disabled="importCounts.total === 0 || importing"
              :loading="importing"
              data-test="io-import-submit"
              @click="runImport"
            >Import {{ importCounts.total }} selected</Button>
            <Button
              variant="ghost"
              icon="pi-times"
              data-test="io-import-cancel"
              @click="clearImport"
            >Cancel</Button>
          </div>
        </Card>
      </div>
    </div>

    <!-- Import tab (v2 — 7-bucket parse + picker + commit orchestrator) -->
    <div
      v-else-if="mode === 'import-v2'"
      class="wp-io-import-v2-pane"
      data-test="io-import-v2-pane"
    >
      <ImportTab @payload-ready="onImportV2PayloadReady" />
      <ImportPicker
        v-if="importV2State"
        :key="importV2State.id"
        :payload="importV2State.payload"
        :migrated-entity-count="importV2State.migratedCount"
        :integrity-warnings="importV2State.integrityWarnings"
        :library-rows="libraryRowsForPicker"
        data-test="io-import-v2-picker"
        @selection-ready="onImportV2SelectionReady"
      />
      <div
        v-if="importV2Selection && !conflictsOpen"
        class="wp-io-import-v2-stash"
        data-test="io-import-v2-stash"
      >
        <p class="wp-io-import-v2-stash__line">
          <template v-if="importV2Committing">
            Committing {{ importV2Selection.size }}
            {{ importV2Selection.size === 1 ? "entity" : "entities" }}…
          </template>
          <template v-else>
            {{ importV2Selection.size }}
            {{ importV2Selection.size === 1 ? "entity" : "entities" }} picked.
          </template>
        </p>
        <Button
          variant="ghost" size="sm" icon="pi-times"
          data-test="io-import-v2-clear"
          :disabled="importV2Committing"
          @click="clearImportV2"
        >Clear</Button>
      </div>
      <ConflictModal
        v-if="conflictsOpen"
        :batch-conflicts="batchConflicts"
        :per-item-issues="perItemIssues"
        @commit-ready="onConflictCommitReady"
        @cancel="onConflictCancel"
      />
    </div>
  </div>
</template>

<style scoped>
.wp-io-page {
  padding: 18px 22px 40px; /* audit-exempt: 18/22/40 are page-frame insets matching the TestRunner layout; not on the 4px grid */
  max-width: 1200px;
  margin: 0 auto;
}

.wp-io-tabs { gap: var(--wp-space-2); margin-bottom: var(--wp-space-2); }

.wp-io-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--wp-space-6);
  align-items: start;
}
@media (max-width: 960px) {
  .wp-io-grid { grid-template-columns: 1fr; }
}

.wp-io-toolbar {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  padding: var(--wp-space-5);
  border-bottom: 1px solid var(--wp-border);
}
.wp-io-presets {
  display: flex;
  gap: var(--wp-space-3);
  flex-wrap: wrap;
}
.wp-io-search { width: 100%; }

.wp-io-tree { max-height: 540px; overflow-y: auto; }
.wp-io-group { border-bottom: 1px solid var(--wp-border); }
.wp-io-group:last-child { border-bottom: 0; }

.wp-io-group__head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-5);
  padding: 9px var(--wp-space-5); /* audit-exempt: 9px vertical hairline keeps row compact */
  background: var(--wp-bg-2);
  cursor: pointer;
  user-select: none;
}
.wp-io-group__head:hover { background: var(--wp-bg-3); }

.wp-io-group__check { display: inline-flex; }
.wp-io-group__icon {
  width: 22px; height: 22px;
  border-radius: var(--wp-radius-sm);
  display: grid; place-items: center;
  font-size: var(--wp-text-xs);
}
.wp-io-group__label { font-weight: 500; font-size: var(--wp-text-base); }
.wp-io-group__count {
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
  font-family: var(--wp-font-mono);
}

.wp-io-row {
  display: flex;
  align-items: center;
  gap: var(--wp-space-5);
  padding: 7px var(--wp-space-5) 7px 36px; /* audit-exempt: 7px/36px match group-head vertical rhythm */
  border-top: 1px solid var(--wp-border);
  cursor: pointer;
  font-size: var(--wp-text-sm);
}
.wp-io-row:hover { background: var(--wp-bg-2); }
.wp-io-row__name { flex: 1; font-weight: 500; }
.wp-io-row__empty {
  padding: var(--wp-space-5) var(--wp-space-5) var(--wp-space-5) 36px; /* audit-exempt: 36px indent matches row indent */
  font-size: var(--wp-text-sm);
}

.wp-io-side {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  position: sticky;
  top: 0;
}

.wp-io-stats {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: var(--wp-space-3);
  margin: 0;
  font-size: var(--wp-text-sm);
}
.wp-io-stats dt { color: var(--wp-text-muted); }
.wp-io-stats dd {
  margin: 0;
  font-family: var(--wp-font-mono);
  text-align: right;
}
.wp-io-warn { color: var(--wp-warn); }
.wp-io-download { width: 100%; margin-top: var(--wp-space-5); }

.wp-io-import-main {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
}

.wp-io-help {
  font-size: var(--wp-text-sm);
  margin: 0 0 var(--wp-space-4);
}
.wp-io-help code {
  background: var(--wp-bg-3);
  padding: 1px var(--wp-space-3);
  border-radius: var(--wp-radius-sm);
  font-size: var(--wp-text-sm);
}

.wp-io-file-hidden { display: none; }

.wp-io-drop {
  border: 1px dashed var(--wp-border-strong);
  border-radius: var(--wp-radius-lg);
  padding: var(--wp-space-7) var(--wp-space-6);
  text-align: center;
  cursor: pointer;
  background: var(--wp-bg-2);
  transition: background .15s, border-color .15s;
  color: var(--wp-text-muted);
}
.wp-io-drop[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 10%, transparent);
  border-color: var(--wp-accent-500);
}
.wp-io-drop[data-invalid="true"] {
  background: color-mix(in oklab, var(--wp-danger) 12%, transparent);
  border-color: var(--wp-danger);
  color: var(--wp-danger);
  cursor: not-allowed;
}
.wp-io-drop[data-parsing="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 6%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 40%, transparent);
  border-style: solid;
  cursor: progress;
}
.wp-io-drop__title {
  font-size: var(--wp-text-base);
  color: var(--wp-text);
  margin-top: var(--wp-space-3);
}
.wp-io-drop__hint {
  font-size: var(--wp-text-xs);
  margin-top: var(--wp-space-2);
}

.wp-io-error {
  margin-top: var(--wp-space-5);
  padding: var(--wp-space-4) var(--wp-space-5);
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-danger) 12%, transparent);
  color: var(--wp-danger);
  font-size: var(--wp-text-sm);
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
}

/* Pill chrome shared by the three import-conflict badges. Border + bg
 * triple matches the SPA `.wp-chip--*` family (token@14% bg + token@36%
 * border) so badges, chips, and ContextWidget mod-dots all encode hue
 * meaning the same way across the app. */
.wp-io-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--wp-space-4);
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: var(--wp-text-xs);
  font-weight: 500;
  text-transform: lowercase;
}
.wp-io-badge--new {
  background:   color-mix(in oklab, var(--wp-success) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-success) 36%, transparent);
  color:        var(--wp-success);
}
.wp-io-badge--exists {
  background:   color-mix(in oklab, var(--wp-warn) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-warn) 36%, transparent);
  color:        var(--wp-warn);
}
.wp-io-badge--mod {
  background:   color-mix(in oklab, var(--wp-status-modified) 14%, transparent);
  border-color: color-mix(in oklab, var(--wp-status-modified) 36%, transparent);
  color:        var(--wp-status-modified);
}

.wp-io-actions {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
  margin-top: var(--wp-space-5);
}

.wp-io-import-v2-pane {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
}
.wp-io-import-v2-stash {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wp-space-5);
  padding: var(--wp-space-5);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  font-size: var(--wp-text-sm);
}
.wp-io-import-v2-stash__line {
  margin: 0;
  color: var(--wp-text-muted);
}
</style>
