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
import { buildBundleInsertion, type BundleLibraryEntry } from "./bundles/insert";
import { isEnabled, type WildcardOption, type InstanceLike } from "./editors/wildcard/probability";
import { buildLibraryChildrenWithIntegrity, toChildSnapshot } from "./bundles/save";
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
  snapBundleFingerprints,
} from "./bundles/bundle-fingerprint";
import BundleDropBar from "./bundles/BundleDropBar.vue";
import {
  withLeaveAnimation,
  animateEnterBatch,
  flashRows,
  captureFlipSnapshot,
  playFlipSnapshot,
} from "./bundles/flip";
import { ApiError, api } from "../../manager/api/client";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";
import { emptyBundleInstance, type BundleInstance } from "../../widgets/_shared";
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
  isInternalable,
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
import {
  getBundleCollapsedByDefault,
  getConfirmDestructiveBundle,
} from "../../extension/settings";
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

/** Bundle edit modal — analogous to `editingIdx` but keyed on the
 *  per-Context `_uid` of the bundle instance (bundles don't sit in
 *  `value.modules`, they have their own list). `bundleDraft` is the
 *  deep-cloned snapshot the user edits — cancel discards it, save
 *  writes back into `value.bundles[i]`. `bundleLibraryDefaults`
 *  caches the freshly-fetched library entry's name/color so the
 *  IdentitySection can show per-field "reset to library default"
 *  buttons. Null while the fetch is in flight or when the library
 *  entry is missing (deleted upstream). */
const editingBundleUid = ref<string | null>(null);
const bundleDraft = ref<BundleInstance | null>(null);
const bundleLibraryDefaults = ref<{ name: string; color: string | null } | null>(null);

/** Live BundleInstance the modal is editing — resolved from
 *  `editingBundleUid` against the latest `value.bundles` list so
 *  cascading toggles fired during the modal session reflect into
 *  the master `lockState` / `internalState` props immediately. */
const editingBundleEntry = computed<BundleInstance | null>(() => {
  const uid = editingBundleUid.value;
  if (!uid) return null;
  return (value.value.bundles ?? []).find((b) => b._uid === uid) ?? null;
});

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
  draggingModuleUid, recentDropUids, suppressMove, holdSuppressMove,
  isDropEndZone, rowGap, bundleHeaderGap, isBundleDropTarget, dropBarFor,
  pulseDelayFor, onDragStart, onBundleDragStart, onDragEnd,
  onListDragOver, onEmptyHeroDragOver, onEndDragOver, onContainerLeave, onDrop,
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

/** Fetch a bundle from the library, deserialize its children via the
 *  insert glue, splice into modules[] at the end of the current list,
 *  and push a fresh BundleInstance into bundles[]. Mutating the shared
 *  `value` ref triggers the standard write-back + assembler refresh
 *  path. */
async function onPickBundle(bundleId: string): Promise<void> {
  try {
    const entry = await api.bundles.get(bundleId);
    const libEntry: BundleLibraryEntry = {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      children: entry.children as BundleLibraryEntry["children"],
      payload_hash: entry.payload_hash,
    };
    const insertIdx = value.value.modules.length;
    const { modulesToSplice, bundleInstance, innerInstances } = buildBundleInsertion(libEntry, insertIdx);
    // Honor "Collapse new bundles by default". Default false keeps
    // bundles open on insert (existing behaviour); when true, stamp
    // the collapsed flag so the frame mounts header-only. Inner
    // (nested) bundles inherit the same default so the user sees a
    // consistent collapse state across the whole insert.
    if (getBundleCollapsedByDefault()) {
      bundleInstance.collapsed = true;
      for (const inner of innerInstances) inner.collapsed = true;
    }
    // Mutate via spread to keep the ref's identity stable + trigger
    // Vue reactivity. modules[] gets the new rows at the tail, bundles[]
    // gets the new instance.
    //
    // `modulesToSplice` carries the loose ChildSnapshot shape from
    // uuid-remap (only `id` + `type` typed). Bundle library children
    // are stored as FULL module snapshots at save time — defaults are
    // backfilled here for any fields the bundle editor didn't write
    // explicitly so the spliced row satisfies ModuleEntry at runtime.
    const splice = modulesToSplice.map((c) => {
      const rec = c as Record<string, unknown>;
      const meta = (rec.meta as ModuleEntry["meta"] | undefined) ?? { name: "" };
      const entries = (rec.entries as ModuleEntry["entries"] | undefined) ?? [];
      return {
        id: c.id,
        _uid: c._uid,
        type: c.type as ModuleEntry["type"],
        enabled: (rec.enabled as boolean | undefined) ?? true,
        // Bundle children inserted in their collapsed state per
        // `buildBundleInsertion` — the explicit rebuild above
        // dropped this field; now carried through so the chevron
        // starts in collapsed position.
        collapsed: (rec.collapsed as boolean | undefined) ?? false,
        meta,
        entries,
        payload: c.payload,
        instance: c.instance,
        payload_hash: c.payload_hash,
        bundle_origin: c.bundle_origin,
      } as ModuleEntry;
    });
    commitModules(
      [...value.value.modules, ...splice],
      [...(value.value.bundles ?? []), bundleInstance, ...innerInstances],
    );
    // Snap fingerprints on the freshly-inserted bundles so the local
    // state is recorded as the "clean baseline" — subsequent user
    // edits flip them to modified, post-commit so reconcileBundleRanges
    // has already set the correct start_idx/end_idx for the walk.
    {
      const justInserted = new Set<string>([
        bundleInstance._uid,
        ...innerInstances.map((b) => b._uid),
      ]);
      value.value = {
        ...value.value,
        bundles: snapBundleFingerprints(value.value.bundles ?? [], value.value.modules, justInserted),
      };
    }
    // Phase B.6: animate the new bundle wrapper + its children with
    // the same fade-slide as picker-add. Bundle wrapper carries the
    // same --arriving/--arrived classes thanks to the .wp-bundle CSS
    // selectors. UIDs: bundle._uid + each child._uid.
    await nextTick();
    if (modulesContainer.value) {
      await animateEnterBatch(
        [bundleInstance._uid, ...splice.map(c => c._uid)],
        modulesContainer.value,
      );
    }
    // Delta-undo capture: every _uid we added (modules + outer + inners).
    // Undo filters them out of whatever modules/bundles arrays look like
    // at click time. Composes correctly with any other op's Undo
    // regardless of click order — full-snapshot restore would overwrite
    // a sibling op's state. Without capturing inner uids, undoing a
    // nested-bundle insert orphaned the inner BundleInstances (the outer
    // was removed but its inners stayed, dangling).
    const insertedModuleUids = new Set(splice.map((c) => c._uid).filter((u): u is string => !!u));
    const insertedBundleUids = new Set<string>([
      bundleInstance._uid,
      ...innerInstances.map((b) => b._uid),
    ]);
    pushToast(`Inserted bundle "${entry.name}"`, {
      severity: "success",
      lifeMs: 5000,
      action: {
        label: "Undo",
        onSelect: () => {
          const list = value.value.modules.filter(
            (m) => !m._uid || !insertedModuleUids.has(m._uid),
          );
          const curBundles = value.value.bundles ?? [];
          const nextBundlesArr = curBundles.filter(
            (b) => !insertedBundleUids.has(b._uid),
          );
          commitModules(list, nextBundlesArr);
        },
      },
    });
  } catch (e) {
    // Surface fetch / parse errors via the existing toast channel so
    // users see what went wrong without diving into devtools.
    const msg = e instanceof Error ? e.message : String(e);
    pushToast(`Bundle insert failed: ${msg}`, { severity: "error" });
  }
}

/** Stub — opens SPA in author-mode to create a new bundle. v1 routes
 *  to /bundles/new; SPA wires up the editor in Phase 4. */
function openBundleAuthor(): void {
  openSpaLibrary();   // Reuse existing SPA link for v1 — Phase 4 deep-links to bundle editor
}

function toggleBundleCollapsed(uid: string): void {
  const bundles = value.value.bundles ?? [];
  const idx = bundles.findIndex((b) => b._uid === uid);
  if (idx < 0) return;
  const updated = { ...bundles[idx], collapsed: !bundles[idx].collapsed };
  const next = [...bundles];
  next[idx] = updated;
  value.value = { ...value.value, bundles: next };
}

function toggleBundleEnabled(uid: string, enabled: boolean): void {
  const bundles = value.value.bundles ?? [];
  const bIdx = bundles.findIndex((b) => b._uid === uid);
  if (bIdx < 0) return;
  const updated = { ...bundles[bIdx], enabled };
  const nextBundles = [...bundles];
  nextBundles[bIdx] = updated;
  // Bundle.enabled is a gate, not a mutator. Children keep their own
  // instance.enabled state untouched — re-enabling the bundle restores
  // every child to its previous individual on/off. The engine sees the
  // gated view via `deserialize_node_input` (wp_nodes/types.py), which
  // ANDs bundle.enabled with each child's enabled at execute time. The
  // renderer dims the disabled bundle's children via CSS at the bundle
  // level (.wp-bundle--disabled overlay), no per-row class change.
  commitModules(value.value.modules, nextBundles);
}

async function removeBundle(uid: string): Promise<void> {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  const bundleName = target.name || "bundle";
  if (!(await maybeConfirm({
    title: `Remove "${bundleName}"?`,
    body: `Removes the bundle frame and all ${target.end_idx - target.start_idx + 1} child(ren) from this Context. Toast Undo will restore them if clicked before it expires.`,
    variant: "danger",
    confirmLabel: "Remove",
  }))) return;
  // Delta-undo capture: keep the actual child refs (with bundle_origin
  // intact) so re-insertion restores complete module shape, plus an
  // anchor `_uid` for the module that NOW sits immediately after the
  // bundle. Splicing relative to that anchor on undo lands the
  // restored children near their original position even if a sibling
  // op moved things around between remove and Undo. Full-snapshot
  // restore breaks composition: undoing two removes out of order
  // would leave only the last-clicked snapshot's effect intact.
  const removedChildren = value.value.modules.slice(target.start_idx, target.end_idx + 1);
  const anchorAfter = value.value.modules[target.end_idx + 1]?._uid ?? null;
  const restoredBundle = target;
  // Capture nested BundleInstances under this outer so undo restores
  // them too. Without this, Undo brings back the leaves + outer frame
  // but the inner frames vanish permanently, surfacing every
  // inner-leaf as a direct child of the outer instead.
  const restoredInners = bundles.filter((b) => b.parent_uid === uid);

  // Suppress legacy wp-list-move + leave-active CSS immediately so any
  // downstream layout shifts during the fade don't double-animate via
  // the old TransitionGroup leftover rule. (#8 regression test asserts
  // data-suppress-move="true" lands synchronously after the call.)
  holdSuppressMove();

  // Phase B.6: fade the bundle wrapper out via --leaving before the
  // splice. Bundle CSS responds to --leaving so the whole frame slides
  // + fades together. Wait MOTION_FADE_MS, then mutate.
  const scope = modulesContainer.value;
  if (scope) {
    await withLeaveAnimation(uid, scope, () => {});
  }

  const flipSnap = captureFlipSnapshot(modulesContainer.value);
  // Drop all child modules in [start_idx..end_idx] from the flat
  // modules array AND drop the BundleInstance itself.
  const before = value.value.modules.slice(0, target.start_idx);
  const after = value.value.modules.slice(target.end_idx + 1);
  const removedCount = target.end_idx - target.start_idx + 1;
  // Walk parent_uid descendants of the targeted bundle — every nested
  // bundle inside this frame goes with it. Without this drop, the inner
  // BundleInstance survives the removal with a parent_uid pointing at a
  // deleted bundle, the renderer never picks it up as top-level (because
  // it still has parent_uid), and the leaves it pointed at are gone
  // anyway. Net result: orphaned BundleInstance + ghost in bundles[].
  const removedUids = new Set<string>([uid]);
  // BFS over parent_uid pointers — tier-2 cap → at most one hop, but
  // walk generically in case the model gains depth later.
  let frontier = [uid];
  for (let safety = 0; safety < 8 && frontier.length > 0; safety++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const b of bundles) {
        if (b.parent_uid === f && !removedUids.has(b._uid)) {
          removedUids.add(b._uid);
          next.push(b._uid);
        }
      }
    }
    frontier = next;
  }
  // Adjust any sibling bundle indices that sit after the removed range.
  const remainingBundles = bundles
    .filter((b) => !removedUids.has(b._uid))
    .map((b) => {
      if (b.start_idx > target.end_idx) {
        return {
          ...b,
          start_idx: b.start_idx - removedCount,
          end_idx: b.end_idx - removedCount,
        };
      }
      return b;
    });
  commitModules([...before, ...after], remainingBundles);
  await nextTick();
  playFlipSnapshot(flipSnap);
  pushToast(`Removed bundle "${bundleName}"`, {
    severity: "info",
    lifeMs: 6000,
    action: {
      label: "Undo",
      onSelect: () => {
        // Find the anchor in current state. If it moved or vanished,
        // fall back to end-of-list. Splice children + restore the
        // BundleInstance; reconcile pins the new range via the
        // children's bundle_origin field.
        const current = value.value.modules;
        const anchorIdx = anchorAfter
          ? current.findIndex((m) => m._uid === anchorAfter)
          : -1;
        const insertAt = anchorIdx >= 0 ? anchorIdx : current.length;
        const list = [
          ...current.slice(0, insertAt),
          ...removedChildren,
          ...current.slice(insertAt),
        ];
        const curBundles = value.value.bundles ?? [];
        // Restore the outer + every inner BundleInstance the remove
        // dropped along with it. Skips entries that already exist
        // (e.g. user undid a sibling op that recreated the inner).
        const present = new Set(curBundles.map((b) => b._uid));
        const toRestore = [restoredBundle, ...restoredInners].filter(
          (b) => !present.has(b._uid),
        );
        const nextBundlesArr = toRestore.length > 0
          ? [...curBundles, ...toRestore]
          : curBundles;
        commitModules(list, nextBundlesArr);
      },
    },
  });
}

/** Detach bundle frame — keep children as standalone modules but
 *  drop the bundle instance + clear `bundle_origin` on each child.
 *  Useful when user wants to keep what's inside but no longer wants
 *  the group wrapping. */
async function detachBundle(uid: string): Promise<void> {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  const bundleName = target.name || "bundle";
  // Phase B.6 polish: fade the bundle wrapper out via --leaving before
  // the splice. Symmetry with removeBundle — wrapper disappears with a
  // visual exit, children stay (they will rise via FLIP into the gap).
  const scope = modulesContainer.value;
  if (scope) {
    await withLeaveAnimation(uid, scope, () => {});
  }
  const flipSnap = captureFlipSnapshot(modulesContainer.value);
  // Nested-bundle handling: inner BundleInstances (parent_uid ===
  // target._uid) survive the detach. They're promoted to top-level
  // (parent_uid → null) so the inner frame stays intact and grouped —
  // the user only asked to remove THIS bundle's wrapper, not flatten
  // the whole tree.
  const innerBundles = bundles.filter((b) => b.parent_uid === target._uid);
  const innerUids = new Set(innerBundles.map((b) => b._uid));
  // When detaching an INNER bundle (one with a parent_uid), its
  // direct children should remain inside the OUTER bundle, not
  // escape to top-level. We re-tag their `bundle_origin` to the
  // outer's `_uid` so the outer frame keeps owning them. When the
  // target is itself top-level (parent_uid null/absent), the
  // children simply lose their origin tag as before.
  const parentUid = target.parent_uid ?? null;
  // Track which children we cleared `bundle_origin` on. Keyed by
  // per-instance _uid so the Undo path can find the same rows even
  // if they've moved since detach — full-snapshot restore breaks the
  // moment a sibling op lands between detach and Undo (snapshot
  // reflects sibling's pre-state too and the user loses the sibling
  // op's effect). Delta-undo only re-stamps these specific children
  // so each detach's Undo composes regardless of click order.
  const detachedChildUids = new Set<string>();
  const nextModules = value.value.modules.map((m, idx) => {
    if (idx < target.start_idx || idx > target.end_idx) return m;
    const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
    // Inner-bundle children of THIS bundle keep their `bundle_origin`
    // so the inner frame still owns them after this bundle detaches.
    if (origin && innerUids.has(origin)) return m;
    if (m._uid) detachedChildUids.add(m._uid);
    const next = { ...m } as ModuleEntry & { bundle_origin?: string };
    if (parentUid) {
      // Re-tag to the surviving outer bundle so children stay
      // grouped inside it. Detaching the inner just dissolves
      // the inner frame — outer still wraps everything.
      next.bundle_origin = parentUid;
    } else {
      // Top-level detach: children become free-floating siblings.
      delete next.bundle_origin;
    }
    return next;
  });
  const remainingBundles = bundles
    .filter((b) => b._uid !== uid)
    .map((b) => (innerUids.has(b._uid) ? { ...b, parent_uid: null } : b));
  // Capture the BundleInstance as it was BEFORE the strip so Undo can
  // reinsert the original library_id, color, name, collapsed flag,
  // inserted_at_hash, etc. without re-fetching from the library API.
  const detachedBundle = target;
  commitModules(nextModules, remainingBundles);
  await nextTick();
  playFlipSnapshot(flipSnap);
  pushToast(`Detached bundle "${bundleName}"`, {
    severity: "info",
    lifeMs: 5000,
    action: {
      label: "Undo",
      onSelect: () => {
        // Re-stamp bundle_origin on the children currently matching
        // the tracked _uids — operates on whatever state the widget is
        // in now, NOT on a snapshot. If some children have been moved
        // apart since detach, reconcile will see them as non-contiguous
        // and dissolve the bundle naturally. That's a degradation, not
        // a corruption — sibling ops keep their effects.
        const list = value.value.modules.map((m) => {
          if (!m._uid || !detachedChildUids.has(m._uid)) return m;
          return { ...m, bundle_origin: detachedBundle._uid } as ModuleEntry & { bundle_origin?: string };
        });
        const currentBundles = value.value.bundles ?? [];
        // Re-insert the BundleInstance only if it isn't already back
        // (idempotent — guards against double-click Undo) AND re-pin
        // any inner bundles' parent_uid back to this outer's _uid.
        // The detach promoted them to top-level (parent_uid → null);
        // Undo restores the nesting.
        const restoredBundles = currentBundles.some((b) => b._uid === detachedBundle._uid)
          ? currentBundles
          : [...currentBundles, detachedBundle];
        const nextBundlesArr = restoredBundles.map((b) =>
          innerUids.has(b._uid) ? { ...b, parent_uid: detachedBundle._uid } : b,
        );
        commitModules(list, nextBundlesArr);
      },
    },
  });
}

/** True duplicate — clones the bundle's CURRENT in-Context state
 *  (including every local edit on children, the per-instance name
 *  / color overrides, the collapsed flag, and any inner bundles)
 *  and splices the clone immediately after the original.
 *
 *  Previously this delegated to `onPickBundle(target.library_id)`
 *  which re-fetched the LIBRARY snapshot — useful as an "insert
 *  again" affordance but not as a "duplicate". User-reported: if
 *  you'd renamed, recolored, locked seeds, marked rows internal,
 *  etc., none of that survived through the duplicate. The
 *  semantically correct "duplicate" is `deepClone(target +
 *  range)` with fresh `_uid`s + an updated bundle_origin /
 *  parent_uid mapping.
 *
 *  Fresh `_uid`s for every cloned row and bundle so the clone
 *  doesn't share identity with the original — drag, MOD, undo,
 *  cascade-state aggregation all key off `_uid`.
 */
async function duplicateBundle(uid: string): Promise<void> {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  const modules = value.value.modules;
  const flipSnap = captureFlipSnapshot(modulesContainer.value);
  // Slice the current child range (deep clone for safety — the
  // engine + drift store both hold references to module objects).
  const sliceClone = modules
    .slice(target.start_idx, target.end_idx + 1)
    .map((m) => JSON.parse(JSON.stringify(m)) as ModuleEntry & { bundle_origin?: string });
  // Build uid maps: every outer + inner BundleInstance in scope
  // gets a fresh `_uid`; the row clones rewrite `bundle_origin`
  // through the map so the clone's row → bundle membership mirrors
  // the original. Inner BundleInstances also rewrite `parent_uid`
  // through the map.
  const newOuterUid = newRowUid();
  const innerBundles = bundles.filter((b) => b.parent_uid === target._uid);
  const uidMap = new Map<string, string>();
  uidMap.set(target._uid, newOuterUid);
  for (const inner of innerBundles) uidMap.set(inner._uid, newRowUid());
  // Update each cloned row's bundle_origin + give it a fresh _uid.
  const insertStart = target.end_idx + 1;
  const clonedRows = sliceClone.map((m) => {
    const origin = m.bundle_origin;
    return {
      ...m,
      _uid: newRowUid(),
      bundle_origin: origin && uidMap.has(origin) ? uidMap.get(origin)! : newOuterUid,
    } as ModuleEntry & { bundle_origin?: string };
  });
  // Splice the clone immediately after the original; shift every
  // later bundle's index range by the clone length.
  const cloneLen = clonedRows.length;
  const before = modules.slice(0, insertStart);
  const after = modules.slice(insertStart);
  const nextModules = [...before, ...clonedRows, ...after];
  // Preserve the source's nesting: when the user duplicates an INNER
  // bundle, the clone must land alongside the original (same parent).
  // Hardcoding null here detached the clone, and worse the parent's
  // range never got extended below — outer bundle's end_idx stopped
  // at the original inner's end, so the cloned rows fell OUT of the
  // outer's range and the outer's bookkeeping diverged from reality.
  const targetParentUid = target.parent_uid ?? null;
  // Build cloned BundleInstance for outer + each inner.
  const clonedOuter: BundleInstance = {
    ...target,
    _uid: newOuterUid,
    start_idx: insertStart,
    end_idx: insertStart + cloneLen - 1,
    parent_uid: targetParentUid,
    // Snapshot fingerprint deliberately UNSET — the clone may
    // diverge from the original immediately. `ensureBundleFingerprints`
    // backfills the clean baseline on the next commit so a fresh
    // clone reads "not modified".
    snapshot_fingerprint: undefined,
  };
  const clonedInners: BundleInstance[] = innerBundles.map((inner) => {
    const newUid = uidMap.get(inner._uid)!;
    // Inner index range shifts by the same `+insertStart - target.start_idx`
    // offset every row in the clone did.
    const shift = insertStart - target.start_idx;
    return {
      ...inner,
      _uid: newUid,
      parent_uid: newOuterUid,
      start_idx: inner.start_idx + shift,
      end_idx: inner.end_idx + shift,
      snapshot_fingerprint: undefined,
    };
  });
  // Three-rule index shift for existing bundles:
  //   1. The duplicated bundle's PARENT (if any) extends end_idx by
  //      cloneLen so the cloned sibling stays inside its range — the
  //      standard "shift if end_idx >= insertStart" rule doesn't catch
  //      this when the target is the parent's last child (parent.end_idx
  //      == insertStart - 1 in that case).
  //   2. Any other bundle starting at or after insertStart shifts both
  //      start_idx and end_idx by cloneLen (it's entirely after the
  //      insertion).
  //   3. A bundle straddling the insertion (start_idx < insertStart <=
  //      end_idx) shifts only end_idx — the cloned rows landed inside it.
  const nextBundles = bundles.map((b) => {
    if (targetParentUid && b._uid === targetParentUid) {
      return { ...b, end_idx: b.end_idx + cloneLen };
    }
    if (b.start_idx >= insertStart) {
      return { ...b, start_idx: b.start_idx + cloneLen, end_idx: b.end_idx + cloneLen };
    }
    if (b.end_idx >= insertStart) {
      return { ...b, end_idx: b.end_idx + cloneLen };
    }
    return b;
  });
  commitModules(nextModules, [...nextBundles, clonedOuter, ...clonedInners]);
  await nextTick();
  // Sibling rows shift via FLIP, the cloned outer (and any inner
  // clones) slide-in via animateEnterBatch. Matches wrapIntoNewBundle's
  // motion grammar so all bundle-shape mutations read the same.
  playFlipSnapshot(flipSnap);
  if (modulesContainer.value) {
    const enterUids = [newOuterUid, ...clonedInners.map((b) => b._uid)];
    void animateEnterBatch(enterUids, modulesContainer.value);
  }
  pushToast(`Duplicated "${target.name || "bundle"}" with local edits`, {
    severity: "success",
    lifeMs: 4000,
  });
}

/** Human message for a failed bundle-snapshot fetch. A 404 means the
 *  library row is gone (deleted, or re-imported under a fresh uuid), which
 *  the raw API text doesn't say — and re-linking, not retrying, is the fix.
 *  Anything else falls back to the raw message. */
function bundleResetErrorMessage(e: unknown, name: string): string {
  if (e instanceof ApiError && e.status === 404) {
    return `Can't reset "${name || "bundle"}" — its library bundle no longer exists. Re-link it first.`;
  }
  return `Reset failed: ${e instanceof Error ? e.message : String(e)}`;
}

/** Reset bundle to library snapshot — re-fetch the library entry
 *  + replace current children with the frozen blob. Drops any user
 *  edits made to bundle children since insert. Confirms first since
 *  it's destructive. */
async function resetBundleToLibrary(uid: string): Promise<void> {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  // Guard: a detached/unlinked instance (empty library_id — e.g. a bundle
  // whose section was never linked, or whose library row was re-imported
  // under a new uuid) has nothing to fetch. Refuse instead of fetching an
  // empty snapshot and wiping the live children. Re-link is the recovery.
  if (!target.library_id) {
    pushToast(
      `Can't reset "${target.name || "bundle"}" — it isn't linked to a library bundle. Re-link it first.`,
      { severity: "error" },
    );
    return;
  }
  // Delta-undo capture: keep the old child refs (their _uids will be
  // discarded by the reset since the new library snapshot stamps
  // fresh ones, but the BundleInstance _uid we re-find by below
  // stays stable). The bundle's `_uid` is the join key — Undo finds
  // the BundleInstance currently bearing it (whatever its range is
  // now) and replaces the live child range with our captured slice.
  // Full-snapshot restore would overwrite any sibling op's state on
  // click; delta-undo composes.
  const restoredBundleUid = target._uid;
  const oldChildren = value.value.modules.slice(target.start_idx, target.end_idx + 1);
  if (!(await maybeConfirm({
    title: `Reset "${target.name || "bundle"}" to library?`,
    body: "Drops every local edit on this bundle's children and replaces them with the library snapshot. Toast Undo restores your edits if clicked in time.",
    variant: "danger",
    confirmLabel: "Reset",
  }))) return;
  // Themed confirm above replaces the legacy `window.confirm` path —
  // ComfyUI hosts can suppress the native dialog AND it looked out of
  // place against the WP styling. The op is recoverable via Undo, but
  // the confirm gates accidental resets on bundles with significant
  // local work.
  try {
    const entry = await api.bundles.get(target.library_id);
    // Guard: never wipe the live children with an empty snapshot. A valid
    // library bundle always resolves at least one child; an empty/missing
    // `children` means the fetch resolved to the wrong shape (broken link,
    // list wrapper, stale row). Abort the destructive replace + tell the user.
    if (!Array.isArray(entry.children) || entry.children.length === 0) {
      pushToast(
        `Can't reset "${target.name || "bundle"}" — the library snapshot came back empty (its link may be broken). Re-link the bundle instead.`,
        { severity: "error" },
      );
      return;
    }
    const libEntry: BundleLibraryEntry = {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      children: entry.children as BundleLibraryEntry["children"],
      payload_hash: entry.payload_hash,
    };
    // Replace the current bundle's child range with the freshly
    // deserialized library snapshot. Preserve the BundleInstance
    // _uid + position so the overlay doesn't visually re-appear
    // elsewhere; we just replace its content.
    const startIdx = target.start_idx;
    const replacementInsertion = buildBundleInsertion(libEntry, startIdx);
    // buildBundleInsertion mints a brand-new outer + brand-new inners.
    // For reset, we discard the new outer's identity (re-use `target._uid`
    // so the frame stays put) but KEEP each fresh inner's identity
    // (they're genuinely new bundles even from the user's perspective —
    // the old inners' state is being overwritten).
    //
    // Identifying outer-leaves vs inner-leaves in modulesToSplice: every
    // outer-leaf was stamped with `freshOuterUid`; every inner-leaf was
    // stamped with one of the `innerInstances[k]._uid`s. So a child
    // whose `bundle_origin === freshOuterUid` is an outer-leaf and
    // needs remapping to `target._uid`; everything else is an
    // inner-leaf whose origin already points at the fresh inner it
    // belongs to.
    const freshOuterUid = replacementInsertion.bundleInstance._uid;
    // Preserve existing child `_uid`s where the position carries over
    // — buildBundleInsertion mints fresh uids by default, but reset
    // semantically replaces the SAME row with its library snapshot.
    // Keeping uids stable matters for nested bundles: the outer
    // bundle's fingerprint walks every leaf uid in its index range,
    // and a uid churn on reset would flip the outer to "modified"
    // even when the reset was the only outstanding edit. Fresh uids
    // only get minted for positions the new snapshot adds beyond the
    // old child count (i.e. the library snapshot grew since insert).
    const newChildren = replacementInsertion.modulesToSplice.map((c, i) => {
      const rec = c as Record<string, unknown>;
      const meta = (rec.meta as ModuleEntry["meta"] | undefined) ?? { name: "" };
      const entries = (rec.entries as ModuleEntry["entries"] | undefined) ?? [];
      const origin = c.bundle_origin === freshOuterUid ? target._uid : c.bundle_origin;
      const preservedUid = oldChildren[i]?._uid ?? c._uid;
      return {
        id: c.id,
        _uid: preservedUid,
        type: c.type as ModuleEntry["type"],
        enabled: (rec.enabled as boolean | undefined) ?? true,
        collapsed: (rec.collapsed as boolean | undefined) ?? false,
        meta,
        entries,
        payload: c.payload,
        instance: c.instance,
        payload_hash: c.payload_hash,
        bundle_origin: origin,
      } as ModuleEntry;
    });
    // Inner BundleInstances: rewrite their parent_uid from the freshly
    // minted outer to the existing outer so the nested frames sit
    // inside the preserved bundle wrapper.
    const newInnerInstances = replacementInsertion.innerInstances.map((b) => ({
      ...b,
      parent_uid: target._uid,
    }));
    const before = value.value.modules.slice(0, startIdx);
    const after = value.value.modules.slice(target.end_idx + 1);
    const sizeDelta = newChildren.length - (target.end_idx - target.start_idx + 1);
    // Update bundle range to match new children length + shift
    // later bundles by the delta.
    const nextBundles = bundles
      // Drop the OLD inner bundles attached to this outer — the new
      // insertion replaces them wholesale with fresh inner instances.
      .filter((b) => b.parent_uid !== target._uid)
      .map((b) => {
      if (b._uid === uid) {
        return {
          ...b,
          end_idx: startIdx + newChildren.length - 1,
          inserted_at_hash: entry.payload_hash,
        };
      }
      if (b.start_idx > target.end_idx) {
        return {
          ...b,
          start_idx: b.start_idx + sizeDelta,
          end_idx: b.end_idx + sizeDelta,
        };
      }
      return b;
    });
    commitModules([...before, ...newChildren, ...after], [...nextBundles, ...newInnerInstances]);
    // Re-snap fingerprints for the outer + every fresh inner so the
    // reset registers as the new clean baseline. Without this, MOD
    // would stay true after reset (current state != stale fingerprint
    // from previous insert).
    //
    // NOTE: the PARENT bundle (when this one is nested) is deliberately
    // NOT re-snapped here. Resetting a single inner bundle shouldn't
    // baseline the outer's MOD state — if siblings of the inner are
    // still locally edited, the outer correctly stays modified.
    // Instead, child `_uid`s are preserved across the reset below
    // (oldChildren[i]._uid reused for newChildren[i]) so the outer's
    // existing fingerprint can be re-evaluated against the new state
    // and clear itself iff the inner reset was the only outstanding
    // edit.
    {
      const justReset = new Set<string>([
        target._uid,
        ...newInnerInstances.map((b) => b._uid),
      ]);
      value.value = {
        ...value.value,
        bundles: snapBundleFingerprints(value.value.bundles ?? [], value.value.modules, justReset),
      };
    }
    await nextTick();
    // Flash every fresh child + the bundle wrapper so the user sees
    // which rows just got replaced with the library snapshot.
    if (modulesContainer.value) {
      void flashRows(
        [target._uid, ...newChildren.map(c => c._uid)],
        modulesContainer.value,
      );
    }
    pushToast(`Reset "${entry.name}" to library`, {
      severity: "success",
      lifeMs: 6000,
      action: {
        label: "Undo",
        onSelect: () => {
          // Find the BundleInstance in current state (may have moved
          // since reset). If it's gone, do nothing — sibling ops kept
          // their effects, but the bundle frame can't be restored
          // without it.
          const liveBundles = value.value.bundles ?? [];
          const live = liveBundles.find((b) => b._uid === restoredBundleUid);
          if (!live) return;
          const liveModules = value.value.modules;
          const list = [
            ...liveModules.slice(0, live.start_idx),
            ...oldChildren,
            ...liveModules.slice(live.end_idx + 1),
          ];
          commitModules(list, liveBundles);
        },
      },
    });
  } catch (e) {
    pushToast(bundleResetErrorMessage(e, target.name), { severity: "error" });
  }
}

/** Reset a single bundle child to its library-snapshot version.
 *  Looks up the parent BundleInstance via the child's `bundle_origin`,
 *  fetches the bundle library entry, picks the snapshot at the same
 *  position-within-bundle, and replaces just THIS child's payload +
 *  instance. Other children untouched. */
async function resetChildToBundleSnapshot(idx: number): Promise<void> {
  const m = value.value.modules[idx];
  if (!m) return;
  const originUid = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
  if (!originUid) return;
  const bundles = value.value.bundles ?? [];
  const bundle = bundles.find((b) => b._uid === originUid);
  if (!bundle) return;
  const posInBundle = idx - bundle.start_idx;
  if (posInBundle < 0) return;
  // Guard: mirrors resetBundleToLibrary. An unlinked/detached BundleInstance
  // carries an empty `library_id`; fetching it builds `/wp/api/bundles/` whose
  // trailing slash normalizes to the collection route, so aiohttp reports
  // "No such API route: /wp/api/bundles" — a nonsense message for the user.
  // Refuse up front and name the real recovery.
  if (!bundle.library_id) {
    pushToast(
      `Can't reset "${bundle.name || "bundle"}" children — it isn't linked to a library bundle. Re-link it first.`,
      { severity: "error" },
    );
    return;
  }
  // Delta-undo capture: the original module ref keeps its `_uid` so
  // Undo can find it in live state regardless of position. Reset
  // only swaps payload/instance/payload_hash; the _uid stays put,
  // so re-applying the captured ref by uid is a clean inverse.
  const originalModule = m;
  const targetUid = m._uid;
  const childName = m.meta?.name?.trim() || m.type;
  try {
    const entry = await api.bundles.get(bundle.library_id);
    const snapshot = entry.children[posInBundle] as Record<string, unknown> | undefined;
    if (!snapshot) {
      pushToast(`No snapshot at position ${posInBundle}`, { severity: "error" });
      return;
    }
    const nextModules = value.value.modules.map((existing, i) => {
      if (i !== idx) return existing;
      return {
        ...existing,
        payload: snapshot.payload as Record<string, unknown> | undefined,
        instance: snapshot.instance as ModuleEntry["instance"],
        payload_hash: snapshot.payload_hash as string | undefined,
      } as ModuleEntry;
    });
    commitModules(nextModules);
    pushToast(`Reset "${childName}" to bundle snapshot`, {
      severity: "success",
      lifeMs: 5000,
      action: {
        label: "Undo",
        onSelect: () => {
          if (!targetUid) return;
          const list = value.value.modules.map((live) =>
            live._uid === targetUid ? originalModule : live,
          );
          commitModules(list);
        },
      },
    });
  } catch (e) {
    pushToast(bundleResetErrorMessage(e, bundle.name), { severity: "error" });
  }
}

/** Wrap THIS module into a new library bundle (single-row v1).
 *  Users can drag more modules into the range afterwards — the
 *  range-integrity logic handles extension automatically.
 *
 *  Bundle name auto-derived from the wrapped module's display name
 *  (falls back to "New Bundle"). ComfyUI's frontend host suppresses
 *  `window.prompt` in some environments — replacing it with a default
 *  + post-rename via the SPA editor keeps the wrap atomic and never
 *  silently aborts. */
async function wrapIntoNewBundle(idx: number): Promise<void> {
  const m = value.value.modules[idx];
  if (!m) return;
  const name = m.meta?.name?.trim() || "New Bundle";
  const flipSnap = captureFlipSnapshot(modulesContainer.value);
  try {
    const entry = await api.bundles.create({
      name, color: null, children: [toChildSnapshot(m)],
    });
    const bundleInstance: BundleInstance = {
      ...emptyBundleInstance(entry.id),
      start_idx: idx, end_idx: idx,
      inserted_at_hash: entry.payload_hash,
      name: entry.name, color: entry.color ?? null,
    };
    const nextModules = value.value.modules.map((existing, i) =>
      i === idx ? { ...existing, bundle_origin: bundleInstance._uid } as ModuleEntry : existing,
    );
    commitModules(
      nextModules,
      [...(value.value.bundles ?? []), bundleInstance],
    );
    // Snap fingerprint on the freshly-wrapped bundle so its MOD
    // indicator starts clean (matches what we just published to lib).
    value.value = {
      ...value.value,
      bundles: snapBundleFingerprints(
        value.value.bundles ?? [],
        value.value.modules,
        new Set([bundleInstance._uid]),
      ),
    };
    await nextTick();
    // Sibling rows shift to accommodate the new bundle wrapper around
    // the wrapped row. Bundle wrapper fades-slides in; the wrapped
    // module flashes (green ring) to confirm 'this is what just got
    // wrapped'.
    playFlipSnapshot(flipSnap);
    if (modulesContainer.value) {
      void animateEnterBatch([bundleInstance._uid], modulesContainer.value);
      void flashRows([m._uid], modulesContainer.value, 0);
    }
    pushToast(`Wrapped into "${entry.name}" — rename in Library editor`, { severity: "success" });
  } catch (e) {
    pushToast(`Wrap failed: ${e instanceof Error ? e.message : String(e)}`, { severity: "error" });
  }
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

// Pending confirm-dialog state. Single slot — only one destructive op
// can be in flight at a time, and the bundle ctxmenu / header buttons
// are synchronous enough that overlapping calls don't happen in
// practice. `maybeConfirm` resolves through a Promise so the call site
// can await it and decide whether to proceed.
const pendingConfirm = ref<{
  title: string;
  body: string;
  variant: "default" | "danger";
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
} | null>(null);

interface MaybeConfirmOpts {
  title: string;
  body: string;
  variant?: "default" | "danger";
  confirmLabel?: string;
  cancelLabel?: string;
}

/** Show the themed ConfirmDialog if the user has the
 *  "Confirm destructive bundle actions" setting enabled, otherwise
 *  resolve immediately to `true`. Returned Promise resolves to the
 *  user's choice (true = proceed, false = cancel). Call sites pattern:
 *
 *      if (!(await maybeConfirm({ title, body, variant: "danger" }))) return;
 */
function maybeConfirm(opts: MaybeConfirmOpts): Promise<boolean> {
  if (!getConfirmDestructiveBundle()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    pendingConfirm.value = {
      title: opts.title,
      body: opts.body,
      variant: opts.variant ?? "default",
      confirmLabel: opts.confirmLabel ?? "Confirm",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      onConfirm: () => {
        pendingConfirm.value = null;
        resolve(true);
      },
      onCancel: () => {
        pendingConfirm.value = null;
        resolve(false);
      },
    };
  });
}

/** Tri-state aggregation of `instance.internal` across a bundle's
 *  children. Drives the master-toggle visual in BundleHeader:
 *    - "all"     → every child has internal=true (button pressed)
 *    - "none"    → no child has internal (button neutral)
 *    - "partial" → mixed (button half-pressed, dashed border)
 *
 *  Empty bundle defaults to "none" — the button is harmless to show
 *  but clicking it does nothing (no children to flip). */
function bundleInternalState(
  bundle: BundleInstance,
): "all" | "none" | "partial" | null {
  const mods = value.value.modules;
  let on = 0;
  let total = 0;
  for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
    // Skip kinds that don't support the internal flag (constraint).
    // Otherwise a bundle of one constraint + N internal wildcards
    // would read "partial" forever — the constraint is non-applicable,
    // not "not internal yet." Same skip applied in
    // `toggleBundleInternal` so the cascade matches the aggregation.
    if (!isInternalable(mods[i])) continue;
    total++;
    if (isInternal(mods[i])) on++;
  }
  if (total === 0) return null;
  if (on === 0) return "none";
  if (on === total) return "all";
  return "partial";
}

/** Same shape over `locked_seed`, but only the seed-lockable
 *  children count. Returns `null` when the bundle has zero lockable
 *  children — BundleHeader uses that to hide the lock button so a
 *  bundle of fixed_values + constraints (which can't be seed-locked)
 *  doesn't render a no-op control. */
function bundleLockState(
  bundle: BundleInstance,
): "all" | "none" | "partial" | null {
  const mods = value.value.modules;
  let on = 0;
  let total = 0;
  for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
    if (!isSeedLockable(mods[i])) continue;
    total++;
    if (isLocked(mods[i])) on++;
  }
  if (total === 0) return null;
  if (on === 0) return "none";
  if (on === total) return "all";
  return "partial";
}

/** OFF resolution mode for nested master cascades.
 *
 *   - "preserve"  → only rows whose `master_internal_by` matches this
 *                    bundle's `_uid` get cleared. Manual-internal rows
 *                    survive. Inner masters reached via recursion ALSO
 *                    run in preserve mode regardless of their own
 *                    claims, so a parent's OFF doesn't accidentally
 *                    sweep an inner bundle's manual rows.
 *   - "cascade"   → every internal row this bundle owns (direct
 *                    children) clears unconditionally. Triggered only
 *                    when the entire scope is hand-marked (no master
 *                    claim anywhere this bundle could see) and the
 *                    user clicks the master button at "all" — they
 *                    almost certainly meant "turn everything off".
 *                    Inner masters receive the same "cascade" so
 *                    inner-owned manual rows clear too. */
type BundleOffMode = "preserve" | "cascade";

/** Set `instance.internal` for every direct child of a bundle, then
 *  recurse into inner bundles. See `BundleOffMode` for the OFF
 *  decision matrix.
 *
 *  A bundle's master governs ONLY its direct children — rows owned
 *  by an inner bundle are skipped + the recursive call propagates
 *  the same on/off + mode downward. */
function setBundleInternal(
  uid: string,
  targetOn: boolean,
  forceMode?: BundleOffMode,
): void {
  const bundles = value.value.bundles ?? [];
  const bundle = bundles.find((b) => b._uid === uid);
  if (!bundle) return;
  const innerBundles = bundles.filter((b) => b.parent_uid === bundle._uid);
  const innerUids = new Set(innerBundles.map((b) => b._uid));
  const modules = value.value.modules;
  // OFF-mode decision (forceMode wins on recursive descent). Scan
  // the entire scope for any `master_internal_by` tag — presence
  // anywhere → preserve (some master claimed something, OFF
  // should undo only that). Absence anywhere → cascade (all
  // hand-marked, click OFF at "all" means "really clear all").
  let mode: BundleOffMode = forceMode ?? "preserve";
  if (!targetOn && !forceMode) {
    let hasAnyClaim = false;
    for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
      const m = modules[i];
      if (!m || !isInternalable(m)) continue;
      if (m.instance?._ui?.master_internal_by) {
        hasAnyClaim = true;
        break;
      }
    }
    mode = hasAnyClaim ? "preserve" : "cascade";
  }
  // Track which inners this call should recurse into. Two rules:
  //   ON  — recurse if the inner state was NOT "all" before this op
  //         (we're flipping it from partial/none to all). Tag the
  //         inner with `master_internal_chained_by = bundle._uid`
  //         so its eventual OFF can find us. If inner was already
  //         "all", skip — user/its own master got there independently,
  //         we don't want to "own" inner's pre-existing state.
  //   OFF — recurse only if inner.master_internal_chained_by ===
  //         bundle._uid (we previously chained inner ON). Otherwise
  //         leave inner alone (user-controlled). On recursion, clear
  //         the chain tag.
  type InnerOp = { inner: BundleInstance; chainTag: "set" | "clear" | null };
  const innerOps: InnerOp[] = [];
  for (const inner of innerBundles) {
    if (targetOn) {
      const innerState = bundleInternalState(inner);
      if (innerState !== "all") {
        innerOps.push({ inner, chainTag: "set" });
      }
    } else {
      if (inner.master_internal_chained_by === bundle._uid) {
        innerOps.push({ inner, chainTag: "clear" });
      }
    }
  }
  const list = modules.map((m, i) => {
    if (i < bundle.start_idx || i > bundle.end_idx) return m;
    if (!isInternalable(m)) return m;
    const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
    if (origin && innerUids.has(origin)) return m;
    const inst = m.instance ?? {};
    const ui = inst._ui ?? {};
    if (targetOn) {
      if (inst.internal) return m;
      return {
        ...m,
        instance: {
          ...inst,
          internal: true,
          _ui: { ...ui, master_internal: true, master_internal_by: bundle._uid },
        },
      };
    } else {
      if (!inst.internal) return m;
      // Preserve mode → only clear rows THIS bundle owns. Cascade
      // mode → clear everything in scope regardless of claim.
      if (mode === "preserve" && ui.master_internal_by !== bundle._uid) return m;
      const { internal: _drop, ...restInst } = inst;
      void _drop;
      const { master_internal: _drop2, master_internal_by: _drop3, ...restUi } = ui;
      void _drop2;
      void _drop3;
      return { ...m, instance: { ...restInst, _ui: restUi } };
    }
  });
  // Apply chain-tag updates to inner BundleInstances alongside the
  // module commit. Single commitModules call keeps modules + bundles
  // in lock-step so a subsequent recursive call sees the new flags.
  const tagsByUid = new Map<string, "set" | "clear">();
  for (const op of innerOps) if (op.chainTag) tagsByUid.set(op.inner._uid, op.chainTag);
  const nextBundles = bundles.map((b) => {
    const tag = tagsByUid.get(b._uid);
    if (!tag) return b;
    if (tag === "set") return { ...b, master_internal_chained_by: bundle._uid };
    const { master_internal_chained_by: _drop, ...rest } = b;
    void _drop;
    return rest as BundleInstance;
  });
  commitModules(list, nextBundles);
  // Recurse into inner bundles selected above. Mode propagates so a
  // preserving outer doesn't turn into a cascading inner.
  for (const op of innerOps) {
    setBundleInternal(op.inner._uid, targetOn, mode);
  }
}

/** Click handler: aggregation drives the on/off resolution. State
 *  "all" → click OFF (sweep everything in scope); state "none" or
 *  "partial" → click ON (claim every off row + propagate to inner
 *  masters). User-initiated click also clears this bundle's own
 *  `master_internal_chained_by` flag — taking direct action means
 *  the bundle is no longer "owned" by an outer chain. Any future
 *  outer OFF will leave it alone. */
function toggleBundleInternal(uid: string): void {
  const bundles = value.value.bundles ?? [];
  const bundle = bundles.find((b) => b._uid === uid);
  if (!bundle) return;
  const state = bundleInternalState(bundle);
  if (state === null) return;
  if (bundle.master_internal_chained_by) {
    const nextBundles = bundles.map((b) => {
      if (b._uid !== uid) return b;
      const { master_internal_chained_by: _drop, ...rest } = b;
      void _drop;
      return rest as BundleInstance;
    });
    value.value = { ...value.value, bundles: nextBundles };
  }
  setBundleInternal(uid, state !== "all");
}

/** Set seed-lock for every direct child of a bundle, recurse into
 *  inner bundles. Mirrors `setBundleInternal` — see that fn for the
 *  full design rationale (inner-bundle ownership, smart OFF,
 *  cascade-via-recursion). Lock-specific bit: ON uses the
 *  per-instance last-used seed via `lastUsedSeedReader`, then the
 *  `_ui.last_locked_seed` memory, then 0. */
function setBundleLock(
  uid: string,
  targetOn: boolean,
  forceMode?: BundleOffMode,
): void {
  const bundles = value.value.bundles ?? [];
  const bundle = bundles.find((b) => b._uid === uid);
  if (!bundle) return;
  const innerBundles = bundles.filter((b) => b.parent_uid === bundle._uid);
  const innerUids = new Set(innerBundles.map((b) => b._uid));
  const modules = value.value.modules;
  // Same OFF-mode decision matrix as setBundleInternal — see
  // `BundleOffMode` docs above for the full table. Pre-scan covers
  // the ENTIRE scope (not just direct children) so an inner-owned
  // claim correctly forces outer's OFF into preserve mode and
  // saves any hand-locked rows in outer's direct scope.
  let mode: BundleOffMode = forceMode ?? "preserve";
  if (!targetOn && !forceMode) {
    let hasAnyClaim = false;
    for (let i = bundle.start_idx; i <= bundle.end_idx; i++) {
      const m = modules[i];
      if (!m || !isSeedLockable(m)) continue;
      if (m.instance?._ui?.master_lock_by) {
        hasAnyClaim = true;
        break;
      }
    }
    mode = hasAnyClaim ? "preserve" : "cascade";
  }
  // Inner chain decisions mirror setBundleInternal. See that fn's
  // commentary for the full rationale.
  type InnerOp = { inner: BundleInstance; chainTag: "set" | "clear" | null };
  const innerOps: InnerOp[] = [];
  for (const inner of innerBundles) {
    if (targetOn) {
      const innerState = bundleLockState(inner);
      if (innerState !== "all") {
        innerOps.push({ inner, chainTag: "set" });
      }
    } else {
      if (inner.master_lock_chained_by === bundle._uid) {
        innerOps.push({ inner, chainTag: "clear" });
      }
    }
  }
  const list = modules.map((m, i) => {
    if (i < bundle.start_idx || i > bundle.end_idx) return m;
    if (!isSeedLockable(m)) return m;
    const origin = (m as ModuleEntry & { bundle_origin?: string }).bundle_origin;
    if (origin && innerUids.has(origin)) return m;
    const inst = m.instance ?? {};
    const ui = inst._ui ?? {};
    if (targetOn) {
      if (typeof inst.locked_seed === "number") return m;
      let fallback: number;
      const lastUsed = props.lastUsedSeedReader?.(m._uid ?? m.id);
      if (typeof lastUsed === "number") fallback = lastUsed;
      else if (typeof ui.last_locked_seed === "number") fallback = ui.last_locked_seed;
      else fallback = 0;
      return {
        ...m,
        instance: {
          ...inst,
          locked_seed: fallback,
          _ui: {
            ...ui,
            last_locked_seed: fallback,
            master_lock: true,
            master_lock_by: bundle._uid,
          },
        },
      };
    } else {
      if (typeof inst.locked_seed !== "number") return m;
      if (mode === "preserve" && ui.master_lock_by !== bundle._uid) return m;
      const { master_lock: _drop, master_lock_by: _drop2, ...restUi } = ui;
      void _drop;
      void _drop2;
      // DROP the `locked_seed` key entirely — earlier we set it to
      // `null`, which the engine treats identically to missing but
      // the bundle fingerprint distinguishes (stableStringify emits
      // `"locked_seed":null` vs no key at all).
      const { locked_seed: _drop3, ...restInstClean } = inst;
      void _drop3;
      return {
        ...m,
        instance: { ...restInstClean, _ui: restUi },
      };
    }
  });
  const tagsByUid = new Map<string, "set" | "clear">();
  for (const op of innerOps) if (op.chainTag) tagsByUid.set(op.inner._uid, op.chainTag);
  const nextBundles = bundles.map((b) => {
    const tag = tagsByUid.get(b._uid);
    if (!tag) return b;
    if (tag === "set") return { ...b, master_lock_chained_by: bundle._uid };
    const { master_lock_chained_by: _drop, ...rest } = b;
    void _drop;
    return rest as BundleInstance;
  });
  commitModules(list, nextBundles);
  for (const op of innerOps) {
    setBundleLock(op.inner._uid, targetOn, mode);
  }
}

function toggleBundleLock(uid: string): void {
  const bundles = value.value.bundles ?? [];
  const bundle = bundles.find((b) => b._uid === uid);
  if (!bundle) return;
  const state = bundleLockState(bundle);
  if (state === null) return;
  // Direct user click clears this bundle's own chain tag — taking
  // ownership decouples it from any outer chain.
  if (bundle.master_lock_chained_by) {
    const nextBundles = bundles.map((b) => {
      if (b._uid !== uid) return b;
      const { master_lock_chained_by: _drop, ...rest } = b;
      void _drop;
      return rest as BundleInstance;
    });
    value.value = { ...value.value, bundles: nextBundles };
  }
  setBundleLock(uid, state !== "all");
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

/**
 * Open the BundleInstanceModal for `uid`. Snapshots the live
 * BundleInstance into `bundleDraft` so the user's typing in
 * IdentitySection doesn't commit until Save. Kicks off a one-shot
 * library fetch in parallel so the "reset to library default" per-
 * field buttons can light up once the canonical name/color land.
 *
 * Lock / Hide master toggles deliberately bypass the draft — they
 * cascade onto live children, so buffering them through the modal
 * would diverge from the canvas state. Same handlers
 * `BundleHeader` uses.
 */
function openBundleEditModal(uid: string): void {
  const target = (value.value.bundles ?? []).find((b) => b._uid === uid);
  if (!target) return;
  editingBundleUid.value = uid;
  bundleDraft.value = JSON.parse(JSON.stringify(target));
  bundleLibraryDefaults.value = null;
  // Fire-and-forget: when the fetch lands, IdentitySection's per-
  // field reset surfaces. Modal stays usable in the interim — user
  // can edit name/color even before the library entry resolves.
  void (async () => {
    try {
      const entry = await api.bundles.get(target.library_id);
      // Modal may have closed mid-fetch; bail if so.
      if (editingBundleUid.value !== uid) return;
      bundleLibraryDefaults.value = {
        name: entry.name,
        color: entry.color ?? null,
      };
    } catch {
      // Library entry deleted / network error — leave defaults null
      // so the per-field reset buttons stay hidden, but the user
      // can still edit name/color directly. No toast: this isn't
      // an error from the user's perspective.
    }
  })();
}

function onBundleEditUpdate(patch: Partial<BundleInstance>): void {
  if (!bundleDraft.value) return;
  bundleDraft.value = { ...bundleDraft.value, ...patch };
}

function saveBundleEdit(): void {
  const uid = editingBundleUid.value;
  const draft = bundleDraft.value;
  if (!uid || !draft) {
    editingBundleUid.value = null;
    bundleDraft.value = null;
    return;
  }
  const bundles = value.value.bundles ?? [];
  const idx = bundles.findIndex((b) => b._uid === uid);
  if (idx < 0) {
    editingBundleUid.value = null;
    bundleDraft.value = null;
    return;
  }
  // Only identity fields flow through the draft — preserve every
  // other field (range, hash, fingerprint, …) from the live bundle
  // so cascading toggles that fired during the modal session aren't
  // overwritten.
  const live = bundles[idx];
  const next: BundleInstance = {
    ...live,
    name: draft.name,
    color: draft.color ?? null,
  };
  const nextBundles = [...bundles];
  nextBundles[idx] = next;
  value.value = { ...value.value, bundles: nextBundles };
  editingBundleUid.value = null;
  bundleDraft.value = null;
  bundleLibraryDefaults.value = null;
}

function cancelBundleEdit(): void {
  editingBundleUid.value = null;
  bundleDraft.value = null;
  bundleLibraryDefaults.value = null;
}

/** Wrap the existing ctx-level toggle so the modal's runtime
 *  buttons trigger the same cascade as the BundleHeader / ctxmenu.
 *  Live mutation — no draft involvement. */
function onBundleEditToggleLock(): void {
  const uid = editingBundleUid.value;
  if (!uid) return;
  toggleBundleLock(uid);
}

function onBundleEditToggleInternal(): void {
  const uid = editingBundleUid.value;
  if (!uid) return;
  toggleBundleInternal(uid);
}

function onBundleEditSaveToLibrary(): void {
  const uid = editingBundleUid.value;
  if (!uid) return;
  // Commit the draft FIRST so the user's pending name / color edits
  // land on the live BundleInstance, then open the push-to-library
  // modal for explicit Update / Save as new selection.
  saveBundleEdit();
  openPushBundleToLibrary(uid);
}

function onBundleEditResetToLibrary(): void {
  const uid = editingBundleUid.value;
  if (!uid) return;
  cancelBundleEdit();
  void resetBundleToLibrary(uid);
}

const {
  toggleLockOnCard, toggleInternalOnCard, onPickerAdd, removeModule,
  duplicateModule, moveToEdge, toggleEnabled, toggleCollapsed, toggleHold,
  collapseAll, expandAll, toggleAllEnabled, openEditModal, saveEditedModule,
  revertEditingFrame, onCardKeydown,
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

// Top-level render list: standalone modules + bundle wrappers, in
// document order. Each bundle entry packs its child rows so the
// template can iterate once + nest children inside a real .wp-bundle
// div (no more absolute-positioned overlay).
//
// Tier-2 nesting: a bundle's `children[]` may include a NESTED bundle
// wrapper (an inner BundleInstance whose parent_uid points at the
// outer). The renderer recurses one level — the API cap forbids
// deeper chains so a single `BundleChild` recursion is enough.
type BundleChild =
  | { kind: "mod"; key: string; module: ModuleEntry; idx: number }
  | { kind: "bundle"; key: string; bundle: BundleInstance; children: BundleChild[] };

interface TopLevelItem {
  kind: "mod" | "bundle";
  key: string;
  module?: ModuleEntry;
  idx?: number;
  bundle?: BundleInstance;
  children?: BundleChild[];
}

const topLevelItems = computed<TopLevelItem[]>(() => {
  const modules = value.value.modules;
  const bundles = value.value.bundles ?? [];

  // Group inner bundles by parent_uid for O(1) lookup during the walk.
  const innersByParent = new Map<string, BundleInstance[]>();
  for (const b of bundles) {
    const parent = typeof b.parent_uid === "string" ? b.parent_uid : null;
    if (!parent) continue;
    const list = innersByParent.get(parent) ?? [];
    list.push(b);
    innersByParent.set(parent, list);
  }

  // Build the child list for a bundle range [start, end]. Walks the
  // module positions; when a position matches an inner bundle's
  // start_idx, emits a nested bundle wrapper covering that inner's
  // span. Other positions emit leaf module sub-items.
  function bundleChildren(parentUid: string, start: number, end: number): BundleChild[] {
    const inners = (innersByParent.get(parentUid) ?? []).slice().sort(
      (a, b) => a.start_idx - b.start_idx,
    );
    const out: BundleChild[] = [];
    let j = start;
    while (j <= end) {
      const inner = inners.find((ii) => ii.start_idx === j && ii.end_idx >= ii.start_idx);
      if (inner) {
        // Inner bundle: recurse into its grandchildren. Tier-2 cap →
        // the recursive call will find no further inners under this
        // inner, but the structure stays uniform for the template.
        out.push({
          kind: "bundle",
          key: `b-${inner._uid}`,
          bundle: inner,
          children: bundleChildren(inner._uid, inner.start_idx, inner.end_idx),
        });
        j = inner.end_idx + 1;
        continue;
      }
      const m = modules[j];
      if (m) {
        out.push({ kind: "mod", key: m._uid ?? `m-${j}`, module: m, idx: j });
      }
      j++;
    }
    return out;
  }

  const out: TopLevelItem[] = [];
  let i = 0;
  while (i < modules.length) {
    // Top-level bundles only — bundles with a parent_uid render inside
    // their parent's children list via bundleChildren, not at the top.
    const b = bundles.find((bb) => bb.start_idx === i && !bb.parent_uid);
    if (b && b.end_idx >= b.start_idx) {
      out.push({
        kind: "bundle",
        key: `b-${b._uid}`,
        bundle: b,
        children: bundleChildren(b._uid, b.start_idx, b.end_idx),
      });
      i = b.end_idx + 1;
    } else {
      const m = modules[i];
      out.push({ kind: "mod", key: m._uid ?? `m-${i}`, module: m, idx: i });
      i++;
    }
  }
  return out;
});

const moduleRowCtx: ModuleRowCtx = {
  KIND_TITLE,
  kindIcon, kindChipModifier, varColorClass,
  isCollapsed, isLocked, isInternal, isSeedLockable,
  isModified, isDrifted, isMissingFromLibrary, isTypeConflict,
  severityFor, conflictTooltip, conflictBadgeText,
  modifiedTooltip, summaryFor, summaryTokens, siblingInfo,
  rowGap, draggingModuleUid, recentDropUids, pulseDelayFor,
  toggleCollapsed, toggleEnabled, removeModule,
  toggleLockOnCard, toggleInternalOnCard,
  onDragStart, onDragEnd, openContextMenu, onCardKeydown,
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
  bundleInternalState,
  bundleLockState,
  bundleHeaderGap,
  isBundleDropTarget,
  // Suppressed for an unlinked bundle — there is no insert for its children to
  // have diverged from, so MOD would be diffing against a ghost.
  isBundleSnapshotModified: (b: BundleInstance) =>
    !isBundleUnlinked(b) && bundleSnapshotModified(b, value.value.modules),
  recentDropUids,
  pulseDelayFor,
  toggleBundleCollapsed,
  toggleBundleEnabled,
  toggleBundleInternal,
  toggleBundleLock,
  removeBundle,
  openBundleContextMenu,
  onBundleDragStart,
  onDragEnd,
  dropBarFor,
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
