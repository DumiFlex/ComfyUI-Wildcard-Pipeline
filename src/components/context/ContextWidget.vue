<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, provide, defineAsyncComponent } from "vue";
import {
  buildBundleEnabledMap,
  isModuleEffectivelyEnabled,
  parseWidgetJsonWithRecovery, serializeWidgetJson,
  emptyContextValue, newRowUid,
  type ContextWidgetValue, type ModuleEntry,
} from "../../widgets/_shared";
import { type ResolvedValue } from "../../widgets/richTokenize";
import { scanConflicts, labelFor as conflictLabelFor, shortConflictLabel, type Conflict } from "../../extension/conflicts";
import { computeConstraintDeadEnds } from "../../extension/constraint-dead-ends";
import type { ChainModule, PairingBadge, RowPairings } from "../../extension/constraint-pairs";
import { baseCodename } from "../../extension/node-codename";
import { derivationTargets } from "../../extension/derivation-conditions";
import { getValidationMode } from "../../extension/settings";
import {
  ensure as ensurePreviewLookup,
  lookup as previewLookup,
  cacheVersion as previewCacheVersion,
} from "../../extension/preview-resolver";
import ModulePickerModal from "./ModulePickerModal.vue";
import BundlePickerModal from "./BundlePickerModal.vue";
import BundleFrame from "./bundles/BundleFrame.vue";
import { BundleFrameCtxKey, type BundleFrameCtx } from "./bundles/bundle-frame-ctx";
import ModuleRow from "./ModuleRow.vue";
import { ModuleRowCtxKey, type ModuleRowCtx } from "./module-row-ctx";
import {
  CONTEXT_POOLS_KEY,
  FOREIGN_POOL_LOOKUP_KEY,
  buildContextPools,
} from "../../extension/context-pools";
import { LockSeedKey } from "./lock-seed-ctx";
import { isEnabled, type WildcardOption, type InstanceLike } from "./editors/wildcard/probability";
import { buildLibraryChildrenWithIntegrity } from "./bundles/save";
import {
  cascadeRestoreForBundle,
  scanCascadeRestore,
  type CascadeRestoreScan,
} from "./bundles/cascade-restore";
import { reconcileBundleRanges } from "./bundles/drag";
import {
  computeBundleFingerprint,
  bundleSnapshotModified,
  ensureBundleFingerprints,
} from "./bundles/bundle-fingerprint";
import BundleDropBar from "./bundles/BundleDropBar.vue";
import { flashRows } from "./bundles/flip";
import { createBundleOps } from "./bundles/bundle-ops";
import { createBundleMasterToggles } from "./bundles/master-toggles";
import { useBundleEdit } from "./bundles/bundle-edit";
import { buildTopLevelItems } from "./bundles/top-level-items";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";
import type { BundleInstance } from "../../widgets/_shared";
import ModuleEditModal from "./ModuleEditModal.vue";
import ModalShell from "../shared/ModalShell.vue";
// Lazy: bundle edit modal pulls in its own IdentitySection +
// RuntimeSection + color-preset markup. Keeping it out of the
// ContextWidget entry chunk preserves the size budget — the modal
// only runs when the user clicks "Edit bundle…" in the ctxmenu.
const BundleInstanceModal = defineAsyncComponent(
  () => import("./editors/bundle/BundleInstanceModal.vue"),
);
import PushToLibraryModal from "./PushToLibraryModal.vue";
import PushBundleToLibraryModal from "./PushBundleToLibraryModal.vue";
import ContextMenu, {
  type ContextMenuEntry,
  type ContextMenuHeader,
  type ContextMenuItem,
} from "../shared/ContextMenu.vue";
import { dragState } from "./drag-store";
import { useContextDrag } from "./context-drag";
import type { WidgetState } from "./widget-state";
import { createModuleOps } from "./module-ops";
import {
  effectiveEnabled,
  effectiveLockedSeed,
  frameEnableOverride,
  isCollapsed,
  isHeld,
  isHoldable,
  isInternal,
  isLocked,
  isModified,
  isOverriddenOnFrame,
  isSeedLockable,
  kindChipModifier,
  modifiedTooltip,
} from "./module-state";
import { pushToast } from "../shared/toast-store";
import { kindIcon } from "../shared/kind-icons";
import { KIND_TITLE } from "./editors/_shell";
import { currentFrame } from "../context-loop/frame-cursor";
import { withFrameInstance } from "./frame-overrides";
import { varColorClass } from "../shared/var-color";
import wpLogoSvg from "../shared/wp-logo.svg?raw";
import {
  forceRefresh as forceRefreshHashes,
  hashes as libraryHashes,
  bundleHashes,
  refreshMany,
  refreshModule,
  setLibraryHash,
  subscribe as subscribeDrift,
  unsubscribe as unsubscribeDrift,
} from "./drift-store";
import { classifyOne, type CollisionState } from "../../manager/import-export/collision";
import { applyRelink } from "../../manager/import-export/relink-apply";
import ConfirmDialog from "../shared/ConfirmDialog.vue";

const props = withDefaults(defineProps<{
  nodeId: number;
  initialJson: string;
  upstreamVars: string[];
  /** `$var` → which module in which node writes it (last-write-wins).
   *  Threaded to the edit modals so a var chip's hover card can name its
   *  producer instead of only confirming the name exists. Optional for
   *  headless mounts. */
  upstreamProducers?: Record<string, VarProducerLike>;
  /** uuid → labels of OTHER Context nodes that hold it as a wildcard. Lets a
   *  nested-ref hover card explain WHY it fell back to the library: the pool
   *  exists on the canvas, just not in this node, and a catalog never crosses
   *  a node boundary. Absent in headless mounts (no graph to walk). */
  wildcardHomesReader?: (uuid: string) => string[];
  /** Resolved upstream-var snapshot — `$name → resolved string` map.
   *  Drives the combine modal's live-preview pane so users see the
   *  template with vars substituted (e.g. `red portrait` instead of
   *  `$style portrait`) at edit time. Optional for headless mounts. */
  upstreamResolved?: Record<string, ResolvedValue>;
  /** Per-module resolved reader — given a moduleId, returns the map of
   *  vars visible from that module's perspective (upstream chain +
   *  earlier siblings, excluding the module itself). Modal uses this
   *  for the combine live preview because static `upstreamResolved`
   *  alone misses sibling bindings produced in the same node. */
  localResolvedReader?: (moduleId?: string) => Record<string, ResolvedValue>;
  /** Wildcard module uuids reachable upstream of this node. Used by
   *  the constraint-ordering scanner to validate constraint
   *  source/target references — sources in the upstream chain are
   *  fine (already picked), but a target in the upstream chain is a
   *  bug (target ran before constraint loaded). Optional for
   *  headless / test mounts that don't simulate a graph. */
  upstreamWildcardUuids?: string[];
  /** Wildcard module uuids reachable downstream of this node. Mirror
   *  of `upstreamWildcardUuids` — lets the scanner mark
   *  target-in-downstream as the GOOD case (target picks after this
   *  constraint runs) and fire `constraint_source_in_downstream`
   *  when the source is in the wrong direction. */
  downstreamWildcardUuids?: string[];
  /** Uuids referenced via `@{uuid}` nested refs in any downstream
   *  Context wildcard's option values. Mirrors the pair-badge logic
   *  for via-nested carriers: a constraint whose target only resolves
   *  through a downstream carrier still pairs (`↪×N`), so the scanner
   *  must agree by suppressing the `constraint_orphan_target` /
   *  `constraint_target_missing` warning for that route. */
  downstreamNestedReachUuids?: string[];
  /** Cross-node pairing badge map. Computed at the mount layer
   *  (`widgets/context.ts`) by walking upstream + own + downstream
   *  WP_Context modules into a flat chain. Keys are
   *  `${nodeId}#${_uid}` so duplicate library instances + cross-node
   *  rows don't collide. ModuleRow.vue looks up its own row's badge
   *  via `pairingFor(module._uid)` in `moduleRowCtx`. Optional for
   *  headless mounts that don't simulate a graph. */
  pairings?: Map<string, RowPairings>;
  /** Flattened cross-node module chain (upstream + own + downstream
   *  WP_Context nodes), computed at the mount layer alongside
   *  `pairings`. Forwarded to ModuleEditModal → ConstraintInstanceModal
   *  so the constraint modal can resolve a source/target wildcard that
   *  lives in another Context node — same flatten the pair badges use.
   *  Optional for headless mounts. */
  chainModules?: ChainModule[];
  /** Litegraph node mode: 0 ALWAYS, 2 NEVER (mute), 4 BYPASS.
   *  Used to dim the body when the host node is muted/bypassed so
   *  the runtime-skipped state is visually obvious. Other modes are
   *  unused for WP_Context but accepted as default-active (run). */
  nodeMode?: number;
  /** Last-run seed reader keyed by module id. Null = user hasn't queued. */
  lastUsedSeedReader?: (moduleId?: string) => number | null;
  /** Per-frame seed reader — the seed THIS node rolls at iteration frame #k,
   *  computed from the upstream Loop without a run. Drives the per-frame seed
   *  lock so it pins the seed the module actually uses on that frame. */
  frameSeedReader?: (frame: number) => number | null;
  onChange: (json: string) => void;
  /** Called whenever the formula-computed minimum node width changes
   *  (a conflict appears, a state badge gets attached). Mount glue
   *  updates its tracked dynamicMinWidth + invokes host.requestRelayout
   *  so litegraph re-reads computeLayoutSize. Loop-free: the watch
   *  deps are pure Vue reactive state, never DOM measurements. */
  onRequestMinWidth?: (w: number) => void;
}>(), {
  nodeMode: 0,
  upstreamWildcardUuids: () => [],
  downstreamWildcardUuids: () => [],
  downstreamNestedReachUuids: () => [],
  pairings: () => new Map<string, RowPairings>(),
});

const isMuted = computed(() => props.nodeMode === 2 || props.nodeMode === 4);
const muteLabel = computed(() => props.nodeMode === 4 ? "bypassed" : "muted");

const ctxMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuEntry[];
  header?: ContextMenuHeader;
}>({
  visible: false,
  x: 0,
  y: 0,
  items: [],
});

// Phase B: track the currently-edited module by INDEX, not id —
// sibling rows share `m.id`, so a id-keyed editing state would open
// (and save into) the FIRST sibling regardless of which one the user
// double-clicked. Indexing into `value.modules` directly disambiguates.
const editingIdx = ref<number | null>(null);

/** Right-click "Push to library…" can fire on any row without first
 *  opening the edit modal. The modal holds a snapshot copy so the user
 *  can rename/retag without dirtying the workflow row. */
const pushDraft = ref<ModuleEntry | null>(null);
const pushOpen = ref<boolean>(false);

function openPushToLibrary(idx: number): void {
  const m = value.value.modules[idx];
  if (!m) return;
  // Deep-clone so meta edits inside the modal stay local until commit.
  pushDraft.value = JSON.parse(JSON.stringify(m));
  pushOpen.value = true;
}

interface PushSaveResult {
  mode: "update" | "fork" | "reattach" | "relink";
  id: string;
  payload_hash: string;
  bundles_updated: string[];
  name: string;
  origId: string;
}
function onPushSaved(result: PushSaveResult): void {
  // Refresh library hashes regardless of mode — the drift store sees
  // the new entry for forks + the new hash for updates so the
  // missing/drift dots clear immediately instead of waiting for the
  // next poll tick.
  setLibraryHash(result.id, result.payload_hash);
  void forceRefreshHashes();
  // Update mode: sync every workflow row with this uuid so each row's
  // payload_hash + meta.library_name match the freshly-saved library
  // entry. Without this, the per-field reset target on Display name
  // still points at the OLD library name → reset icon shows even
  // though the row IS at the library default now.
  if (result.mode === "update") {
    const next = value.value.modules.map((m) => {
      if (m.id !== result.id) return m;
      return {
        ...m,
        payload_hash: result.payload_hash,
        meta: { ...(m.meta ?? {}), library_name: result.name },
      };
    });
    commitModules(next);
  } else if (result.mode === "reattach") {
    // Re-attach: source library entry was deleted upstream and the
    // user saved as new. Rebind every workflow row pointing at the
    // dead uuid to the freshly-created one so MISSING clears + future
    // refresh/drift checks resolve against the new entry.
    const next = value.value.modules.map((m) => {
      if (m.id !== result.origId) return m;
      return {
        ...m,
        id: result.id,
        payload_hash: result.payload_hash,
        meta: { ...(m.meta ?? {}), library_name: result.name },
      };
    });
    commitModules(next);
  } else if (result.mode === "relink") {
    // Re-link: point the detached row(s) at an EXISTING content-identical
    // library uuid AND walk every module so sibling @{} refs + constraint
    // source/target follow the new uuid (applyRelink swaps id + payload_hash
    // on the matching row + remaps refs everywhere else).
    const remapped = applyRelink(
      value.value.modules as unknown as Record<string, unknown>[],
      { oldId: result.origId, newId: result.id, newPayloadHash: result.payload_hash },
    ) as unknown as ModuleEntry[];
    const next = remapped.map((m) =>
      m.id === result.id
        ? { ...m, meta: { ...(m.meta ?? {}), library_name: result.name } }
        : m,
    );
    commitModules(next);
  }
  const bundlesNote =
    result.bundles_updated.length > 0
      ? ` · ${result.bundles_updated.length} bundle${result.bundles_updated.length === 1 ? "" : "s"} synced`
      : "";
  let msg: string;
  if (result.mode === "fork") msg = `Saved as new library entry "${result.name}"`;
  else if (result.mode === "reattach") msg = `Re-attached "${result.name}" to library`;
  else if (result.mode === "relink") msg = `Re-linked "${result.name}" to library`;
  else msg = `Saved "${result.name}" to library${bundlesNote}`;
  pushToast(msg, { severity: "success" });
  pushOpen.value = false;
  pushDraft.value = null;
}
function onPushClosed(): void {
  pushOpen.value = false;
  pushDraft.value = null;
}

/* ─────── Bundle-scoped Push-to-library modal ─────── */
const pushBundleDraft = ref<BundleInstance | null>(null);
const pushBundleChildrenForLibrary = ref<Array<Record<string, unknown>>>([]);
const pushBundleChildrenPreview = ref<Array<{ name: string; kind: string }>>([]);
const pushBundleOpen = ref<boolean>(false);
const pushBundleCascadeScan = ref<CascadeRestoreScan | null>(null);
/** Captured target uid for the open modal — cascade restore reads
 *  this to locate the same outer BundleInstance via the workflow
 *  state at restore time (not modal-open time, since some prior
 *  cascade phase may have mutated `value.value.modules`/bundles). */
const pushBundleTargetUid = ref<string | null>(null);

function openPushBundleToLibrary(uid: string): void {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  const integrity = buildLibraryChildrenWithIntegrity(
    target,
    value.value.modules,
    bundles,
  );
  if (integrity.orphanedInnerUids.length > 0) {
    pushToast(
      `Bundle has ${integrity.orphanedInnerUids.length} orphan inner reference(s) — they'll be flattened on save. Check nesting after.`,
      { severity: "warning", lifeMs: 7000 },
    );
  }
  // Children preview — render module names + kinds, and inner-bundle
  // references as "bundle: name". Inner bundles in childrenForLibrary
  // are shaped `{ kind: "bundle_ref", bundle_id }` (or similar); for
  // display we walk the workflow bundles to find their friendly name.
  const preview: Array<{ name: string; kind: string }> = [];
  for (let i = target.start_idx; i <= target.end_idx; i++) {
    const m = value.value.modules[i];
    if (!m) continue;
    if ((m as ModuleEntry & { bundle_origin?: string }).bundle_origin !== target._uid) continue;
    preview.push({ kind: m.type, name: m.meta?.name || m.type });
  }
  for (const b of bundles) {
    if (b.parent_uid === target._uid) {
      preview.push({ kind: "bundle", name: b.name || "bundle" });
    }
  }
  pushBundleChildrenForLibrary.value = integrity.children;
  pushBundleChildrenPreview.value = preview;
  // Pre-scan for cascade: how many missing modules + inner bundles are
  // in this outer's scope. Counts > 0 unlock the cascade UI in the
  // modal; the same `cascadeRestoreForBundle` will re-walk at restore
  // time with the live workflow state.
  pushBundleCascadeScan.value = scanCascadeRestore({
    outer: target,
    modules: value.value.modules,
    bundles,
    isModuleMissing: isMissingFromLibrary,
    isBundleMissing: isBundleMissingFromLibrary,
  });
  pushBundleTargetUid.value = uid;
  // Clone the BundleInstance so any edits inside the modal don't dirty
  // the workflow row until commit.
  pushBundleDraft.value = JSON.parse(JSON.stringify(target));
  pushBundleOpen.value = true;
}

/** Modal-invoked cascade pre-pass. Runs bottom-up restoration over
 *  the LIVE workflow state for the captured target uid, commits the
 *  restored uuids back to `value.value`, and returns the rewritten
 *  outer children for the modal's POST/PUT body. */
async function pushBundleCascadeRestore(): Promise<{
  rewrittenChildren: Record<string, unknown>[];
  restoredModuleCount: number;
  restoredBundleCount: number;
}> {
  const uid = pushBundleTargetUid.value;
  const bundles = value.value.bundles ?? [];
  const target = uid ? bundles.find((b) => b._uid === uid) : null;
  if (!target) {
    throw new Error("Cascade restore: target bundle no longer in workflow");
  }
  const result = await cascadeRestoreForBundle({
    outer: target,
    modules: value.value.modules,
    bundles,
    isModuleMissing: isMissingFromLibrary,
    isBundleMissing: isBundleMissingFromLibrary,
  });
  // Commit the rebound workflow modules + bundles so the canvas stops
  // rendering MISSING badges for restored items. Done in-place via
  // `value.value =` so the deep-watch fires onChange.
  value.value = {
    ...value.value,
    modules: result.newModules,
    bundles: result.newBundles,
  };
  // Refresh polling so the drift-store map picks up the freshly-POSTed
  // uuids on the next render rather than waiting 5s.
  void forceRefreshHashes();
  return {
    rewrittenChildren: result.rewrittenChildren,
    restoredModuleCount: result.restoredModuleCount,
    restoredBundleCount: result.restoredBundleCount,
  };
}

interface BundlePushSaveResult {
  mode: "update" | "fork" | "reattach" | "relink";
  id: string;
  payload_hash: string;
  name: string;
  origId: string;
  cascade?: { restoredModuleCount: number; restoredBundleCount: number };
}
function onBundlePushSaved(result: BundlePushSaveResult): void {
  void forceRefreshHashes();
  if (result.mode === "update" || result.mode === "reattach" || result.mode === "relink") {
    // Update: refresh inserted_at_hash + snapshot fingerprint for every
    // BundleInstance pointing at this library entry — drift + MOD dots
    // clear instantly. Reattach: also rebind library_id from the dead
    // uuid to the freshly-created one. Relink: same rebind, but onto an
    // EXISTING content-identical library bundle (no write happened).
    const nextBundles = (value.value.bundles ?? []).map((b) => {
      if (b.library_id !== result.origId) return b;
      const rebound: BundleInstance = {
        ...b,
        library_id: result.id,
        inserted_at_hash: result.payload_hash,
        name: result.name,
        snapshot_fingerprint: computeBundleFingerprint(b, value.value.modules),
      };
      return rebound;
    });
    value.value = { ...value.value, bundles: nextBundles };
  }
  let msg: string;
  if (result.mode === "fork") msg = `Saved as new library bundle "${result.name}"`;
  else if (result.mode === "reattach") msg = `Re-attached "${result.name}" to library`;
  else if (result.mode === "relink") msg = `Re-linked "${result.name}" to library`;
  else msg = `Saved "${result.name}" to library`;
  if (result.cascade) {
    const parts: string[] = [];
    if (result.cascade.restoredModuleCount > 0) {
      parts.push(`${result.cascade.restoredModuleCount} module${result.cascade.restoredModuleCount === 1 ? "" : "s"}`);
    }
    if (result.cascade.restoredBundleCount > 0) {
      parts.push(`${result.cascade.restoredBundleCount} inner bundle${result.cascade.restoredBundleCount === 1 ? "" : "s"}`);
    }
    if (parts.length > 0) msg += ` · cascade-restored ${parts.join(" + ")}`;
  }
  pushToast(msg, { severity: "success" });
  pushBundleOpen.value = false;
  pushBundleDraft.value = null;
  pushBundleTargetUid.value = null;
  pushBundleCascadeScan.value = null;
}
function onBundlePushClosed(): void {
  pushBundleOpen.value = false;
  pushBundleDraft.value = null;
  pushBundleTargetUid.value = null;
  pushBundleCascadeScan.value = null;
}
const editingModule = computed<ModuleEntry | null>(() => {
  if (editingIdx.value == null) return null;
  const m = value.value.modules[editingIdx.value] ?? null;
  return m ? withFrameInstance(m, currentFrame.value) : null;
});

/** Per-occurrence pair lookup for the currently-edited CARRIER module.
 *  Map keys are the carrier's `via.optionIds` — wildcard option ids for a
 *  wildcard carrier, engine branch keys (`${rule_id}:${bi}` / `:else`) for
 *  a derivation carrier. Values are the pair badges whose nested `@{uuid}`
 *  ref this occurrence hosts. Drives the trailing `↪#N` chip inside the
 *  wildcard modal's options table AND the derivation modal's rule summary
 *  rows. Empty for non-carrier modules. Carrier-type-agnostic: it reads
 *  `viaInboundFor`, which `computePairingsFull` populates for every
 *  CARRIER_TYPE. */
const editingModuleViaOptionPairs = computed<Map<string, PairingBadge[]>>(() => {
  const m = editingModule.value;
  if (!m) return new Map();
  const carrierPairs = viaInboundFor(m._uid ?? m.id);
  if (carrierPairs.length === 0) return new Map();
  const out = new Map<string, PairingBadge[]>();
  for (const p of carrierPairs) {
    const optionIds = p.via?.optionIds ?? [];
    for (const optId of optionIds) {
      const arr = out.get(optId);
      if (arr) arr.push(p);
      else out.set(optId, [p]);
    }
  }
  return out;
});

/** Live-preview source of truth for the modal: combines upstream-chain
 *  bindings + sibling bindings produced in this same node (minus the
 *  module being edited). Falls back to the static `upstreamResolved`
 *  prop when the per-module reader isn't wired (legacy mounts /
 *  headless tests). Recomputed on every editingIdx change so the
 *  preview pane reflects the right perspective. */
const resolvedForEditing = computed<Record<string, ResolvedValue>>(() => {
  const m = editingModule.value;
  if (props.localResolvedReader && m) {
    return props.localResolvedReader(m.id);
  }
  return props.upstreamResolved ?? {};
});

// Variable names defined in OTHER modules of this same node — used by the
// edit modal's autocomplete + per-entry validity. Exclude the module being
// edited so its own (in-flight) names don't echo back as suggestions.
//
// Each kind contributes via its own producer field:
//   - fixed_values  → entries[].variable_name (UI mirror) + payload.values[].name
//                     and instance.values_overrides[].name
//   - wildcard      → instance.variable_binding ?? payload.var_binding
//   - combine       → instance.variable_binding ?? payload.output_var
//   - derivation    → payload.rules[].branches[].action.target_var
//                     and payload.rules[].else.action.target_var
// Combine + wildcard have no entries; without this kind-aware fallback the
// modal's insert-var dropdown would render empty for chains where the only
// vars come from binding-producer modules.
/**
 * Vars written by the OTHER modules in this same Context node, together with
 * who writes each one.
 *
 * `collectUpstreamProducers` walks the node chain and deliberately excludes
 * the point-of-view node, so it can only attribute vars produced further
 * upstream. In a graph where one Context node carries most of the modules —
 * which is the normal shape — that left nearly every `$var` in the
 * autocomplete with no writer at all, and the rows rendered bare while the
 * SPA's equivalent showed a full attribution line for the same names.
 *
 * Built in the same pass as the name list so the two cannot disagree about
 * which module owns a name.
 */
/** The `accepts` axes a wildcard payload declares, with the tags each rolls
 *  from. `hueIndex` counts EVERY group so a colour matches the wildcard
 *  editor's. Mirrors `acceptsAxesOf` in `manager/utils/library-suggestions`;
 *  duplicated rather than imported because that module pulls the whole module
 *  store into the canvas bundle, which the size gate will not carry. */
function acceptsAxesOfPayload(
  payload: unknown,
): { axis: string; tags: string[]; hueIndex: number }[] | undefined {
  const p = (payload ?? {}) as {
    tag_groups?: Record<string, string[]>;
    tag_group_kinds?: Record<string, string>;
  };
  if (!p.tag_group_kinds) return undefined;
  const out: { axis: string; tags: string[]; hueIndex: number }[] = [];
  Object.entries(p.tag_groups ?? {}).forEach(([axis, tags], hueIndex) => {
    if (p.tag_group_kinds?.[axis] === "accepts") {
      out.push({ axis, tags: tags ?? [], hueIndex });
    }
  });
  return out.length > 0 ? out : undefined;
}

const siblingVarInfo = computed<{
  names: string[];
  producers: Record<string, VarProducerLike>;
}>(() => {
  const names = new Set<string>();
  const producers: Record<string, VarProducerLike> = {};
  /** Last module to write each name, so repeat writes from one module (a
   *  derivation's branches) do not inflate the override count. */
  const lastWriter = new Map<string, string>();
  let owner: {
    kind: string; moduleName: string; moduleId: string;
    axes?: { axis: string; tags: string[]; hueIndex: number }[];
  } | null = null;
  function add(name: string | undefined | null): void {
    const trimmed = (name ?? "").replace(/^\$+/, "").trim();
    if (!trimmed) return;
    names.add(trimmed);
    if (!owner) return;
    // Later modules win, matching the engine's last-write-wins resolution.
    // The count tracks distinct MODULES, not write statements: a derivation
    // calls this once per branch and a fixed_values once per row, but at most
    // one branch fires and the module is a single writer either way.
    const prev = producers[trimmed];
    const sameWriter = lastWriter.get(trimmed) === owner.moduleId;
    lastWriter.set(trimmed, owner.moduleId);
    producers[trimmed] = {
      kind: owner.kind,
      moduleName: owner.moduleName,
      moduleId: owner.moduleId,
      // Same node, so there is no other node to name — saying which one it is
      // would be noise when every sibling gives the same answer.
      nodeLabel: "this node",
      shadowed: prev ? (sameWriter ? prev.shadowed : prev.shadowed + 1) : 0,
      // `accepts` axes, so `$var.AXIS` completion works for a variable written
      // in THIS node. Same-node writers replace the upstream entry wholesale
      // in `allVarProducers`, so axes attached only during the graph walk were
      // dropped for exactly the common case: the wildcard and the template
      // that reads it sitting in one Context.
      ...(owner.axes ? { axes: owner.axes } : {}),
    };
  }
  const editingM = editingModule.value;
  const bundleEnabled = buildBundleEnabledMap(value.value.bundles);
  for (let mi = 0; mi < value.value.modules.length; mi++) {
    const m = value.value.modules[mi];
    if (mi === editingIdx.value) continue;
    if (!isModuleEffectivelyEnabled(m, bundleEnabled)) continue;
    // Defensive: also skip if same object (shouldn't happen but Vue
    // proxies can confuse identity equals).
    void editingM;
    owner = {
      kind: m.type,
      moduleName: m.meta?.name ?? m.type,
      moduleId: m.id,
      // Read from the module's own payload snapshot — the node runs what it
      // captured, so this is the truth for THIS node regardless of what the
      // library says now.
      ...(m.type === "wildcard" ? { axes: acceptsAxesOfPayload(m.payload) } : {}),
    };
    for (const e of m.entries) add(e.variable_name);
    const inst = (m.instance ?? {}) as {
      variable_binding?: string | null;
      values_overrides?: Array<{ name?: string }>;
    };
    const p = (m.payload ?? {}) as {
      var_binding?: string;
      output_var?: string;
      values?: Array<{ name?: string }>;
      rules?: Array<{
        branches?: Array<{ action?: { target_var?: string } }>;
        else?: { action?: { target_var?: string } };
      }>;
    };
    if (m.type === "wildcard") {
      add(inst.variable_binding ?? p.var_binding);
    } else if (m.type === "combine") {
      add(inst.variable_binding ?? p.output_var);
    } else if (m.type === "fixed_values") {
      const overrides = inst.values_overrides;
      if (Array.isArray(overrides) && overrides.length > 0) {
        for (const v of overrides) add(v.name);
      } else {
        for (const v of p.values ?? []) add(v.name);
      }
    } else if (m.type === "derivation") {
      for (const name of derivationTargets(p)) add(name);
    }
  }
  owner = null;
  return { names: [...names], producers };
});

const siblingNodeVars = computed<string[]>(() => siblingVarInfo.value.names);

/**
 * Every `$var` writer the editors can name: upstream nodes first, then this
 * node's own modules on top.
 *
 * Siblings override because they run later in the same chain position, which
 * is what the engine does too — so the row names the module whose value
 * actually survives.
 *
 * The override COUNT has to be carried across the seam. A plain spread
 * replaces the upstream entry outright, taking its `shadowed` with it: with
 * `$outfit` written by an upstream wildcard, rewritten by an upstream
 * derivation, then rewritten again by a module in this node, the row reported
 * "0" — no badge at all — because the sibling map only ever counted siblings
 * and started from zero. A sibling that displaces an upstream writer has
 * overridden that writer PLUS everything it had already overridden.
 */
const allVarProducers = computed<Record<string, VarProducerLike>>(() => {
  const upstream = props.upstreamProducers ?? {};
  const merged: Record<string, VarProducerLike> = { ...upstream };
  for (const [name, sib] of Object.entries(siblingVarInfo.value.producers)) {
    const up = upstream[name];
    // Same carry-forward as the graph walk: a same-node writer that declares
    // no axes must not erase the ones an upstream wildcard declared for this
    // binding — the engine keys `__wp_axes__` by binding, so the rolled axis
    // outlives a rebind.
    merged[name] = up
      ? {
          ...sib,
          ...(sib.axes ?? up.axes ? { axes: sib.axes ?? up.axes } : {}),
          shadowed: sib.shadowed + up.shadowed + 1,
        }
      : sib;
  }
  return merged;
});

// Initial parse runs through the recovery path so we can flag bad workflow
// JSON instead of silently swallowing it. parseWidgetJson stays exported for
// the debug/assembler widgets which don't need recovery semantics.
const initialParse = parseWidgetJsonWithRecovery(props.initialJson, emptyContextValue());
ensureRowUids(initialParse.value.modules);
ensureBundleFingerprints(initialParse.value.bundles ?? [], initialParse.value.modules);
const value = ref<ContextWidgetValue>(initialParse.value);

/**
 * Atomic write to `value.value` whenever the modules array changes
 * shape (insert, remove, reorder) AND for in-place updates that don't
 * shift indices. Always pipes through `reconcileBundleRanges` so the
 * bundles[] cache (start_idx / end_idx per BundleInstance) stays in
 * lock-step with each child's `bundle_origin` field — the canonical
 * source of truth for bundle membership.
 *
 * - `nextModules` is the post-mutation array. Pass it as a fresh
 *   reference (already spread / mapped / sliced); the helper does not
 *   clone it.
 * - `bundlesOverride` is for callers that have hand-computed the
 *   post-mutation bundles[] (e.g. removeBundle adjusting sibling
 *   indices, picker insertion appending a fresh BundleInstance). The
 *   override is the INPUT to reconcile, not the final write — the
 *   helper will still groom the result so a hand-computed bundle that
 *   no longer has any children with matching `bundle_origin` gets
 *   dropped, and a contiguous run that the override missed gets its
 *   start/end recomputed.
 *
 * Reconcile is idempotent, so calling this helper at sites that
 * didn't change indices (instance toggle, modal save, bulk collapse)
 * is a no-op on the bundles[] side and free from the perspective of
 * correctness. Routing every mutation through the helper means
 * "every modules write also writes bundles" is enforced by the call
 * site shape, not by author memory.
 */
function commitModules(
  nextModules: ModuleEntry[],
  bundlesOverride?: BundleInstance[],
): void {
  const sourceBundles = bundlesOverride ?? value.value.bundles ?? [];
  value.value = {
    ...value.value,
    modules: nextModules,
    bundles: reconcileBundleRanges(nextModules, sourceBundles),
  };
}

// Container ref for list-level drag handlers + bar positioning.
const modulesContainer = ref<HTMLElement | null>(null);
const widgetState: WidgetState = { value, commitModules, modulesContainer };

const {
  suppressMove, isDropEndZone, holdSuppressMove,
  onListDragOver, onEmptyHeroDragOver, onEndDragOver, onContainerLeave, onDrop,
  rowCtx: dragRowCtx, frameCtx: dragFrameCtx,
} = useContextDrag(widgetState, props);

onMounted(() => {
  // Subscribe to the shared drift-store — it manages the 5s poll of the
  // /wp/api/modules/hashes endpoint and exposes the live-hash map that
  // drives both the missing-dot and the drift-dot.
  subscribeDrift();
});
onBeforeUnmount(() => {
  unsubscribeDrift();
});

const {
  pendingConfirm, onPickBundle, toggleBundleCollapsed, toggleBundleEnabled,
  removeBundle, detachBundle, duplicateBundle, resetBundleToLibrary,
  resetChildToBundleSnapshot, wrapIntoNewBundle, frameCtx: bundleOpsFrameCtx,
} = createBundleOps(widgetState, holdSuppressMove);
// Lock / Hide masters: exactly the BundleFrame ctx members of the same names.
const masterToggles = createBundleMasterToggles(widgetState, props);
const { bundleInternalState, bundleLockState } = masterToggles;
const {
  bundleDraft, bundleLibraryDefaults, editingBundleEntry, openBundleEditModal,
  onBundleEditUpdate, saveBundleEdit, cancelBundleEdit, onBundleEditToggleLock,
  onBundleEditToggleInternal, onBundleEditSaveToLibrary, onBundleEditResetToLibrary,
} = useBundleEdit(widgetState, {
  ...masterToggles, openPushBundleToLibrary, resetBundleToLibrary,
});

/** Stamp `_uid` on any module missing one. Phase B: each row needs a
 *  per-instance stable Vue v-for key that survives reorders + inserts —
 *  siblings share `m.id` (library uuid), so id alone isn't unique, and
 *  composite `${id}|${idx}` would change for every row when the array
 *  shifts (breaks TransitionGroup move animations). Backfill in-place
 *  on initial load + after re-parse so existing workflow JSON works. */
function ensureRowUids(modules: ModuleEntry[]): boolean {
  let mutated = false;
  for (const m of modules) {
    if (!m._uid) {
      m._uid = newRowUid();
      mutated = true;
    }
  }
  return mutated;
}

const parseError = ref<string | null>(initialParse.error);
const parseRaw = ref<string>(initialParse.raw);
const showRaw = ref(false);
const showPicker = ref(false);

// 4.5 — animated arrow on first run. Persists dismissal across reloads via
// localStorage so the hint never re-appears once the user has clicked into
// the picker.
const FIRST_RUN_KEY = "wp:hint:first-add";
const firstRunHintDismissed = ref<boolean>(
  typeof window !== "undefined" && window.localStorage?.getItem(FIRST_RUN_KEY) === "dismissed",
);
function dismissFirstRunHint() {
  if (firstRunHintDismissed.value) return;
  firstRunHintDismissed.value = true;
  // Wrapped — Safari private mode + locked-down iframes can throw on writes.
  try { window.localStorage?.setItem(FIRST_RUN_KEY, "dismissed"); } catch { /* ignore */ }
}

function openPicker() {
  dismissFirstRunHint();
  showPicker.value = true;
}

// Bundle picker state — second add-flow alongside the module picker.
// Opened via the "+ Add Bundle" button in the footer + empty-state.
const showBundlePicker = ref(false);
function openBundlePicker() {
  dismissFirstRunHint();
  showBundlePicker.value = true;
}

/** Stub — opens SPA in author-mode to create a new bundle. v1 routes
 *  to /bundles/new; SPA wires up the editor in Phase 4. */
function openBundleAuthor(): void {
  openSpaLibrary();   // Reuse existing SPA link for v1 — Phase 4 deep-links to bundle editor
}

/** Bundle right-click menu. Mirrors module ctxmenu pattern — sets
 *  ctxMenu state with bundle-scoped items. The shared ContextMenu
 *  component handles positioning + dismiss. */
function openBundleContextMenu(ev: MouseEvent, uid: string): void {
  const target = (value.value.bundles ?? []).find((b) => b._uid === uid);
  if (!target) return;
  const estW = 240;
  const estH = 220;
  const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
  const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
  const items: ContextMenuEntry[] = [
    {
      label: "Edit bundle…",
      icon: "pi-pencil",
      subtitle: "Display name, color, lock + hide cascades",
      onSelect: () => openBundleEditModal(uid),
      divider: true,
    },
    {
      label: target.collapsed ? "Expand bundle" : "Collapse bundle",
      icon: target.collapsed ? "pi-caret-down" : "pi-caret-right",
      onSelect: () => toggleBundleCollapsed(uid),
    },
    {
      label: target.enabled ? "Disable bundle" : "Enable bundle",
      icon: target.enabled ? "pi-eye-slash" : "pi-eye",
      subtitle: "Cascades to all children",
      onSelect: () => toggleBundleEnabled(uid, !target.enabled),
      divider: true,
    },
    // The two library actions accent themselves to match the bundle's CURRENT
    // state, so the menu points at the recovery for the badge the user just
    // saw. Only one lights up: the states are ranked, since a bundle can be
    // several at once and two competing accents would say nothing.
    //   missing  → Push (re-link or add) — nothing to reset FROM
    //   drifted  → Reset (pull the library's newer version)
    //   modified → Push (save your local edits up)
    (() => {
      const drifted = !isBundleMissingFromLibrary(target)
        && isBundleLibraryDrifted(target);
      return {
        label: "Reset to library snapshot",
        icon: "pi-refresh",
        subtitle: drifted
          ? "Library changed since insert — pull the newer version"
          : "Replace children with frozen library state",
        accent: drifted,
        onSelect: () => { void resetBundleToLibrary(uid); },
      };
    })(),
    (() => {
      const bundleMissing = isBundleMissingFromLibrary(target);
      const modified = !bundleMissing
        && !isBundleLibraryDrifted(target)
        && bundleSnapshotModified(target, value.value.modules);
      let subtitle = "Rename, retag, overwrite library entry";
      if (bundleMissing) subtitle = "Not linked to a library entry — re-link or add";
      else if (modified) subtitle = "Local edits since insert — save them to the library";
      return {
        label: "Push to library…",
        icon: "pi-cloud-upload",
        subtitle,
        accent: bundleMissing || modified,
        onSelect: () => openPushBundleToLibrary(uid),
        divider: true,
      };
    })(),
    {
      label: "Duplicate bundle",
      icon: "pi-clone",
      subtitle: "Insert another instance below",
      onSelect: () => { void duplicateBundle(uid); },
    },
    {
      label: "Detach",
      icon: "pi-link",
      subtitle: "Frame removed, children stay",
      onSelect: () => detachBundle(uid),
      divider: true,
    },
    {
      label: "Remove bundle + children",
      icon: "pi-trash",
      danger: true,
      onSelect: () => removeBundle(uid),
    },
  ];
  ctxMenu.value = {
    visible: true,
    x: Math.max(8, x),
    y: Math.max(8, y),
    items,
    header: {
      icon: "pi-box",
      label: `Bundle · ${target.name ?? "bundle"}`,
      iconColor: target.color || undefined,
    },
  };
}

// Populated vs. empty page swap is driven by a wrapper <Transition
// mode="out-in"> below. mode="out-in" sequences populated→empty cleanly:
// the populated block fades out fully BEFORE the empty hero fades in, so
// the leaving card and the appearing hero never visually stack.
const isEmpty = computed(() => value.value.modules.length === 0);

function resetCorruptValue() {
  // User confirmed reset — replace with empty + clear the recovery panel.
  // The deep-watcher will fire onChange so the workflow JSON is rewritten.
  parseError.value = null;
  showRaw.value = false;
  value.value = emptyContextValue();
  pushToast("Workflow data reset to empty.", { severity: "info", lifeMs: 4000 });
}

let suppressWatch = false;
watch(value, (v) => {
  if (suppressWatch) { suppressWatch = false; return; }
  props.onChange(serializeWidgetJson(v));
}, { deep: true });

watch(() => props.initialJson, (raw) => {
  // Reuse the recovery-aware parser so a workflow loaded with corrupt JSON
  // surfaces the same panel as a node that was already corrupt at mount.
  const next = parseWidgetJsonWithRecovery(raw, emptyContextValue());
  ensureRowUids(next.value.modules);
  parseError.value = next.error;
  parseRaw.value = next.raw;
  if (serializeWidgetJson(next.value) === serializeWidgetJson(value.value)) return;
  suppressWatch = true;
  value.value = next.value;
});

// Constraints that can leave a target with nothing to pick (no fallback).
// Cross-node: reads the flattened chain + reach coverage, keyed back to this
// node's `_uid`s. Its own computed so a conflict-free edit elsewhere in the
// widget doesn't redo the option × option walk.
const deadEndsByUid = computed<Map<string, string[]>>(() => {
  const out = new Map<string, string[]>();
  if (!props.chainModules?.length || !props.pairings?.size) return out;
  const prefix = `${props.nodeId}#`;
  for (const [rowKey, d] of computeConstraintDeadEnds(props.chainModules, props.pairings)) {
    if (rowKey.startsWith(prefix)) out.set(rowKey.slice(prefix.length), d.sourceValues);
  }
  return out;
});

const conflicts = computed<Conflict[]>(() => {
  // scanConflicts internally skips per-module via isModuleEffectivelyEnabled
  // (handles both child.enabled=false AND bundle.enabled=false). Passing the
  // full modules array preserves position semantics for constraint-target /
  // nested-ref lookups that need to know where every module sits regardless
  // of run state.
  // Build the per-uid orphan map from the cross-node pairings prop.
  // Cross-node-pairings keys are `${nodeId}#${_uid}` — strip the
  // node-id prefix so the scanner can lookup by local `_uid`. Only
  // constraint rows in this Context node carry meaningful pair data;
  // wildcard / carrier rows have no `direct` of their own here.
  const pairOrphanByUid = new Map<string, boolean>();
  const nodeIdPrefix = `${props.nodeId}#`;
  for (const [rowKey, rp] of props.pairings) {
    if (!rp.direct) continue;
    if (!rowKey.startsWith(nodeIdPrefix)) continue;
    const uid = rowKey.slice(nodeIdPrefix.length);
    pairOrphanByUid.set(uid, rp.direct.isOrphan);
  }
  const all = scanConflicts(
    value.value,
    props.upstreamVars,
    props.upstreamWildcardUuids,
    props.downstreamWildcardUuids,
    props.downstreamNestedReachUuids,
    pairOrphanByUid,
    // Live-library uuids — a nested @{} ref to any of these resolves at run
    // time (DB-expanded catalog), so it must not read as a broken ref.
    new Set(Object.keys(libraryHashes.value ?? {})),
    deadEndsByUid.value,
  );
  // Filter by user's validation-strictness preference. The accessor
  // reads from the same module-level state map the panel onChange
  // updates, so the computed picks up the new mode without manual
  // wiring (computed re-evaluates whenever its reactive deps —
  // value, props — change; the validation read is captured fresh
  // each evaluation, which is fine here because state changes
  // always coincide with a reactive trigger upstream).
  const mode = getValidationMode();
  if (mode === "permissive") return [];
  if (mode === "relaxed") return all.filter((c) => c.severity !== "info");
  return all;
});
const conflictsByModule = computed(() => {
  const out: Record<string, Conflict[]> = {};
  for (const c of conflicts.value) (out[c.moduleId] ??= []).push(c);
  return out;
});

// Pairing badge lookup — reads from the cross-node `pairings` prop
// composed at the mount layer. Keys are `${nodeId}#${_uid}` so we have
// to prefix the local row's `_uid` with our own `nodeId` before
// lookup. Falls back to `id` for legacy rows that haven't been backfilled
// with a `_uid` yet (`ensureRowUids()` normally runs on load, but a
// barebones test mount can skip it).
function pairingFor(rowUid: string): PairingBadge | null {
  const key = `${props.nodeId}#${rowUid}`;
  return props.pairings?.get(key)?.direct ?? null;
}

/** Inbound via-pairings — non-empty when this row is the CARRIER of
 *  one or more constraints reaching their target through a nested
 *  `@{uuid}` ref in this wildcard's option values. UI renders these
 *  as a collapsed `↪×N` chip beside the row's existing direct pair
 *  chip (if any), with a popover listing each. */
function viaInboundFor(rowUid: string): PairingBadge[] {
  const key = `${props.nodeId}#${rowUid}`;
  return props.pairings?.get(key)?.viaInbound ?? [];
}

/** SP3 contributor cluster — every constraint whose reach covers this
 *  target-instance row, in per-target `#N` order. Reads the same
 *  cross-node `pairings` prop as `pairingFor` / `viaInboundFor`,
 *  prefixing the local `_uid` with our `nodeId`. ModuleRow renders these
 *  BEFORE the module name: ≤2 as individual `#N` chips, ≥3 as one
 *  collapsed `↥×N` chip. Empty for rows no constraint covers. */
function contributorsFor(rowUid: string): PairingBadge[] {
  const key = `${props.nodeId}#${rowUid}`;
  return props.pairings?.get(key)?.contributors ?? [];
}

function severityFor(id: string): "error" | "warning" | "info" | null {
  const list = conflictsByModule.value[id];
  if (!list?.length) return null;
  if (list.some((c) => c.severity === "error")) return "error";
  if (list.some((c) => c.severity === "warning")) return "warning";
  return "info";
}

/**
 * Short text label for the conflict badge that sits next to the
 * `.wp-conflict-dot`. Picks the most-severe conflict on this
 * module (error > warning > info) and maps its type to a 1-2 word
 * tag so users recognise the issue without hovering for the
 * tooltip — pairs with the dot the same way the status badges
 * pair with the drift / missing / mod dots above. Returns `null`
 * if the module has no conflicts.
 *
 * Wording stays short on purpose; the full sentence form lives in
 * `conflictTooltip` for the title attribute. Constraint-specific
 * subtypes get their own short form so a constraint row with a
 * source/target wiring issue surfaces a meaningful label rather
 * than the generic "conflict".
 */
function conflictBadgeText(id: string): string | null {
  const list = conflictsByModule.value[id];
  if (!list?.length) return null;
  // Pick the highest-severity conflict; tie-break by first occurrence
  // so the badge wording stays stable across renders. Label text comes
  // from the shared `shortConflictLabel` so module + injector rows
  // surface identical chip wording for the same conflict type.
  const order = { error: 0, warning: 1, info: 2 } as const;
  const top = [...list].sort(
    (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9),
  )[0];
  return shortConflictLabel(top.type);
}

function conflictTooltip(id: string): string {
  const list = conflictsByModule.value[id];
  if (!list?.length) return "";
  return list.map((c) => {
    // Constraint conflict types carry a wildcard uuid in `variable`,
    // not a $-var name. Resolve via the same sibling/preview-resolver
    // lookup constraint card labels use, so the tooltip shows
    // `$hair_color` instead of the unreadable 8-hex slug. Falls back
    // to the bare uuid only when the resolver can't find a name —
    // matches the card label's contract.
    if (c.type.startsWith("constraint_")) {
      const name = lookupSiblingName(c.variable);
      const display = name ?? c.variable;
      if (c.type === "constraint_excludes_all" && c.detail) {
        return `${conflictLabelFor(c.type)}: $${display} when the source picks ${c.detail}`;
      }
      return `${conflictLabelFor(c.type)}: $${display}`;
    }
    return `${conflictLabelFor(c.type)}: $${c.variable}`;
  }).join("\n");
}

/**
 * Card subtitle line. fixed_values surfaces the inline-edited
 * `$var, $var, …` list (the legacy summary); other kinds inspect
 * the snapshot payload to surface a one-glance signature
 * (var-binding + option count for wildcards, output-var for
 * combines, rule count for derivations, etc.).
 */
/**
 * Per-instance override detection. A library-snapshot module is
 * "modified" when any field on `m.instance` differs from the engine's
 * `_fresh_instance()` defaults — option enable/disable, weight
 * overrides, mode (pinned / subcategory), or category filter. Drives
 * the small accent dot on the card header so users can spot which
 * picked modules they've tweaked locally.
 *
 * Symmetric with the modal's `hasInstanceOverrides` (kept in sync
 * manually — small enough surface that DRYing isn't worth a shared
 * util yet).
 */
/**
 * True when a module's id isn't in the live library set. Modules
 * with no `payload_hash` are treated as LOCAL-ONLY by design (no
 * library tie expected). This covers two cases at once:
 *   - inline-created `fixed_values` entries (never had a library
 *     row — payload_hash never set)
 *   - duplicates of any kind (the duplicate path strips
 *     payload_hash so the clone reads as local; see `duplicateModule`)
 *
 * Returns false until `libraryHashes` first loads so we don't flash
 * "missing" everywhere while the initial fetch is in flight.
 */
/**
 * Identity verdict of an embedded row against the live library — or null
 * until the first poll lands / for local-only rows (no payload_hash).
 * Single source for the card dots. Content key is `payload_hash`, so
 * drift semantics match the historical behavior (content-only); the
 * `type` gate is the new cross-kind clash detector. Shared verdict logic
 * lives in `classifyOne` (import-export/collision).
 */
function matchStateOf(m: ModuleEntry): CollisionState | null {
  if (libraryHashes.value === null) return null;
  const live = libraryHashes.value[m.id];
  if (!m.payload_hash) {
    // No local hash. Only meaningful when the uuid IS in the library — a
    // workflow copy that lost its hash (malformed import, or a builder that
    // wrote payload_hash: ""). Treat as drift so the bulk "refresh drifted"
    // button relinks it. A genuinely inline module (fresh uuid, not in the
    // library) stays verdict-less exactly as before.
    return live ? "conflict" : null;
  }
  return classifyOne(
    m.type,
    m.payload_hash,
    live ? { type: live.type, contentKey: live.payload_hash } : undefined,
  );
}

function isMissingFromLibrary(m: ModuleEntry): boolean {
  return matchStateOf(m) === "no-collision";
}

/**
 * Drift = library still has this uuid (SAME kind), but the live
 * `payload_hash` differs from what was embedded at pick time. Independent
 * of `isModified` (user overrides). Mutually exclusive with the clash
 * state below — a different-kind row is `type-conflict`, not drift.
 */
function isDrifted(m: ModuleEntry): boolean {
  return matchStateOf(m) === "conflict";
}

/**
 * Type clash = the live library row at this uuid is a DIFFERENT kind (the
 * 8-hex id-space is shared across all 5 kinds). Refresh / Push-update
 * would clobber an unrelated item, so the card offers neither — only
 * "Push to library…" as a fresh entry.
 */
function isTypeConflict(m: ModuleEntry): boolean {
  return matchStateOf(m) === "type-conflict";
}

/** Per-card refresh — replace one drifted entry with the live snapshot.
 *  Errors surface as toasts; a 404 (deleted between poll and refresh)
 *  is treated as missing-from-library because the next poll tick will
 *  flip the dot from drift → missing.
 *
 *  Phase B (2026-05-10): takes the row's array index (siblings share
 *  `m.id`, so id-keyed `.map()` overwrote every sibling with one merged
 *  copy → all rows lost their per-instance state + `_uid`, breaking
 *  TransitionGroup keying).
 */
async function refreshOne(idx: number): Promise<void> {
  const m = value.value.modules[idx];
  if (!m) return;
  // Track whether the refreshed row was inside a bundle BEFORE the
  // refresh so we can extend the success toast with a "bundle has
  // unsaved changes" hint. mergeRefresh preserves bundle_origin so the
  // membership doesn't change, but its payload_hash will diverge from
  // the bundle's snapshot fingerprint → modified=true.
  const sourceBundleUid = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin ?? null;
  try {
    const merged = await refreshModule(m);
    if (value.value.modules[idx] !== m) return;  // row shifted while loading
    const next = [...value.value.modules];
    next[idx] = merged;
    // Route through commitModules so reconcileBundleRanges re-envelopes
    // bundle ranges around the refreshed row. Direct assignment skipped
    // reconcile, so when mergeRefresh used to strip bundle_origin (now
    // fixed) the bundle silently dissolved on the next mutation.
    commitModules(next);
    await nextTick();
    if (modulesContainer.value) {
      void flashRows([merged._uid], modulesContainer.value, 0);
    }
    const bundleName = sourceBundleUid
      ? (value.value.bundles ?? []).find((b) => b._uid === sourceBundleUid)?.name ?? null
      : null;
    const toastBody = bundleName
      ? `Refreshed "${merged.meta.name || merged.type}". Bundle "${bundleName}" has unsaved changes — Save to library to update.`
      : `Refreshed "${merged.meta.name || merged.type}".`;
    pushToast(toastBody, { severity: "success", lifeMs: bundleName ? 7000 : undefined });
    await forceRefreshHashes();
  } catch (err) {
    const msg = (err as Error).message ?? "unknown";
    if (msg === "not in library") {
      pushToast(`"${m.meta.name || m.type}" no longer in library — try Save to library.`, { severity: "warning" });
    } else {
      pushToast(`Refresh failed: ${msg}`, { severity: "error" });
    }
  }
}

/** Bulk — refresh every drifted entry in one batched fetch.
 *  Phase B: when N siblings share a uuid, refreshMany returns N merged
 *  entries in input order. Apply them BACK by index, preserving each row's
 *  position + its own `_uid` (mergeRefresh already pins the source row's
 *  instance/_uid). FIFO queue per uuid keeps the parallel-array
 *  invariant when merge-output skips failed uuids. */
async function refreshAllDrifted(): Promise<void> {
  const driftedIdx: number[] = [];
  value.value.modules.forEach((m, i) => { if (isDrifted(m)) driftedIdx.push(i); });
  if (driftedIdx.length === 0) return;

  const driftedRows = driftedIdx.map((i) => value.value.modules[i]);
  // Collect uids of bundles that own any drifted row BEFORE the refresh
  // — used to append a "bundle has unsaved changes" hint to the success
  // toast. Each refresh diverges the row's payload_hash from the
  // bundle's snapshot fingerprint → modified=true.
  const affectedBundleUids = new Set<string>();
  for (const m of driftedRows) {
    const o = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
    if (o) {
      affectedBundleUids.add(o);
      // Also walk parent chain so an inner-leaf refresh marks the outer
      // bundle modified too (it owns the inner's range).
      const cur = (value.value.bundles ?? []).find((b) => b._uid === o);
      const pu = cur?.parent_uid;
      if (typeof pu === "string" && pu) affectedBundleUids.add(pu);
    }
  }
  const result = await refreshMany(driftedRows);

  if (result.refreshed.length > 0) {
    const queueByUuid = new Map<string, ModuleEntry[]>();
    for (const r of result.refreshed) {
      const q = queueByUuid.get(r.id) ?? [];
      q.push(r);
      queueByUuid.set(r.id, q);
    }
    const next = [...value.value.modules];
    const refreshedUids: string[] = [];
    for (const i of driftedIdx) {
      const m = next[i];
      const merged = queueByUuid.get(m.id)?.shift();
      if (merged) {
        next[i] = merged;
        if (merged._uid) refreshedUids.push(merged._uid);
      }
    }
    // commitModules (vs direct assignment) re-runs reconcileBundleRanges
    // so bundles[] envelopes the refreshed rows correctly. Critical when
    // any refreshed row sits inside a bundle — direct assignment skipped
    // reconcile and the bundle silently dissolved on the next mutation.
    commitModules(next);
    await nextTick();
    if (modulesContainer.value && refreshedUids.length > 0) {
      void flashRows(refreshedUids, modulesContainer.value);
    }
    await forceRefreshHashes();
  }

  // Resolve human-readable names for the affected bundles (post-refresh
  // state, in case any vanished via reconcile).
  const bundleNames = [...affectedBundleUids]
    .map((uid) => (value.value.bundles ?? []).find((b) => b._uid === uid)?.name)
    .filter((n): n is string => !!n);
  const bundleHint = bundleNames.length === 0
    ? ""
    : bundleNames.length === 1
      ? ` Bundle "${bundleNames[0]}" has unsaved changes — Save to library to update.`
      : ` ${bundleNames.length} bundles have unsaved changes — Save each to library to update.`;
  if (result.failed.length === 0) {
    pushToast(
      `Refreshed all ${result.refreshed.length}.${bundleHint}`,
      { severity: "success", lifeMs: bundleHint ? 7000 : undefined },
    );
  } else {
    pushToast(
      `Refreshed ${result.refreshed.length} of ${driftedRows.length}; ${result.failed.length} stayed drifted.${bundleHint}`,
      { severity: "warning", lifeMs: bundleHint ? 7000 : undefined },
    );
  }
}

/** Surfaced as a computed for the bulk-button visibility + label. */
const driftedCount = computed(() => value.value.modules.filter(isDrifted).length);

// Per-bundle drift count — sums isDrifted over the bundle's child
// range. Drives the `${count} drifted` suffix on the bundle header
// subtitle so users can glance-spot bundles whose children fell out
// of sync with their library snapshots. Read at render time so the
// libraryHashes poll naturally feeds updates without a watcher.
function bundleChildDriftCount(bundle: BundleInstance): number {
  const mods = value.value.modules;
  let n = 0;
  for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
    if (isDrifted(mods[i])) n++;
  }
  return n;
}

/** True when the bundle library entry has changed since this bundle
 *  was inserted: compare the locally captured `inserted_at_hash` with
 *  the freshest hash from the polled `bundleHashes` map. Returns false
 *  until first poll lands so the UI doesn't flash a drift state before
 *  the truth is known. Distinct from per-child drift — a library may
 *  have a new payload_hash even when every embedded child still
 *  matches its individual snapshot (e.g. the library author only
 *  reordered children, or swapped a child the user previously
 *  detached locally). */
function isBundleLibraryDrifted(bundle: BundleInstance): boolean {
  const map = bundleHashes.value;
  if (map === null) return false;
  const live = map[bundle.library_id];
  if (live === undefined) return false;
  if (!bundle.inserted_at_hash) return false;
  return live !== bundle.inserted_at_hash;
}

/** True when the bundle has NO live library entry behind it. Covers both
 *  shapes of that: it carries a `library_id` the polled map no longer knows,
 *  OR it carries no `library_id` at all.
 *
 *  The second case used to early-return false, so an unlinked bundle could
 *  never show MISSING — leaving MODIFIED as its only badge, which then
 *  compared its children against a snapshot baseline from a library entry that
 *  isn't there. "Modified against what?" was a fair question with no answer.
 *
 *  Returns false until the first poll lands so we don't flash MISSING before
 *  the truth is known. */
function isBundleMissingFromLibrary(bundle: BundleInstance): boolean {
  const map = bundleHashes.value;
  if (map === null) return false;
  if (!bundle.library_id) return true;
  return !(bundle.library_id in map);
}

/** True when the bundle never had a library entry to diverge FROM — no
 *  `library_id` at all. MODIFIED is meaningless in that state: there is no
 *  insert to be modified since. Distinct from "the entry was deleted", where
 *  the local snapshot IS a real baseline and MOD still reads correctly. */
function isBundleUnlinked(bundle: BundleInstance): boolean {
  return bundleHashes.value !== null && !bundle.library_id;
}

// ── Formula-driven minWidth ────────────────────────────────────────
// Pull-based pattern: createDomWidgetHost reads this through a
// getter, litegraph queries each layout pass, no observer required.
// Module rows have a flex:1 `wp-module-name` that absorbs slack —
// adding a conflict badge or state badge doesn't widen the row,
// just shrinks the name's render area. So the formula adjusts up
// when badges are present so the name keeps useful breathing room
// (without state-driven width, a row with name "long_module_alias"
// + conflict badge + actions would clip the name to ~30px when
// node is at the minimum).
//
// Base 380 covers the footer's two "+ Add module" / "+ Add Bundle"
// buttons side-by-side, which is the widest mandatory element. Per-
// badge bumps give the name room to breathe.
const hasAnyConflict = computed(() => Object.keys(conflictsByModule.value).length > 0);
const hasAnyStateBadge = computed(() =>
  value.value.modules.some((m) => isModified(m) || isDrifted(m) || isMissingFromLibrary(m)),
);

const requiredMinWidth = computed(() => {
  let w = 380; // footer-driven baseline
  if (hasAnyConflict.value) w += 60;
  if (hasAnyStateBadge.value) w += 60;
  return w;
});

watch(
  requiredMinWidth,
  (next) => {
    props.onRequestMinWidth?.(next);
  },
  { immediate: true },
);

/**
 * Look up a sibling module's display name by uuid. Used by the
 * constraint summary + (Task 2) the modal preview. Returns the
 * payload's `var_binding` first (canonical $-var name for wildcards),
 * falls back to `meta.name`, then to the lazy preview-resolver cache
 * for cross-node refs (e.g. constraint source/target wildcards that
 * weren't picked into this WP_Context). Returns `null` only when
 * neither siblings nor the cache know the uuid — caller decides what
 * to render in that dangling-ref case.
 */
function lookupSiblingName(uuid: string | null | undefined): string | null {
  if (!uuid) return null;
  // Touch cacheVersion so the computed re-evaluates when an async
  // fetch lands. Without this read the lookup stays stale until some
  // other dependency invalidates the computed.
  void previewCacheVersion.value;
  const sib = value.value.modules.find((m) => m.id === uuid);
  if (sib) {
    // Mirror the engine's precedence: per-instance override wins
    // (`wildcard_handler.py:216`), payload default falls through.
    const inst = sib.instance?.variable_binding;
    if (typeof inst === "string" && inst.trim()) return inst.trim();
    const binding = (sib.payload as { var_binding?: string } | undefined)?.var_binding;
    if (typeof binding === "string" && binding.trim()) return binding.trim();
    const name = sib.meta?.name?.trim();
    if (name) return name;
  }
  // Fallback: dangling ref (e.g. constraint references a wildcard
  // not embedded in this node). Pull the canonical name from the
  // preview-resolver cache — that's already populated for any uuid
  // mentioned anywhere in the chain. Fire ensure() lazily so the
  // first reference triggers a fetch; subsequent reads hit the cache.
  ensurePreviewLookup([uuid]);
  const lk = previewLookup(uuid);
  if (lk?.varBinding) return lk.varBinding;
  if (lk?.name) return lk.name;
  return null;
}

/**
 * Returns null when the module is the only instance of its uuid in the
 * current Context, or `{ index: 1-based, total }` when it has siblings.
 * Used to render the `#N of M` badge.
 *
 * Phase A: counts in-Context only. Phase B may broaden to whole-
 * workflow scope when wiring the auto-fork prompt.
 */
function siblingInfo(m: ModuleEntry): { index: number; total: number } | null {
  const sameUuid = value.value.modules.filter((x) => x.id === m.id);
  if (sameUuid.length <= 1) return null;
  const index = sameUuid.findIndex((x) => x === m) + 1;
  return { index, total: sameUuid.length };
}

/**
 * One token of the summary line. `var` tokens get the kind-color
 * `var-N` class via `varColorClass`; `literal` tokens render plain.
 *
 * Same shape as the assembler / combine preview tokenization
 * (`wp-asm-preview` in AssemblerHelper.vue) so the eye reads
 * `$hair_style` as the same hue everywhere it appears.
 */
type SummaryToken =
  | { kind: "literal"; text: string }
  | { kind: "var"; text: string; varName: string };

/**
 * Structured per-module summary used by the row's meta line. Each
 * entry is rendered as either a colored `<span class="var-tok var-N">`
 * (for `$binding` references) or plain text. Shape mirrors the
 * mockup at `_temp/design-demos/widgets-redesign-v5.html:682, 697,
 * 712, 723, 734` so colored variable tokens land in-place of the
 * previous all-plaintext meta string.
 */
function summaryTokens(m: ModuleEntry): SummaryToken[] {
  // Tiny helper — wrap a binding name as a `$name` var token so the
  // colour hash is computed against the bare name (matching how
  // `varColorClass` is used elsewhere in the codebase).
  const v = (name: string): SummaryToken => ({ kind: "var", text: `$${name}`, varName: name });
  const lit = (text: string): SummaryToken => ({ kind: "literal", text });

  if (m.type === "fixed_values") {
    // Read the bindings from `entries` first — that's the UI-mirror
    // populated when the user types directly into the inline editor.
    // Library-linked rows (bundle children, modules dragged in fresh
    // from the picker) ship with `entries: []` because the canonical
    // values live in `payload.values`. Fall back to that payload
    // shape so a library-linked fixed_values row doesn't render as
    // "(empty)" just because its UI-mirror hasn't been populated.
    const fromEntries = m.entries
      .map((e) => e.variable_name.trim())
      .filter((n) => n !== "");
    const fromPayload =
      fromEntries.length > 0
        ? []
        : (((m.payload ?? {}) as { values?: Array<{ name?: string }> }).values ?? [])
            .map((vv) => (vv.name ?? "").trim())
            .filter((n) => n !== "");
    const names = fromEntries.length > 0 ? fromEntries : fromPayload;
    if (names.length === 0) return [lit("(empty)")];
    const heads = names.slice(0, 2);
    const more = names.length - heads.length;
    const out: SummaryToken[] = [];
    heads.forEach((name, i) => {
      if (i > 0) out.push(lit(", "));
      out.push(v(name));
    });
    if (more > 0) out.push(lit(`, +${more} more`));
    return out;
  }

  const p = (m.payload ?? {}) as Record<string, unknown>;
  switch (m.type) {
    case "wildcard": {
      // Card summary respects the per-instance binding override so a
      // renamed wildcard reads as `$<override>` on the canvas. Engine
      // applies the same precedence at run time.
      const instBind = m.instance?.variable_binding;
      const payloadBinding = (p.var_binding as string | undefined)?.trim();
      const binding = (typeof instBind === "string" && instBind.trim()) || payloadBinding;
      const head: SummaryToken = binding ? v(binding) : lit("wildcard");
      const allOpts = (Array.isArray(p.options) ? p.options : []) as WildcardOption[];
      const total = allOpts.length;
      if (!total) return [head];
      const inst = (m.instance ?? {}) as InstanceLike & { pick_min?: number; pick_max?: number };
      const pmin = typeof inst.pick_min === "number" ? inst.pick_min : 1;
      const pmax = typeof inst.pick_max === "number" ? Math.max(pmin, inst.pick_max) : pmin;
      const multiActive = pmax > 1;
      // "X of Y options" only when a filter / enabled-subset actually narrows
      // the pool — a plain count when nothing is filtering (keeps the common
      // case clean). The null-option drop in multi mode alone never triggers it.
      const hasFilter =
        (typeof inst.category_filter === "string" && inst.category_filter.trim() !== "") ||
        Array.isArray(inst.enabled_options);
      const eligible = allOpts.filter((o) => isEnabled(o, inst, multiActive)).length;
      const tokens: SummaryToken[] = [
        head,
        lit(
          hasFilter && eligible < total
            ? ` · ${eligible} of ${total} options`
            : ` · ${total} option${total === 1 ? "" : "s"}`,
        ),
      ];
      // Multi-pick hint — surface when the instance resolves more than one.
      if (pmax > 1) {
        tokens.push(lit(pmin === pmax ? ` · picks ${pmin}` : ` · picks ${pmin}-${pmax}`));
      }
      return tokens;
    }
    case "combine": {
      // Same per-instance precedence as wildcard: rebinding via the v2
      // modal (`instance.variable_binding`) renders as `$<override>` on
      // the card so the canvas reads match the engine output.
      const inst = m.instance?.variable_binding;
      const payloadOut = (p.output_var as string | undefined)?.trim();
      const out = (typeof inst === "string" && inst.trim()) || payloadOut;
      return out ? [lit("→ "), v(out)] : [lit("template")];
    }
    case "derivation": {
      const rules = Array.isArray(p.rules) ? p.rules.length : 0;
      return [lit(`${rules} rule${rules === 1 ? "" : "s"}`)];
    }
    case "constraint": {
      const cp = p as Partial<{
        source_wildcard_id: string | null;
        target_wildcard_id: string | null;
        matrix: Record<string, Record<string, unknown>>;
      }>;
      const src = lookupSiblingName(cp.source_wildcard_id) ?? "?";
      const tgt = lookupSiblingName(cp.target_wildcard_id) ?? "?";
      const rowKeys = Object.keys(cp.matrix ?? {});
      const colKeys = Object.keys(Object.values(cp.matrix ?? {})[0] ?? {});
      return [v(src), lit(" → "), v(tgt), lit(` · ${rowKeys.length}×${colKeys.length}`)];
    }
    default:             return [lit(m.type)];
  }
}

/** Plain-text fallback — used for `:title` tooltip + a11y text. */
function summaryFor(m: ModuleEntry): string {
  return summaryTokens(m).map((t) => t.text).join("");
}

/** Toolbar counts — total modules + how many are effectively enabled
 *  (each child's own `enabled` AND the bundle gate, when bundled). */
const totalCount = computed(() => value.value.modules.length);
const enabledCount = computed(() => {
  const bundleEnabled = buildBundleEnabledMap(value.value.bundles);
  return value.value.modules.filter((m) => isModuleEffectivelyEnabled(m, bundleEnabled)).length;
});

// ── Node codename chip ──────────────────────────────────────────────────────
// A fixed, read-only CODENAME identifies THIS WP_Context node: a stable
// `adjective-noun` derived from the litegraph node id (node-codename.ts).
// POV-independent + unique on the canvas, and NOT user-editable — cross-node
// UI (constraint reach pick-list, pair popovers) shows the SAME codename to
// name WHICH node a target instance lives in. Replaced the old editable label
// + walk-position A/B/C letter, which shifted by viewer (so two chain heads
// both showed "A") and was editable (so not a stable identifier).
const nodeCodename = computed<string>(() => baseCodename(props.nodeId));

/** Open the SPA dashboard in a new tab. Mirrors `extension/topbar.ts`'s
 *  `openSpa` so widget + topbar both land on the dashboard overview
 *  rather than the wildcards list (which is what the SPA root redirect
 *  resolves to). */
function openSpaLibrary(): void {
  window.open("/wp/dashboard", "_blank", "noopener");
}

const {
  onPickerAdd, removeModule, duplicateModule, moveToEdge, toggleEnabled,
  toggleCollapsed, toggleHold, collapseAll, expandAll, toggleAllEnabled,
  openEditModal, saveEditedModule, revertEditingFrame, rowCtx: opsRowCtx,
} = createModuleOps(widgetState, props, showPicker, editingIdx);

function openContextMenu(ev: MouseEvent, m: ModuleEntry, idx: number) {
  // Phase B: caller passes the row's array index (from v-for) so we
  // operate on the specific sibling rather than the first findIndex
  // match — siblings share `m.id`.
  const list = value.value.modules;
  const i = idx;
  const estW = 180;
  const estH = 220;
  const x = Math.min(ev.clientX, window.innerWidth - estW - 8);
  const y = Math.min(ev.clientY, window.innerHeight - estH - 8);
  // Build the items list dynamically — "Save to library" only shows
  // when the module is missing from the live library AND has a
  // payload to save (inline-created fixed_values without a payload
  // are intentionally excluded; they're already authoritative on the
  // workflow side).
  const items: ContextMenuItem[] = [
    { label: "Edit", icon: "pi-pencil", onSelect: () => openEditModal(idx) },
  ];
  // Quick Hold toggle — kept at the top so it's a 2-click reach
  // (right-click → Hold) instead of opening the editor and digging into
  // Runtime. Only for kinds that honor seed_scope. Hold is base-level;
  // when a loop edit-frame is active it applies to every frame, so we
  // surface it disabled with a hint rather than silently writing it.
  if (isHoldable(m)) {
    const held = isHeld(m);
    const frameActive = currentFrame.value != null;
    items.push({
      label: held ? "Release hold" : "Hold across run",
      icon: "pi-link",
      disabled: frameActive,
      subtitle: frameActive
        ? "Applies to every frame — switch to base to change"
        : held
          ? undefined
          : "Freeze this value for the whole batch",
      onSelect: () => toggleHold(idx),
    });
  }
  // Refresh + Save are mutually exclusive in normal use (a module is
  // either drifted OR missing OR clean), so hiding the inactive entry
  // beats greying it — matches Save's existing conditional-push pattern
  // and keeps the menu shorter.
  if (isDrifted(m)) {
    items.push({
      label: "Refresh from library",
      icon: "pi-refresh",
      // Accented + explained: drift is the state where the menu HAS the fix
      // for the badge the user just saw, so it should say so.
      subtitle: "Library changed since insert — pull the newer version",
      accent: true,
      onSelect: () => { void refreshOne(idx); },
      divider: true,
    });
  }
  // "Push to library" is now always present for any row that has a
  // payload. The unified PushToLibraryModal owns the explicit fork-vs-
  // update choice + the meta editing surface, replacing the older
  // implicit logic that only surfaced when the row was missing from
  // the live library. Inline-created rows still qualify — the modal
  // greys out the "Update existing" button when payload_hash is empty.
  if (!!m.payload) {
    const missing = isMissingFromLibrary(m);
    // Local overrides with no drift → pushing is what the user probably wants.
    // Ranked below `missing` so only one library action ever accents.
    const modified = !missing && !isDrifted(m) && isModified(m);
    let subtitle: string | undefined;
    if (missing) subtitle = "Not linked to a library entry — re-link or add";
    else if (modified) subtitle = "Local edits since insert — save them to the library";
    items.push({
      label: "Push to library…",
      icon: "pi-cloud-upload",
      subtitle,
      accent: missing || modified,
      onSelect: () => openPushToLibrary(idx),
      divider: true,
    });
  }
  // Bundle children get an extra "Reset to bundle snapshot" item that
  // restores THIS row from the parent bundle's frozen library blob.
  // Distinct from "Refresh from library" (which pulls the current
  // library version of the underlying module).
  if ((m as ModuleEntry & { bundle_origin?: string }).bundle_origin) {
    items.push({
      label: "Reset to bundle snapshot",
      icon: "pi-history",
      subtitle: "Restore frozen state from bundle",
      onSelect: () => { void resetChildToBundleSnapshot(idx); },
      divider: true,
    });
  }
  items.push(
    { label: m.enabled ? "Disable" : "Enable", icon: m.enabled ? "pi-eye-slash" : "pi-eye", onSelect: () => toggleEnabled(idx) },
    { label: m.collapsed ? "Expand" : "Collapse", icon: m.collapsed ? "pi-caret-down" : "pi-caret-right", onSelect: () => toggleCollapsed(idx) },
    { label: "Duplicate", icon: "pi-clone", onSelect: () => duplicateModule(idx), divider: true },
  );
  // Wrap-into-new-bundle — only for unbundled rows.
  if (!(m as ModuleEntry & { bundle_origin?: string }).bundle_origin) {
    items.push({
      label: "Wrap into new bundle…",
      icon: "pi-box",
      subtitle: "Create a library bundle from this row",
      onSelect: () => { void wrapIntoNewBundle(idx); },
      divider: true,
    });
  }
  items.push(
    { label: "Move to top", icon: "pi-angle-double-up", disabled: i === 0, onSelect: () => moveToEdge(idx, "top") },
    { label: "Move to bottom", icon: "pi-angle-double-down", disabled: i === list.length - 1, onSelect: () => moveToEdge(idx, "bottom") },
    { label: "Remove", icon: "pi-trash", danger: true, divider: true, onSelect: () => removeModule(idx) },
  );
  ctxMenu.value = {
    visible: true, x: Math.max(8, x), y: Math.max(8, y), items,
    // Scope header — kind icon + "Kind · Name" label. Mirrors the
    // bundle ctxmenu's header so every right-click reads as "you are
    // operating on THIS specific entity". `kindIcon` returns
    // "pi pi-X" (two-class); ContextMenu's template prepends "pi"
    // already, so we strip the leading word to avoid double-prefix.
    header: {
      icon: kindIcon(m.type).split(" ").pop() ?? "pi-circle",
      label: `${KIND_TITLE[m.type] ?? m.type} · ${m.meta.name || "(unnamed)"}`,
      iconColor: `var(--wp-kind-${kindChipModifier(m.type)})`,
    },
  };
}

const topLevelItems = computed(() =>
  buildTopLevelItems(value.value.modules, value.value.bundles ?? []));

const moduleRowCtx: ModuleRowCtx = {
  KIND_TITLE,
  kindIcon, kindChipModifier, varColorClass,
  isCollapsed, isLocked, isInternal, isSeedLockable,
  isModified, isDrifted, isMissingFromLibrary, isTypeConflict,
  severityFor, conflictTooltip, conflictBadgeText,
  modifiedTooltip, summaryFor, summaryTokens, siblingInfo,
  // rowGap, draggingModuleUid, recentDropUids, pulseDelayFor, onDragStart, onDragEnd
  ...dragRowCtx,
  // toggleCollapsed, toggleEnabled, removeModule, toggleLockOnCard,
  // toggleInternalOnCard, onCardKeydown
  ...opsRowCtx,
  openContextMenu,
  pairingFor,
  viaInboundFor,
  contributorsFor,
  currentFrame,
  isHeld,
  isOverriddenOnFrame,
  effectiveLockedSeed,
  effectiveEnabled,
  frameEnableOverride,
};
provide(ModuleRowCtxKey, moduleRowCtx);
// Pools this node holds, for the nested-ref hover card. Provided rather than
// threaded: `RefChip` sits six components below here (row → edit modal →
// section → value chips → preview → chip) and not one layer in between has any
// business knowing about option pools. Recomputes with the module list, so
// picking or removing a wildcard moves the card's numbers immediately.
provide(CONTEXT_POOLS_KEY, computed(() => buildContextPools(value.value.modules)));
// Companion lookup for the same card: when the ref falls back to the library,
// this names any OTHER node holding the pool, so "why isn't it using the one
// I can see right there" has an answer on the card instead of being a puzzle.
provide(FOREIGN_POOL_LOOKUP_KEY, (uuid: string): string[] =>
  props.wildcardHomesReader?.(uuid) ?? []);
// Seed source for the edit-modal's Lock button — resolves the seed the module
// actually rolled (frame #k's captured seed when a frame is active, else the
// last-run seed) so locking pins what the user saw, not a random number.
provide(LockSeedKey, (m: ModuleEntry): number | null => {
  const k = currentFrame.value;
  if (k != null) return props.frameSeedReader?.(k) ?? null;
  return props.lastUsedSeedReader?.(m._uid ?? m.id) ?? null;
});

const bundleFrameCtx: BundleFrameCtx = {
  bundleChildDriftCount,
  isBundleLibraryDrifted,
  isBundleMissingFromLibrary,
  // bundleInternalState, bundleLockState, toggleBundleInternal, toggleBundleLock
  ...masterToggles,
  // Suppressed for an unlinked bundle — there is no insert for its children to
  // have diverged from, so MOD would be diffing against a ghost.
  isBundleSnapshotModified: (b: BundleInstance) =>
    !isBundleUnlinked(b) && bundleSnapshotModified(b, value.value.modules),
  // toggleBundleCollapsed, toggleBundleEnabled, removeBundle
  ...bundleOpsFrameCtx,
  openBundleContextMenu,
  // bundleHeaderGap, isBundleDropTarget, recentDropUids, pulseDelayFor,
  // onBundleDragStart, onDragEnd, dropBarFor
  ...dragFrameCtx,
};
provide(BundleFrameCtxKey, bundleFrameCtx);
</script>

<template>
  <div
    class="wp-context"
    :class="{ 'wp-context--muted': isMuted }"
    :data-mode-label="isMuted ? muteLabel : undefined"
    @dragleave="onContainerLeave"
  >
    <!-- Node identity strip. A fixed, read-only CODENAME naming THIS
         WP_Context node — a stable `adjective-noun` derived from the
         litegraph node id (node-codename.ts). POV-independent + unique on
         the canvas, NOT editable. Cross-node UI (constraint reach pick-list,
         pair popovers) shows the same codename to say WHICH node a target
         lives in. Sits above the toolbar/hero so it shows in every state. -->
    <div class="wp-node-id">
      <span class="wp-node-id__tag">node</span>
      <span
        class="wp-node-id__chip wp-node-id__chip--fixed"
        data-test="node-label"
        :title="`Stable id for this Context node — referenced by cross-node constraint UI (${nodeCodename})`"
      >
        <span class="wp-node-id__text">{{ nodeCodename }}</span>
      </span>
    </div>

    <!-- Corrupt-workflow recovery panel (5.6). Surfaces when JSON parse fails
         or returns a non-object. View raw exposes the bad payload so users
         can copy it out before resetting. -->
    <div v-if="parseError" class="wp-recovery" role="alert">
      <div class="wp-recovery__header">
        <i class="pi pi-exclamation-triangle wp-recovery__icon" aria-hidden="true"></i>
        <div class="wp-recovery__msg">
          <strong>Couldn't read this node's saved data.</strong>
          <div class="wp-recovery__detail">{{ parseError }}</div>
        </div>
      </div>
      <div class="wp-recovery__actions">
        <button type="button" class="wp-recovery__btn" @click="showRaw = !showRaw">
          <i class="pi" :class="showRaw ? 'pi-eye-slash' : 'pi-eye'" aria-hidden="true"></i>
          {{ showRaw ? "Hide raw" : "View raw" }}
        </button>
        <button
          type="button"
          class="wp-recovery__btn wp-recovery__btn--danger"
          @click="resetCorruptValue"
        >
          <i class="pi pi-refresh" aria-hidden="true"></i>
          Reset to empty
        </button>
      </div>
      <pre v-if="showRaw" class="wp-recovery__raw">{{ parseRaw }}</pre>
    </div>

    <!-- Page swap: populated layout vs empty hero. mode="out-in" sequences
         them — the populated block fully fades out before the empty hero
         fades in, so the leaving card and the appearing hero never visually
         stack. Recovery panel + drop-zone live outside the swap. -->
    <Transition name="wp-page" mode="out-in">
      <div
        v-if="!isEmpty"
        key="populated"
        class="wp-page"
        @dragover="onListDragOver"
        @drop="(ev) => onDrop(ev, null)"
      >
        <!-- Toolbar: module count + bulk-drift refresh + collapse/expand/toggle-all. -->
        <div class="wp-w-toolbar">
          <span class="wp-w-toolbar-label">modules</span>
          <span class="wp-w-count">{{ enabledCount }} / {{ totalCount }}</span>

          <!-- Bulk-refresh drifted. Visible only when at least one module
               drifted from its library version; orange accent matches the
               per-card drift dot. -->
          <button
            v-if="driftedCount > 0"
            type="button"
            class="wp-section-label__bulk wp-section-label__bulk--drift"
            :title="`Refresh ${driftedCount} drifted module(s) from the library.`"
            data-testid="bulk-refresh-drifted"
            @click="refreshAllDrifted"
          >
            <i class="pi pi-refresh" aria-hidden="true"></i>
            <span>refresh {{ driftedCount }} drifted</span>
          </button>

          <span class="wp-w-toolbar-spacer" />
          <button
            type="button"
            class="wp-btn--icon-sm"
            title="Collapse all"
            aria-label="Collapse all modules"
            @click="collapseAll"
          ><i class="pi pi-chevron-up" /></button>
          <button
            type="button"
            class="wp-btn--icon-sm"
            title="Expand all"
            aria-label="Expand all modules"
            @click="expandAll"
          ><i class="pi pi-chevron-down" /></button>
          <button
            type="button"
            class="wp-btn--icon-sm"
            title="Toggle all enabled"
            aria-label="Toggle all enabled"
            @click="toggleAllEnabled"
          ><i class="pi pi-eye" /></button>
        </div>

        <div
          ref="modulesContainer"
          class="wp-modules-frame"
        >
        <div
          class="wp-modules"
          :data-suppress-move="suppressMove ? 'true' : null"
        >
        <!-- Floating drop indicator for top-level scope. Hidden when
             the resolved zone targets a nested bundle container — that
             container renders its own BundleDropBar. -->
        <BundleDropBar :container-uid="null" />
      <template v-for="item in topLevelItems" :key="item.key">
        <BundleFrame
          v-if="item.kind === 'bundle'"
          :bundle="item.bundle!"
          :children="item.children!"
          :nested="false"
        />
        <ModuleRow
          v-else
          :module="item.module!"
          :idx="item.idx!"
          :data-uid="item.module!._uid"
        />
      </template>
        </div>
        </div>

        <!-- Footer: primary add + bundle add. Shown only when list is
             non-empty. "Open in SPA" was replaced with "+ Add Bundle"
             when the bundle system shipped — bundles ARE the SPA-side
             reusable scaffolds users typically wanted that button for.
             SPA library still reachable via the right-click context
             menu on any module. -->
        <div
          class="wp-w-footer"
        >
          <button
            class="wp-btn wp-btn--primary"
            data-testid="open-picker"
            @click="openPicker"
          >
            <i class="pi pi-plus" /> Add module
          </button>
          <button
            class="wp-btn"
            data-testid="open-bundle-picker"
            @click="openBundlePicker"
          >
            <i class="pi pi-plus" /> Add Bundle
          </button>
        </div>
      </div>

      <!-- Empty-state hero — shown when modules is empty and there's no
           recovery panel up. Brand glyph + dual CTA (add + SPA link). -->
      <div
        v-else-if="!parseError"
        key="empty"
        class="wp-empty-hero"
        :class="{ 'wp-empty-hero--drop-target': isDropEndZone }"
        data-test="context-empty"
        @dragover="onEmptyHeroDragOver"
        @drop="(ev) => onDrop(ev, null)"
      >
        <!-- eslint-disable-next-line vue/no-v-html — wpLogoSvg is a static
             import from src/components/shared/wp-logo.svg via Vite ?raw,
             not user input. Same pattern as extension/topbar.ts. -->
        <div
          class="wp-empty-hero-glyph"
          aria-hidden="true"
          v-html="wpLogoSvg"
        />
        <div class="wp-empty-hero-title">No modules yet</div>
        <div class="wp-empty-hero-sub">
          Add a wildcard, fixed values pack, combine, derivation or constraint to start
          building this context.
        </div>
        <div class="wp-empty-hero-actions">
          <button
            class="wp-btn wp-btn--primary"
            data-testid="open-picker"
            @click="openPicker"
          >
            <i class="pi pi-plus" /> Add module
          </button>
          <button
            class="wp-btn"
            data-testid="open-bundle-picker"
            @click="openBundlePicker"
          >
            <i class="pi pi-plus" /> Add Bundle
          </button>
        </div>
      </div>
    </Transition>

    <div
      class="wp-drop-end"
      :class="{ 'wp-drop-end--active': isDropEndZone, 'wp-drop-end--show': dragState !== null }"
      @dragover="onEndDragOver"
      @drop="(ev) => onDrop(ev, null)"
    >Drop here</div>

    <ModulePickerModal
      :visible="showPicker"
      :already-added="value.modules.map((m: ModuleEntry) => m.id)"
      :already-added-ids="value.modules.map((m: ModuleEntry) => m.id)"
      @add="onPickerAdd"
      @close="showPicker = false"
    />

    <BundlePickerModal
      :visible="showBundlePicker"
      :already-added-ids="(value.bundles ?? []).map((b) => b.library_id)"
      @pick="onPickBundle"
      @create="openBundleAuthor"
      @close="showBundlePicker = false"
    />

    <ModuleEditModal
      :visible="editingModule !== null"
      :module="editingModule"
      :upstream-vars="upstreamVars"
      :upstream-producers="allVarProducers"
      :upstream-resolved="resolvedForEditing"
      :sibling-vars="siblingNodeVars"
      :sibling-modules="value.modules"
      :chain-modules="chainModules"
      :via-option-pairs="editingModuleViaOptionPairs"
      :last-used-seed-reader="lastUsedSeedReader"
      :current-frame="currentFrame"
      @save="saveEditedModule"
      @close="editingIdx = null"
      @revert-frame="revertEditingFrame"
    />

    <!-- Bundle edit modal — sibling to ModuleEditModal, dispatched
         independently because BundleInstance ≠ ModuleEntry. The live
         bundle drives `lockState` / `internalState` (not the draft)
         since those toggles cascade onto children, mirroring the
         BundleHeader buttons. -->
    <ModalShell :visible="bundleDraft !== null" @close="cancelBundleEdit">
      <BundleInstanceModal
        v-if="bundleDraft !== null && editingBundleEntry"
        :bundle="bundleDraft"
        :library-name="bundleLibraryDefaults?.name ?? ''"
        :library-color="bundleLibraryDefaults?.color ?? null"
        :library-drifted="isBundleLibraryDrifted(editingBundleEntry)"
        :snapshot-modified="bundleSnapshotModified(editingBundleEntry, value.modules)"
        :lock-state="bundleLockState(editingBundleEntry)"
        :internal-state="bundleInternalState(editingBundleEntry)"
        @update="onBundleEditUpdate"
        @save="saveBundleEdit"
        @cancel="cancelBundleEdit"
        @toggle-lock="onBundleEditToggleLock"
        @toggle-internal="onBundleEditToggleInternal"
        @save-to-library="onBundleEditSaveToLibrary"
        @reset-to-library="onBundleEditResetToLibrary"
        @open-spa="cancelBundleEdit"
      />
    </ModalShell>

    <!-- Standalone push-to-library entry point — fires from the
         right-click menu without going through the edit modal first.
         Same component as the one mounted inside ModuleEditModal so
         either path produces identical behavior. -->
    <PushToLibraryModal
      :open="pushOpen"
      :draft="pushDraft"
      @close="onPushClosed"
      @saved="onPushSaved"
    />

    <!-- Bundle-scoped push-to-library modal — same fork/update grammar
         as the module modal, but children list preview instead of a
         JSON payload preview. -->
    <PushBundleToLibraryModal
      :open="pushBundleOpen"
      :bundle="pushBundleDraft"
      :children-for-library="pushBundleChildrenForLibrary"
      :children-preview="pushBundleChildrenPreview"
      :cascade-scan="pushBundleCascadeScan"
      :cascade-restore="pushBundleCascadeRestore"
      @close="onBundlePushClosed"
      @saved="onBundlePushSaved"
    />

    <ContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      :header="ctxMenu.header"
      @close="ctxMenu.visible = false"
    />
    <!-- Shared confirm dialog for destructive bundle ops. `pendingConfirm`
         is set by `maybeConfirm()` when the user has the relevant
         setting enabled; resolves the awaited Promise via the
         onConfirm / onCancel callbacks the helper stamped on the
         state object. -->
    <ConfirmDialog
      v-if="pendingConfirm"
      :visible="true"
      :title="pendingConfirm.title"
      :body="pendingConfirm.body"
      :variant="pendingConfirm.variant"
      :confirm-label="pendingConfirm.confirmLabel"
      :cancel-label="pendingConfirm.cancelLabel"
      @confirm="pendingConfirm.onConfirm"
      @cancel="pendingConfirm.onCancel"
    />
  </div>
</template>

<style>
@import "../shared/theme.css";
@import "../shared/row-primitives.css";
@import "./editors/_modal-head.css";
@import "./editors/_modal-template-ctrls.css";
@import "../shared/_modal-motion.css";
</style>

<style>
/* Unscoped widget styles live in context-widget.css — same cascade as the
 * inline block they came from (NOT layered; see the note at its top). */
@import "./context-widget.css";
</style>
