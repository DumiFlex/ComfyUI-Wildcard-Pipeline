<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "../components/ui/Button.vue";
import Icon from "../components/ui/Icon.vue";
import { useToast } from "../composables/useToast";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";
import { api, ApiError } from "../api/client";
import ExportTab from "../import-export/ExportTab.vue";
import ImportTab from "../import-export/ImportTab.vue";
import ImportPicker from "../import-export/ImportPicker.vue";
import ConflictModal from "../import-export/ConflictModal.vue";
import {
  detectCollisions,
  detectTemplateCollisions,
  type CollisionState,
  type LibraryRow,
} from "../import-export/collision";
import { templateFingerprint } from "../import-export/fingerprint";
import {
  buildCommitPayload,
  type CommitPayload,
  type Decision,
  type EntityKind,
  type ResolvedEntity,
  type ResolvedCategoryEntity,
  type ResolvedSelection,
} from "../import-export/commit";
import { applyImportRemap, buildImportRemapTable } from "../import-export/import-remap";
import {
  discoverBrokenRefsForImport,
  type ImportedConstraint,
  type ImportedWildcard,
} from "../import-export/broken-refs";
import { buildDepGraph } from "../import-export/dep-graph";
import type {
  BatchConflict,
  PerItemDecision,
  PerItemIssue,
} from "../import-export/conflict-types";
import type {
  ModuleRow as FingerprintModuleRow,
  TemplateRow as FingerprintTemplateRow,
} from "../import-export/fingerprint";
import type { RawPayload } from "../import-export/migrations";
import type { IntegrityWarning } from "../import-export/parse";
import { newShortId } from "../utils/ids";

type Mode = "export" | "import";

const toast = useToast();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const templateStore = useTemplateStore();
const categoryStore = useCategoryStore();

const mode = ref<Mode>("export");

// ---------- Source library state (fetched once on mount) ----------
// Powers the collision detector + broken-ref walker. Modules + bundles
// drive the snapshot_fingerprint collision path; templates drive the
// separate templateFingerprint path. Categories aren't fetched here —
// they merge by name server-side and never produce a collision badge.

interface LibraryModule { id: string; type?: string; snapshot_fingerprint?: string }
interface LibraryBundle { id: string; snapshot_fingerprint?: string }
/** Templates carry no snapshot_fingerprint; the orchestrator computes a
 *  `templateFingerprint` from these literal fields for collision detection. */
interface LibraryTemplate {
  id: string;
  name: string;
  description: string;
  category_id: string | null;
  tags: string[];
  is_favorite: boolean;
  template_string: string;
}

const localModules = ref<LibraryModule[]>([]);
const localBundles = ref<LibraryBundle[]>([]);
const localTemplates = ref<LibraryTemplate[]>([]);

const refreshing = ref(false);

async function loadLibrary() {
  refreshing.value = true;
  try {
    const [mods, buns, tmpls] = await Promise.all([
      api.modules.list({ limit: 1000 }),
      api.bundles.list({ limit: 1000 }),
      api.templates.list({ limit: 1000 }),
    ]);
    localModules.value = mods.items as unknown as LibraryModule[];
    localBundles.value = buns.items as unknown as LibraryBundle[];
    localTemplates.value = tmpls.items;
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

// Template ref to the Export tab so the shared Refresh button can also
// reload ITS listing. ExportTab maintains its own library refs (the
// export picker renders from them), which the parent loadLibrary above
// never touches — without this the export listing stayed stale after
// adds/removes until a full tab remount.
const exportTabRef = ref<InstanceType<typeof ExportTab> | null>(null);

/** Refresh both sides: the parent import/collision snapshot AND the
 *  Export tab's own listing (null-safe — ExportTab is only mounted in
 *  export mode). */
async function onRefresh() {
  await loadLibrary();
  await exportTabRef.value?.loadLibrary?.();
}

function setMode(next: Mode) {
  mode.value = next;
}

// ---------- Import tab — 7-bucket parse + picker + commit ----------
//
// Pipeline:
//   1. `ImportTab` parses a payload → emits `payload-ready`.
//   2. `ImportPicker` lets the user pick ids → emits `selection-ready`.
//   3. This view runs the collision + integrity scan:
//        - For the 5 module buckets, `detectCollisions(incoming, library)`
//          classifies each picked entity into no-collision / silent-skip
//          / conflict against the live DB.
//        - `integrityWarnings` (from parse) is converted into per-item
//          `fingerprint-mismatch` issues.
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

interface ImportState {
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
  kind: EntityKind;
  entity: Record<string, unknown> & { id: string };
  collision: CollisionState;
}

const importState = ref<ImportState | null>(null);
const importSelection = ref<Set<string> | null>(null);
const importCommitting = ref(false);
const conflictsOpen = ref(false);
const batchConflicts = ref<BatchConflict[]>([]);
const perItemIssues = ref<PerItemIssue[]>([]);
const pendingSelection = ref<SelectedEntity[]>([]);

const resolveWarningsStore = useResolveWarnings();

type RawPayloadArrayKey = Exclude<keyof RawPayload, "schema_version">;
const BUCKET_FOR_KIND: Record<EntityKind, RawPayloadArrayKey> = {
  bundle: "bundles",
  wildcard: "wildcards",
  fixed_values: "fixed_values",
  combine: "combines",
  derivation: "derivations",
  constraint: "constraints",
  category: "categories",
  template: "templates",
};

const ALL_KINDS: EntityKind[] = [
  "bundle", "wildcard", "fixed_values", "combine",
  "derivation", "constraint", "category", "template",
];

/** Module kinds carry `snapshot_fingerprint` and route through the
 *  collision detector. Bundles + categories don't. */
const MODULE_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  "wildcard", "fixed_values", "combine", "derivation", "constraint",
]);

function hasStringId(row: Record<string, unknown>): row is Record<string, unknown> & { id: string } {
  return typeof row.id === "string" && row.id.length > 0;
}

/** Build a `LibraryRow` map keyed by id for the collision detector. */
function buildLibraryMap(): Map<string, LibraryRow> {
  const m = new Map<string, LibraryRow>();
  for (const row of localModules.value) {
    m.set(row.id, { type: row.type, snapshot_fingerprint: row.snapshot_fingerprint });
  }
  for (const row of localBundles.value) {
    m.set(row.id, { snapshot_fingerprint: row.snapshot_fingerprint });
  }
  for (const row of localTemplates.value) {
    // Templates have no server snapshot_fingerprint; stamp a computed
    // templateFingerprint so detectTemplateCollisions can prove drift.
    m.set(row.id, { template_fingerprint: templateFingerprint(row) });
  }
  return m;
}

/** Reactive view for `<ImportPicker>` so inline badges reflect live DB. */
const libraryRowsForPicker = computed<Map<string, LibraryRow>>(() => buildLibraryMap());

function buildSelectedEntities(
  payload: RawPayload,
  selection: Set<string>,
  library: Map<string, LibraryRow>,
): SelectedEntity[] {
  const result: SelectedEntity[] = [];
  type Hit = { kind: EntityKind; entity: Record<string, unknown> & { id: string } };
  const idIndex = new Map<string, Hit>();
  for (const kind of ALL_KINDS) {
    const arr = payload[BUCKET_FOR_KIND[kind]];
    for (const row of arr) {
      if (!hasStringId(row)) continue;
      if (!idIndex.has(row.id)) idIndex.set(row.id, { kind, entity: row });
    }
  }
  const moduleEntitiesByKind: Record<string, Array<FingerprintModuleRow & { id: string }>> = {};
  for (const id of selection) {
    const hit = idIndex.get(id);
    if (!hit) continue;
    if (!MODULE_KINDS.has(hit.kind)) continue;
    const list = moduleEntitiesByKind[hit.kind] ?? [];
    list.push(hit.entity as unknown as FingerprintModuleRow & { id: string });
    moduleEntitiesByKind[hit.kind] = list;
  }
  const collisionByKind: Record<string, Record<string, SelectedEntity["collision"]>> = {};
  for (const [kind, rows] of Object.entries(moduleEntitiesByKind)) {
    collisionByKind[kind] = detectCollisions(rows, library);
  }
  // Templates run a separate collision pass — they compare a
  // `templateFingerprint` (computed on both sides) instead of the module
  // `snapshot_fingerprint`, so they can't go through `detectCollisions`.
  const templateRows: Array<FingerprintTemplateRow & { id: string }> = [];
  for (const id of selection) {
    const hit = idIndex.get(id);
    if (!hit || hit.kind !== "template") continue;
    templateRows.push(hit.entity as unknown as FingerprintTemplateRow & { id: string });
  }
  const templateColl: Record<string, SelectedEntity["collision"]> =
    templateRows.length > 0 ? detectTemplateCollisions(templateRows, library) : {};
  // Bundles were historically excluded from collision detection (deferred to
  // a `bundle-fingerprint.ts` MOD-detection flow that was never built), so an
  // existing bundle fell through to a blind `add` decision — the server then
  // 400'd the whole commit with "id collision on add" and the bundles never
  // imported. Bundles live in the same id→fingerprint library map as modules
  // (buildLibraryMap), so route them through the SAME detector: identical →
  // silent-skip, present-but-changed / no library fingerprint → conflict /
  // exists-unknown, both of which surface in the conflict modal for the user
  // to Replace / Rename / Skip, exactly like a colliding module.
  const bundleRows: Array<FingerprintModuleRow & { id: string }> = [];
  for (const id of selection) {
    const hit = idIndex.get(id);
    if (!hit || hit.kind !== "bundle") continue;
    bundleRows.push(hit.entity as unknown as FingerprintModuleRow & { id: string });
  }
  const bundleColl: Record<string, SelectedEntity["collision"]> =
    bundleRows.length > 0 ? detectCollisions(bundleRows, library) : {};
  for (const id of selection) {
    const hit = idIndex.get(id);
    if (!hit) continue;
    let collision: SelectedEntity["collision"];
    if (hit.kind === "template") {
      collision = templateColl[id] ?? "no-collision";
    } else if (MODULE_KINDS.has(hit.kind)) {
      collision = collisionByKind[hit.kind]?.[id] ?? "no-collision";
    } else if (hit.kind === "bundle") {
      collision = bundleColl[id] ?? "no-collision";
    } else {
      // Categories merge by name server-side — no id collision concept.
      collision = "no-collision";
    }
    result.push({ kind: hit.kind, entity: hit.entity, collision });
  }
  return result;
}

function entityNameOf(entity: Record<string, unknown>): string | undefined {
  const n = entity.name;
  return typeof n === "string" ? n : undefined;
}

function buildPerItemIssues(
  selected: SelectedEntity[],
  integrityWarnings: IntegrityWarning[],
  payload: RawPayload,
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
  const payloadIds = new Set<string>();
  for (const k of ALL_KINDS) {
    const arr = payload[BUCKET_FOR_KIND[k]];
    for (const row of arr) {
      if (typeof row.id === "string" && row.id.length > 0) payloadIds.add(row.id);
    }
  }
  const payloadNameById = new Map<string, string>();
  for (const k of ALL_KINDS) {
    const arr = payload[BUCKET_FOR_KIND[k]];
    for (const row of arr) {
      const id = typeof row.id === "string" ? row.id : null;
      const rawName = (row as { name?: unknown }).name;
      if (id && typeof rawName === "string" && rawName.length > 0) {
        payloadNameById.set(id, rawName);
      }
    }
  }
  const graph = buildDepGraph(payload);
  type Bucket = { targets: Array<{ id: string; name?: string }> };
  const brokenBucket = new Map<string, Bucket>();
  const unselectedBucket = new Map<string, Bucket>();
  const kindBySource = new Map<string, string>();
  const nameBySource = new Map<string, string | undefined>();
  for (const s of selected) {
    const edges = graph[s.entity.id] ?? [];
    if (edges.length === 0) continue;
    kindBySource.set(s.entity.id, s.kind);
    nameBySource.set(s.entity.id, entityNameOf(s.entity));
    for (const target of edges) {
      if (!payloadIds.has(target)) {
        const bucket = brokenBucket.get(s.entity.id) ?? { targets: [] };
        bucket.targets.push({ id: target });
        brokenBucket.set(s.entity.id, bucket);
      } else if (!pickedIds.has(target)) {
        const bucket = unselectedBucket.get(s.entity.id) ?? { targets: [] };
        const targetName = payloadNameById.get(target);
        bucket.targets.push(
          targetName !== undefined
            ? { id: target, name: targetName }
            : { id: target },
        );
        unselectedBucket.set(s.entity.id, bucket);
      }
    }
  }
  for (const [sourceId, bucket] of brokenBucket) {
    const name = nameBySource.get(sourceId);
    const kind = kindBySource.get(sourceId) ?? "bundle";
    out.push({
      kind: "broken-inner-ref",
      entity: {
        id: sourceId,
        ...(name !== undefined ? { name } : {}),
        kind,
      },
      detail: {
        target: bucket.targets[0]!.id,
        targets: bucket.targets,
      },
    });
  }
  for (const [sourceId, bucket] of unselectedBucket) {
    const name = nameBySource.get(sourceId);
    const kind = kindBySource.get(sourceId) ?? "bundle";
    const first = bucket.targets[0]!;
    out.push({
      kind: "unselected-dep",
      entity: {
        id: sourceId,
        ...(name !== undefined ? { name } : {}),
        kind,
      },
      detail: {
        target: first.id,
        target_name: first.name,
        targets: bucket.targets,
      },
    });
  }
  return out;
}

function buildBatchConflicts(selected: SelectedEntity[]): BatchConflict[] {
  const out: BatchConflict[] = [];
  for (const s of selected) {
    if (
      s.collision !== "conflict"
      && s.collision !== "exists-unknown"
      && s.collision !== "silent-skip"
      && s.collision !== "type-conflict"
    ) continue;
    out.push({
      kind: s.kind,
      id: s.entity.id,
      entity: s.entity,
      collisionState: s.collision,
    });
  }
  return out;
}

function mintRenameDecision(
  entity: Record<string, unknown> & { id: string },
): Decision {
  const raw = entity.name;
  const base = typeof raw === "string" && raw.length > 0 ? raw : entity.id;
  return { kind: "rename", new_id: newShortId(), new_name: `${base} (imported)` };
}

function partitionSelection(
  selected: SelectedEntity[],
  resolution: {
    batchDefault: "skip" | "replace" | "rename";
    perItemDecisions: Record<string, PerItemDecision>;
  },
  perItemIds: ReadonlySet<string>,
): ResolvedSelection {
  const out: ResolvedSelection = {
    bundles: [], wildcards: [], fixed_values: [], combines: [],
    derivations: [], constraints: [], categories: [], templates: [],
  };
  for (const s of selected) {
    if (s.collision === "silent-skip"
        && !resolution.perItemDecisions[s.entity.id]) {
      continue;
    }
    let decision: Decision | null;
    const pd = resolution.perItemDecisions[s.entity.id];
    if (pd) {
      if (pd.kind === "skip") {
        decision = null;
      } else if (pd.kind === "replace") {
        // A cross-kind id clash can never replace (would clobber a
        // different-kind live row) — coerce to install-as-new.
        decision = s.collision === "type-conflict"
          ? mintRenameDecision(s.entity)
          : { kind: "replace" };
      } else if (pd.kind === "accept") {
        if (s.collision === "type-conflict") {
          decision = mintRenameDecision(s.entity); // install-as-new; never clobber
        } else if (
          s.collision === "conflict"
          || s.collision === "exists-unknown"
          || s.collision === "silent-skip"
        ) {
          decision = { kind: "replace" };
        } else {
          decision = { kind: "add" };
        }
      } else if (pd.kind === "rename") {
        if (pd.new_id && pd.new_name) {
          decision = { kind: "rename", new_id: pd.new_id, new_name: pd.new_name };
        } else {
          decision = mintRenameDecision(s.entity);
        }
      } else {
        decision = null;
      }
    } else if (perItemIds.has(s.entity.id)) {
      console.warn(
        `[import-commit] no decision recorded for per-item issue ${s.entity.id}; dropping`,
      );
      decision = null;
    } else if (s.collision === "type-conflict") {
      // Clash batch default: install-as-new (or skip). Never replace/add —
      // both would clobber or hard-fail against the different-kind live row.
      decision = resolution.batchDefault === "skip" ? null : mintRenameDecision(s.entity);
    } else if (s.collision === "conflict" || s.collision === "exists-unknown") {
      if (resolution.batchDefault === "replace") {
        decision = { kind: "replace" };
      } else if (resolution.batchDefault === "rename") {
        decision = mintRenameDecision(s.entity);
      } else {
        decision = null;
      }
    } else {
      decision = { kind: "add" };
    }
    if (!decision) continue;
    if (s.kind === "category") {
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
      case "template":    out.templates.push(entry); break;
    }
  }
  return out;
}

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

function commitPayloadIds(payload: CommitPayload): Set<string> {
  const ids = new Set<string>();
  for (const a of payload.adds) {
    if (typeof a.entity.id === "string") ids.add(a.entity.id);
  }
  for (const r of payload.replaces) ids.add(r.id);
  for (const r of payload.renames) ids.add(r.new_id);
  return ids;
}

function onImportPayloadReady(
  payload: RawPayload,
  migratedCount: number,
  integrityWarnings: IntegrityWarning[],
): void {
  const id = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  importState.value = { id, payload, migratedCount, integrityWarnings };
  importSelection.value = null;
  conflictsOpen.value = false;
  batchConflicts.value = [];
  perItemIssues.value = [];
  pendingSelection.value = [];
}

async function onImportSelectionReady(ids: Set<string>): Promise<void> {
  const state = importState.value;
  if (!state) return;
  importSelection.value = ids;
  const library = buildLibraryMap();
  const selected = buildSelectedEntities(state.payload, ids, library);
  pendingSelection.value = selected;
  const issues = buildPerItemIssues(selected, state.integrityWarnings, state.payload);
  const issueIds = new Set(issues.map((i) => i.entity.id));
  const bConflicts = buildBatchConflicts(selected).filter(
    (c) => !issueIds.has(c.id),
  );
  batchConflicts.value = bConflicts;
  perItemIssues.value = issues;
  if (bConflicts.length > 0 || issues.length > 0) {
    conflictsOpen.value = true;
    return;
  }
  await runCommit({ batchDefault: "skip", perItemDecisions: {} });
}

function onConflictCommitReady(resolution: {
  batchDefault: "skip" | "replace" | "rename";
  perItemDecisions: Record<string, PerItemDecision>;
}): void {
  conflictsOpen.value = false;
  void runCommit(resolution);
}

function onConflictCancel(): void {
  conflictsOpen.value = false;
}

function onConflictIncludeDeps(targetIds: string[]): void {
  conflictsOpen.value = false;
  const next = new Set<string>(importSelection.value);
  for (const id of targetIds) next.add(id);
  void onImportSelectionReady(next);
}

async function runCommit(resolution: {
  batchDefault: "skip" | "replace" | "rename";
  perItemDecisions: Record<string, PerItemDecision>;
}): Promise<void> {
  const selected = pendingSelection.value;
  if (selected.length === 0) return;
  const perItemIds = new Set(perItemIssues.value.map((p) => p.entity.id));
  const selection = partitionSelection(selected, resolution, perItemIds);
  const payload = buildCommitPayload(selection);
  // Friend→local follow-through: install-as-new mints fresh local ids; any
  // imported constraint pointing at a renamed entity (source/target or an
  // embedded @{} ref) must follow. One walkRemap pass over the committed
  // entities, keyed by the renames the user's collision resolutions produced.
  const remapTable = buildImportRemapTable(
    payload.renames.map((r) => ({ oldId: r.old_id, newId: r.new_id })),
  );
  if (Object.keys(remapTable).length > 0) {
    payload.adds = applyImportRemap(payload.adds.map((a) => a.entity), remapTable)
      .map((entity, i) => ({ ...payload.adds[i], entity }));
    payload.replaces = applyImportRemap(payload.replaces.map((r) => r.new_content), remapTable)
      .map((new_content, i) => ({ ...payload.replaces[i], new_content }));
    payload.renames = applyImportRemap(payload.renames.map((r) => r.content), remapTable)
      .map((content, i) => ({ ...payload.renames[i], content }));
  }
  const totalOps = payload.adds.length + payload.replaces.length + payload.renames.length;
  if (totalOps === 0) {
    toast.push({
      severity: "info",
      summary: "Nothing to import",
      detail: "All selected items are duplicates of existing library entries.",
      life: 4000,
    });
    clearImport();
    return;
  }
  importCommitting.value = true;
  try {
    const result = await api.importExport.commit(payload);
    // Refresh the local library snapshot (powers the broken-ref walker
    // below) AND the global Pinia catalogs (sidebar count badges +
    // Cmd+K palette + other views' module/bundle lists). Without the
    // catalog refresh the sidebar's "Wildcards 18" stays stale until
    // the next route change forces a re-fetch.
    await Promise.all([
      loadLibrary(),
      moduleStore.fetchCatalog(),
      bundleStore.fetchCatalog(),
      // Templates + categories drive their own sidebar count badges; refresh
      // them too so the counts update live after an import/undo (#7) — an
      // import that adds templates or categories used to leave a stale count
      // until the next route change forced a re-fetch.
      templateStore.fetchCatalog(),
      categoryStore.fetchAll(),
    ]);
    const libraryIds = new Set<string>();
    for (const m of localModules.value) libraryIds.add(m.id);
    for (const b of localBundles.value) libraryIds.add(b.id);
    const committedIds = commitPayloadIds(payload);
    for (const id of committedIds) libraryIds.add(id);
    const { wildcards, constraints } = extractWildcardsAndConstraints(payload);
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
    importState.value = null;
    importSelection.value = null;
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
  } finally {
    importCommitting.value = false;
  }
}

async function undoImport(undoEntryId: string): Promise<void> {
  try {
    await api.importExport.undo(undoEntryId);
    await Promise.all([
      loadLibrary(),
      moduleStore.fetchCatalog(),
      bundleStore.fetchCatalog(),
      // Templates + categories drive their own sidebar count badges; refresh
      // them too so the counts update live after an import/undo (#7) — an
      // import that adds templates or categories used to leave a stale count
      // until the next route change forced a re-fetch.
      templateStore.fetchCatalog(),
      categoryStore.fetchAll(),
    ]);
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

function clearImport() {
  importState.value = null;
  importSelection.value = null;
  conflictsOpen.value = false;
  batchConflicts.value = [];
  perItemIssues.value = [];
  pendingSelection.value = [];
}
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
          @click="onRefresh"
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
        :data-active="mode === 'import' ? 'true' : 'false'"
        :aria-selected="mode === 'import'"
        data-test="io-tab-import"
        @click="setMode('import')"
      >
        <Icon name="pi-upload" /> Import
      </button>
    </div>

    <!-- Export tab — 7-bucket picker, POST /wp/api/export/build -->
    <div
      v-if="mode === 'export'"
      class="wp-io-export-pane"
      data-test="io-export-pane"
    >
      <ExportTab ref="exportTabRef" />
    </div>

    <!-- Import tab — 7-bucket parse + picker + commit orchestrator -->
    <div
      v-else-if="mode === 'import'"
      class="wp-io-import-pane"
      data-test="io-import-pane"
    >
      <ImportTab
        :payload-loaded="importState !== null"
        @payload-ready="onImportPayloadReady"
        @replace-requested="clearImport"
      />
      <ImportPicker
        v-if="importState"
        :key="importState.id"
        :payload="importState.payload"
        :migrated-entity-count="importState.migratedCount"
        :integrity-warnings="importState.integrityWarnings"
        :library-rows="libraryRowsForPicker"
        data-test="io-import-picker"
        @selection-ready="onImportSelectionReady"
      />
      <div
        v-if="importSelection && !conflictsOpen"
        class="wp-io-import-stash"
        data-test="io-import-stash"
      >
        <p class="wp-io-import-stash__line">
          <template v-if="importCommitting">
            Committing {{ importSelection.size }}
            {{ importSelection.size === 1 ? "entity" : "entities" }}…
          </template>
          <template v-else>
            {{ importSelection.size }}
            {{ importSelection.size === 1 ? "entity" : "entities" }} picked.
          </template>
        </p>
        <Button
          variant="ghost" size="sm" icon="pi-times"
          data-test="io-import-clear"
          :disabled="importCommitting"
          @click="clearImport"
        >Clear</Button>
      </div>
      <ConflictModal
        v-if="conflictsOpen"
        :batch-conflicts="batchConflicts"
        :per-item-issues="perItemIssues"
        @commit-ready="onConflictCommitReady"
        @cancel="onConflictCancel"
        @include-deps="onConflictIncludeDeps"
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

.wp-io-import-pane {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-6);
}
.wp-io-import-stash {
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
.wp-io-import-stash__line {
  margin: 0;
  color: var(--wp-text-muted);
}
</style>
