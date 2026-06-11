<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, provide, defineAsyncComponent } from "vue";
import {
  buildBundleEnabledMap,
  isModuleEffectivelyEnabled,
  parseWidgetJsonWithRecovery, serializeWidgetJson,
  emptyContextValue, newModuleId, newRowUid,
  type ContextWidgetValue, type ModuleEntry,
} from "../../widgets/_shared";
import { type ResolvedValue } from "../../widgets/richTokenize";
import { scanConflicts, labelFor as conflictLabelFor, shortConflictLabel, type Conflict } from "../../extension/conflicts";
import type { ChainModule, PairingBadge, RowPairings } from "../../extension/constraint-pairs";
import { baseCodename } from "../../extension/node-codename";
import {
  getCollapseMode,
  getCollapsedByDefault,
  getNewModuleDisabled,
  getValidationMode,
} from "../../extension/settings";
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
import { buildBundleInsertion, type BundleLibraryEntry } from "./bundles/insert";
import { buildLibraryChildrenWithIntegrity, toChildSnapshot } from "./bundles/save";
import {
  cascadeRestoreForBundle,
  scanCascadeRestore,
  type CascadeRestoreScan,
} from "./bundles/cascade-restore";
import { reconcileBundleRanges } from "./bundles/drag";
import { resolveDropZone, type DropZone } from "./bundles/drop-zone";
import { applyDrop, type DropPayload } from "./bundles/drop";
import { buildCrossNodeBundleInsertion } from "./bundles/cross-node-nested";
import { computeBundleFingerprint, bundleSnapshotModified, isFingerprintCurrent } from "./bundles/bundle-fingerprint";
import BundleDropBar from "./bundles/BundleDropBar.vue";
import {
  captureRects,
  applyFlip,
  withEnterAnimation,
  withLeaveAnimation,
  animateEnterBatch,
  flashRows,
  MOTION_FLIP_MS,
  MOTION_CURVE_FLIP,
} from "./bundles/flip";
import { api } from "../../manager/api/client";
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
import { dragState, queueHandoff, pendingHandoffs, takeHandoffsFor } from "./drag-store";
import { nextBindingSuffix } from "./duplicates/binding-suffix";
import { pushToast } from "../shared/toast-store";
import { kindIcon } from "../shared/kind-icons";
import { KIND_TITLE } from "./editors/_shell";
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
import {
  getBundleCollapsedByDefault,
  getConfirmDestructiveBundle,
} from "../../extension/settings";
import ConfirmDialog from "../shared/ConfirmDialog.vue";

const props = withDefaults(defineProps<{
  nodeId: number;
  initialJson: string;
  upstreamVars: string[];
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

const dragOver = ref<DropZone>(null);

// `_uid` of the module currently being dragged (source row). Drives the
// lifted-ghost class so the source visually picks up alongside the
// browser's default drag image.
const draggingModuleUid = ref<string | null>(null);
// `_uid` of the most recently dropped row — pulses for 450ms after a
// drop lands, then clears.
// Phase B.4: Set + order map for multi-child pulse on cross-node bundle
// drops. Each landed uid gets a CSS animation-delay = index * 60ms via
// pulseDelayFor; the .wp-drop-pulse keyframe runs at MOTION_PULSE_MS
// (420ms) so the last row's animation finishes at
// 420 + (n-1)*60ms after the drop. Timer clears the Set + Map together.
const recentDropUids = ref<Set<string>>(new Set());
const pulseOrder = ref<Map<string, number>>(new Map());
let dropPulseTimer: number | null = null;

// Disables `.wp-list-move` + `.wp-list-leave-active` transitions while
// active so children + overlay vanish on the same tick as the frame
// (and rows below snap up instead of sliding for 250ms FLIP).
const suppressMove = ref(false);
let suppressMoveTimer: number | null = null;

// Drag anchor: the row or bundle whose CSS class opens the gap for the
// indicator bar. Computed once per dragOver change so rowGap +
// bundleGap + dropBarFor all consult the same source of truth.
//
// Slot semantics:
//   - `insertIdx === <item start_idx>` → anchor at THAT item with pos
//     "before" (bar above)
//   - No matching item → anchor at the LAST item in the container with
//     pos "after" (bar below)
//
// Empty container → no anchor (bar paints at container center via the
// dropBarFor fallback).
type AnchorInfo =
  | { kind: "row"; idx: number; pos: "before" | "after"; containerUid: string | null }
  | { kind: "bundle"; uid: string; pos: "before" | "after"; containerUid: string | null };

function containerItems(
  containerUid: string | null,
  val: ContextWidgetValue,
): Array<{ kind: "mod"; idx: number } | { kind: "bundle"; bundle: BundleInstance }> {
  const bundles = val.bundles ?? [];
  const out: Array<{ kind: "mod"; idx: number } | { kind: "bundle"; bundle: BundleInstance }> = [];
  if (containerUid === null) {
    let i = 0;
    while (i < val.modules.length) {
      const b = bundles.find((bb) => bb.start_idx === i && !bb.parent_uid && bb.end_idx >= bb.start_idx);
      if (b) {
        out.push({ kind: "bundle", bundle: b });
        i = b.end_idx + 1;
      } else {
        out.push({ kind: "mod", idx: i });
        i++;
      }
    }
    return out;
  }
  const parent = bundles.find((b) => b._uid === containerUid);
  if (!parent || parent.end_idx < parent.start_idx) return out;
  let j = parent.start_idx;
  while (j <= parent.end_idx) {
    const inner = bundles.find(
      (b) => b.parent_uid === containerUid && b.start_idx === j && b.end_idx >= b.start_idx,
    );
    if (inner) {
      out.push({ kind: "bundle", bundle: inner });
      j = inner.end_idx + 1;
    } else {
      out.push({ kind: "mod", idx: j });
      j++;
    }
  }
  return out;
}

const dragAnchor = computed<AnchorInfo | null>(() => {
  const z = dragOver.value;
  if (!z) return null;
  const items = containerItems(z.containerUid, value.value);
  if (items.length === 0) return null;
  for (const it of items) {
    const startIdx = it.kind === "mod" ? it.idx : it.bundle.start_idx;
    if (startIdx === z.insertIdx) {
      return it.kind === "mod"
        ? { kind: "row", idx: it.idx, pos: "before", containerUid: z.containerUid }
        : { kind: "bundle", uid: it.bundle._uid, pos: "before", containerUid: z.containerUid };
    }
  }
  const last = items[items.length - 1];
  return last.kind === "mod"
    ? { kind: "row", idx: last.idx, pos: "after", containerUid: z.containerUid }
    : { kind: "bundle", uid: last.bundle._uid, pos: "after", containerUid: z.containerUid };
});

// True when the resolved slot anchors at modules.length in the top-level
// scope — drives the sticky "Drop here" footer's active state.
const isDropEndZone = computed<boolean>(() => {
  const z = dragOver.value;
  if (!z) return false;
  return z.containerUid === null && z.insertIdx >= value.value.modules.length;
});

function rowGap(idx: number): "before" | "after" | null {
  const a = dragAnchor.value;
  if (!a || a.kind !== "row" || a.idx !== idx) return null;
  return a.pos;
}

// Bundle gap (frame margin opens above/below the bundle). Reads the
// drag anchor; returns "before" when this bundle is the anchor with
// pos "before", "after" when it's the anchor with pos "after".
function bundleHeaderGap(uid: string): "before" | "after" | null {
  const a = dragAnchor.value;
  if (!a || a.kind !== "bundle" || a.uid !== uid) return null;
  return a.pos;
}

// True when the slot zone's container is THIS bundle's body — i.e. the
// drop will land somewhere inside it. Drives the frame-level highlight.
// Fires for in-bundle reorder AND for crossing into the bundle from
// outside; both cases are "drop will land in this container", so the
// affordance is consistent.
function isBundleDropTarget(uid: string): boolean {
  const z = dragOver.value;
  if (!z) return false;
  return z.containerUid === uid;
}

/** Looks up the indicator-bar position for a drop container.
 *
 *  `containerUid = null` → top-level list (the `.wp-modules` container
 *  inside the `.wp-modules-frame` ref).
 *  `containerUid = bundleUid` → that bundle's `.wp-bundle-children`
 *  scrolling body.
 *
 *  Returns `{top}` in pixels relative to that container's content box
 *  when the resolved zone targets the container; null otherwise. The
 *  BundleDropBar component renders an absolutely-positioned line at the
 *  returned offset.
 *
 *  The bar paints in the MIDDLE of the gap opened by the `wp-gap-*`
 *  margin (14px) — half that offset (7px) lifts the bar off the row's
 *  edge so it sits in the gap visibly rather than overlapping the
 *  row's own top/bottom border. That gives ONE clear line per drop
 *  position instead of "is that the bar or the row's border?".
 */
const GAP_BAR_OFFSET = 7;
function dropBarFor(containerUid: string | null): { top: number } | null {
  const a = dragAnchor.value;
  if (!a) {
    // Empty container case (only fires for empty top-level — bundles
    // always have ≥1 child by invariant). Paint at container center.
    const z = dragOver.value;
    if (!z || (z.containerUid ?? null) !== (containerUid ?? null)) return null;
    const containerEl = findContainerEl(containerUid);
    if (!containerEl) return null;
    return { top: containerEl.clientHeight / 2 };
  }
  if ((a.containerUid ?? null) !== (containerUid ?? null)) return null;
  const containerEl = findContainerEl(containerUid);
  if (!containerEl) return null;

  // CRITICAL: ComfyUI applies `transform: scale(zoom)` to the dom-widget
  // container. `getBoundingClientRect` returns VIEWPORT pixels (scaled).
  // `offsetTop` is in CSS pixels relative to offsetParent — that's the
  // right unit for `position:absolute; top` under a transformed ancestor.
  const anchorEl: HTMLElement | null =
    a.kind === "row" ? findRowEl(a.idx, containerEl) : findBundleFrameEl(a.uid, containerEl);
  if (!anchorEl) return null;
  const off = elementOffsetTopWithin(anchorEl, containerEl);
  return {
    top: a.pos === "before"
      ? off - GAP_BAR_OFFSET
      : off + anchorEl.offsetHeight + GAP_BAR_OFFSET,
  };
}

/** Walks `offsetParent` chain from `el` up until reaching `containerEl`,
 *  accumulating CSS-pixel offsets. Returns `el`'s top relative to
 *  `containerEl`'s padding edge (i.e. the same unit `position:absolute;
 *  top: <value>` resolves against when `containerEl` is positioned).
 *  Falls back to `el.offsetTop` if `containerEl` isn't reachable via
 *  the offsetParent chain (defensive — would indicate broken layout). */
function elementOffsetTopWithin(el: HTMLElement, containerEl: HTMLElement): number {
  let off = 0;
  let cur: HTMLElement | null = el;
  let safety = 0;
  while (cur && cur !== containerEl && safety < 32) {
    off += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
    safety += 1;
  }
  if (cur !== containerEl) return el.offsetTop;
  return off;
}

/** Locate the offset container for a given scope. Top-level → the
 *  `.wp-modules` div inside modulesContainer.value. Nested → that
 *  bundle's `.wp-bundle-children`. Returns null when the container
 *  isn't mounted yet (e.g. early reactive read). */
function findContainerEl(containerUid: string | null): HTMLElement | null {
  const frame = modulesContainer.value;
  if (!frame) return null;
  if (containerUid === null) {
    return frame.querySelector<HTMLElement>(":scope > .wp-modules");
  }
  return frame.querySelector<HTMLElement>(
    `.wp-bundle[data-bundle-uid="${containerUid}"] > .wp-bundle-children`,
  );
}

/** Find a module row by its absolute module idx, restricted to a given
 *  container scope (so nested rows don't get matched at top level). */
function findRowEl(moduleIdx: number, containerEl: HTMLElement): HTMLElement | null {
  return containerEl.querySelector<HTMLElement>(
    `:scope > .wp-module[data-module-idx="${moduleIdx}"]`,
  ) ?? containerEl.querySelector<HTMLElement>(
    `.wp-module[data-module-idx="${moduleIdx}"]`,
  );
}

/** Find a bundle's outer wrapper element. Used for header.before/after
 *  anchoring; `:scope >` keeps us in the container's immediate scope
 *  so nested bundles don't bleed into a parent container's lookup. */
function findBundleFrameEl(uid: string, containerEl: HTMLElement): HTMLElement | null {
  return containerEl.querySelector<HTMLElement>(
    `:scope > .wp-bundle[data-bundle-uid="${uid}"]`,
  ) ?? containerEl.querySelector<HTMLElement>(
    `.wp-bundle[data-bundle-uid="${uid}"]`,
  );
}

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
  mode: "update" | "fork" | "reattach";
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
  }
  const bundlesNote =
    result.bundles_updated.length > 0
      ? ` · ${result.bundles_updated.length} bundle${result.bundles_updated.length === 1 ? "" : "s"} synced`
      : "";
  let msg: string;
  if (result.mode === "fork") msg = `Saved as new library entry "${result.name}"`;
  else if (result.mode === "reattach") msg = `Re-attached "${result.name}" to library`;
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
  mode: "update" | "fork" | "reattach";
  id: string;
  payload_hash: string;
  name: string;
  origId: string;
  cascade?: { restoredModuleCount: number; restoredBundleCount: number };
}
function onBundlePushSaved(result: BundlePushSaveResult): void {
  void forceRefreshHashes();
  if (result.mode === "update" || result.mode === "reattach") {
    // Update: refresh inserted_at_hash + snapshot fingerprint for every
    // BundleInstance pointing at this library entry — drift + MOD dots
    // clear instantly. Reattach: also rebind library_id from the dead
    // uuid to the freshly-created one.
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
const editingModule = computed<ModuleEntry | null>(() =>
  editingIdx.value != null ? (value.value.modules[editingIdx.value] ?? null) : null,
);

/** Per-option pair lookup for the currently-edited wildcard. Map keys
 *  are option ids; values are pair badges whose `via.optionIds` include
 *  that option. Drives the trailing `↪#N` chip inside the wildcard
 *  modal's options table. Empty for non-wildcard modules and for
 *  wildcards that aren't a constraint carrier. */
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
const siblingNodeVars = computed<string[]>(() => {
  const names = new Set<string>();
  function add(name: string | undefined | null): void {
    const trimmed = (name ?? "").replace(/^\$+/, "").trim();
    if (trimmed) names.add(trimmed);
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
      for (const rule of p.rules ?? []) {
        for (const br of rule.branches ?? []) add(br.action?.target_var);
        add(rule.else?.action?.target_var);
      }
    }
  }
  return [...names];
});

function clearDragHover() {
  if (dragOver.value === null) return;
  dragOver.value = null;
}

onMounted(() => {
  window.addEventListener("dragend", clearDragHover);
  // Subscribe to the shared drift-store — it manages the 5s poll of the
  // /wp/api/modules/hashes endpoint and exposes the live-hash map that
  // drives both the missing-dot (this task) and the drift-dot (Task 3).
  subscribeDrift();
});
onBeforeUnmount(() => {
  window.removeEventListener("dragend", clearDragHover);
  if (dragState.value?.sourceNodeId === props.nodeId) dragState.value = null;
  if (suppressMoveTimer != null) {
    window.clearTimeout(suppressMoveTimer);
    suppressMoveTimer = null;
  }
  if (dropPulseTimer != null) {
    window.clearTimeout(dropPulseTimer);
    dropPulseTimer = null;
  }
  unsubscribeDrift();
});

watch(dragState, (v) => { if (v === null) clearDragHover(); });

// Backup cleanup path for cross-node handoffs. Primary path: the
// source row's `dragend` listener reads `dragState.consumedBy` and
// splices the row out. That fires reliably under most conditions
// but has been observed to miss when the row's containing bundle
// frame re-renders during the same drag tick (constraint duplicates
// inside the "final framing" bundle were the trigger). When the
// target widget queues a handoff in its drop handler, this watch
// fires on the source widget and removes the row by `_uid` —
// idempotent with the dragend path because filtering a uid that's
// already gone is a no-op.
//
// Idempotency note: both branches re-read the current bundle uid /
// range from the live state rather than the (possibly stale) values
// captured at drop time. The dragend handler runs the same lookup
// for the same reason — it's the only way to avoid double-removal
// when Vue's watch flush schedules this watcher between the target
// queue write and the browser-dispatched dragend on the source.
watch(pendingHandoffs, () => {
  const mine = takeHandoffsFor(props.nodeId);
  if (mine.length === 0) return;
  let modules = value.value.modules;
  let bundles = value.value.bundles ?? [];
  let changed = false;
  for (const h of mine) {
    if (h.kind === "module" && h.uid) {
      const before = modules.length;
      modules = modules.filter((m) => m._uid !== h.uid);
      if (modules.length !== before) changed = true;
    } else if (h.kind === "bundle" && h.bundleUid) {
      // Look up the bundle by uid in the LIVE state — sourceStartIdx
      // / sourceEndIdx captured at drop time may be stale if a sibling
      // op has shifted indices, or if dragend already ran.
      const live = bundles.find((b) => b._uid === h.bundleUid);
      if (!live) continue;
      const start = live.start_idx;
      const end = live.end_idx;
      if (start < 0 || end < start || end >= modules.length) continue;
      const movingBundleUids = new Set<string>([h.bundleUid]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const b of bundles) {
          if (b.parent_uid && movingBundleUids.has(b.parent_uid) && !movingBundleUids.has(b._uid)) {
            movingBundleUids.add(b._uid);
            grew = true;
          }
        }
      }
      const removedCount = end - start + 1;
      modules = [...modules.slice(0, start), ...modules.slice(end + 1)];
      bundles = bundles
        .filter((b) => !movingBundleUids.has(b._uid))
        .map((b) => (b.start_idx > end
          ? { ...b, start_idx: b.start_idx - removedCount, end_idx: b.end_idx - removedCount }
          : b));
      changed = true;
    }
  }
  if (changed) commitModules(modules, bundles);
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

/** Stamp `snapshot_fingerprint` on any BundleInstance missing one OR
 *  carrying a stale-version baseline. Backfill-on-load: workflows
 *  saved before MOD detection landed get a false-clean baseline
 *  computed from current state; bundles whose stored fingerprint
 *  predates a format bump (see `FINGERPRINT_VERSION` in
 *  `bundle-fingerprint.ts`) are silently rebaselined here so they
 *  don't render with a permanent "modified" badge after the upgrade.
 *  Subsequent edits flip the bundle to modified correctly. */
function ensureBundleFingerprints(
  bundles: BundleInstance[],
  modules: ModuleEntry[],
): boolean {
  let mutated = false;
  for (const b of bundles) {
    if (!isFingerprintCurrent(b.snapshot_fingerprint)) {
      b.snapshot_fingerprint = computeBundleFingerprint(b, modules);
      mutated = true;
    }
  }
  return mutated;
}

/** Re-snap fingerprints for the given bundle uids using the current
 *  modules + bundles state. Returns a new bundles array with updated
 *  fingerprints. Call sites: post-insert (sync local state with library
 *  snapshot), post-save (record what we just published), post-reset
 *  (record the library state we just pulled), post-cross-node (record
 *  the freshly-cloned snapshot). */
function snapBundleFingerprints(
  bundles: BundleInstance[],
  modules: ModuleEntry[],
  uidsToSnap: Set<string>,
): BundleInstance[] {
  return bundles.map((b) =>
    uidsToSnap.has(b._uid)
      ? { ...b, snapshot_fingerprint: computeBundleFingerprint(b, modules) }
      : b,
  );
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

// Container ref for list-level drag handlers + bar positioning.
const modulesContainer = ref<HTMLElement | null>(null);

// Suppresses wp-list-move + wp-list-leave-active transitions for the
// duration; covers the longest TransitionGroup transition (250ms FLIP)
// plus a margin so leaving rows + FLIP-moving siblings all snap.
function holdSuppressMove(): void {
  suppressMove.value = true;
  if (suppressMoveTimer != null) window.clearTimeout(suppressMoveTimer);
  suppressMoveTimer = window.setTimeout(() => {
    suppressMove.value = false;
    suppressMoveTimer = null;
  }, 300);
}

/**
 * Capture FLIP rects at every list-level container in the widget.
 * Returns a snapshot to feed back into `playFlipSnapshot` after Vue
 * commits the mutated `value.value` and re-renders.
 *
 * Two scope levels are captured non-overlappingly:
 *   - `.wp-modules` direct children: bundles + standalone modules
 *   - each `.wp-bundle-children` direct children: in-bundle modules
 *
 * Capturing both lets us animate top-level reorders AND in-bundle
 * reorders cleanly. A bundle moving as a unit only FLIPs at the top
 * level; its children get the transform via inheritance and skip the
 * inner pass (their rects don't change relative to the bundle).
 */
type FlipSnapshot = { scope: HTMLElement; before: Map<string, DOMRect> }[];

function captureFlipSnapshot(): FlipSnapshot {
  const frame = modulesContainer.value;
  if (!frame) return [];
  const snapshot: FlipSnapshot = [];
  const top = frame.querySelector<HTMLElement>(".wp-modules");
  if (top) snapshot.push({ scope: top, before: captureRects(top, el => el.dataset.uid ?? null) });
  for (const inner of Array.from(frame.querySelectorAll<HTMLElement>(".wp-bundle-children"))) {
    snapshot.push({ scope: inner, before: captureRects(inner, el => el.dataset.uid ?? null) });
  }
  return snapshot;
}

/**
 * Drops a uid from every scope's pre-mutation rect map so playFlipSnapshot
 * leaves that element alone. Used when the row should animate via a
 * different mechanism (e.g. --arriving fade-slide for cross-scope moves)
 * — without this, the FLIP inline transform would override the class-
 * driven transition.
 */
function excludeFromFlipSnapshot(snapshot: FlipSnapshot, uid: string): void {
  for (const entry of snapshot) entry.before.delete(uid);
}

function playFlipSnapshot(snapshot: FlipSnapshot): void {
  for (const { scope, before } of snapshot) {
    applyFlip(scope, before, el => el.dataset.uid ?? null, {
      duration: MOTION_FLIP_MS,
      ease: MOTION_CURVE_FLIP,
    });
  }
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

  const flipSnap = captureFlipSnapshot();
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
  const flipSnap = captureFlipSnapshot();
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
  const flipSnap = captureFlipSnapshot();
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

/** Reset bundle to library snapshot — re-fetch the library entry
 *  + replace current children with the frozen blob. Drops any user
 *  edits made to bundle children since insert. Confirms first since
 *  it's destructive. */
async function resetBundleToLibrary(uid: string): Promise<void> {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
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
    const msg = e instanceof Error ? e.message : String(e);
    pushToast(`Reset failed: ${msg}`, { severity: "error" });
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
    const msg = e instanceof Error ? e.message : String(e);
    pushToast(`Reset failed: ${msg}`, { severity: "error" });
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
  const flipSnap = captureFlipSnapshot();
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
    {
      label: "Reset to library snapshot",
      icon: "pi-refresh",
      subtitle: "Replace children with frozen library state",
      onSelect: () => { void resetBundleToLibrary(uid); },
    },
    (() => {
      const bundleMissing = isBundleMissingFromLibrary(target);
      return {
        label: "Push to library…",
        icon: "pi-cloud-upload",
        subtitle: bundleMissing
          ? "Library entry deleted — re-add to library"
          : "Rename, retag, overwrite library entry",
        accent: bundleMissing,
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

function isCollapsed(m: ModuleEntry): boolean {
  return m.collapsed === true;
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
  if (!m.payload_hash) return null;
  if (libraryHashes.value === null) return null;
  const live = libraryHashes.value[m.id];
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

/** True when the bundle's library entry has been deleted upstream —
 *  the polled `bundleHashes` map no longer contains its uuid. Pairs
 *  with `isMissingFromLibrary` for modules. Returns false until first
 *  poll lands so we don't flash MISSING before the truth is known. */
function isBundleMissingFromLibrary(bundle: BundleInstance): boolean {
  const map = bundleHashes.value;
  if (map === null) return false;
  if (!bundle.library_id) return false;
  return !(bundle.library_id in map);
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

/** Non-empty array helper — null/undefined/empty all read as "no override". */
function nonEmptyArr(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/** Non-empty object helper — null/undefined/{} all read as "no override". */
function nonEmptyObj(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    && Object.keys(v as Record<string, unknown>).length > 0;
}

function isModified(m: ModuleEntry): boolean {
  // Lock + internal have their own dedicated header buttons, so
  // double-counting them in the "modified" dot is just visual
  // noise. The modified indicator is reserved for state that
  // diverges from the library snapshot.
  const inst = m.instance;
  if (!inst) return false;
  switch (m.type) {
    case "wildcard":
      // Pool overrides — anything that changes WHICH option a roll picks.
      // Identity (display name + variable_binding) is intentionally
      // excluded: those have their own per-field reset icon inside the
      // modal, and counting them in the outer mod dot would conflate
      // identity-level renames with behavioural overrides.
      if (nonEmptyArr(inst.enabled_options)) return true;
      if (nonEmptyObj(inst.option_weights)) return true;
      if (inst.mode && inst.mode !== "random") return true;
      if (inst.pinned_option_id) return true;
      if (nonEmptyArr(inst.category_filter)) return true;
      return false;
    case "fixed_values":
      // Library-tracked: `values_overrides` non-empty = user edited entries,
      // OR `enabled_options` set means user toggled row enable/disable.
      // Inline-created (no payload_hash) never light up — no library anchor.
      if (nonEmptyArr((inst as { values_overrides?: unknown }).values_overrides)) return true;
      if (Array.isArray(inst.enabled_options)) return true;
      return false;
    case "combine":
      // Template override only. Identity (binding) excluded — see
      // wildcard branch comment.
      if (typeof inst.template_override === "string" && inst.template_override.length > 0) return true;
      return false;
    case "derivation":
      if (nonEmptyArr(inst.disabled_rule_ids)) return true;
      if (nonEmptyArr(inst.disabled_branch_keys)) return true;
      if (nonEmptyObj(inst.action_value_overrides)) return true;
      if (nonEmptyObj(inst.condition_value_overrides)) return true;
      if (nonEmptyArr(inst.rule_order_override)) return true;
      return false;
    case "constraint":
      if (nonEmptyArr(inst.disabled_exception_keys)) return true;
      if (nonEmptyArr(inst.disabled_matrix_cells)) return true;
      if (nonEmptyObj(inst.cell_mode_overrides)) return true;
      if (nonEmptyObj(inst.cell_factor_overrides)) return true;
      if (nonEmptyObj(inst.exception_mode_overrides)) return true;
      if (nonEmptyObj(inst.exception_factor_overrides)) return true;
      if (nonEmptyArr(inst.extra_exceptions)) return true;
      return false;
    default:
      return false;
  }
}

/** Kinds whose engine handler honors `instance.locked_seed`. Wildcard
 *  pins option pick; combine pins `{a|b|c}` template resolution;
 *  fixed_values pins per-value alternation; derivation pins inline
 *  syntax resolution inside `action.value` (`{a|b|c}` + nested
 *  wildcards) — see derivation_handler.resolve. Other kinds
 *  (constraint) ignore the field — engine doesn't read it.
 *  Inline lock action gates on this set so the icon only appears
 *  where it actually does something. */
const SEED_LOCKABLE_KINDS: ReadonlySet<string> = new Set([
  "wildcard", "combine", "fixed_values", "derivation",
]);
function isSeedLockable(m: ModuleEntry): boolean {
  return SEED_LOCKABLE_KINDS.has(m.type);
}

/** True for kinds that produce bindings — i.e. everything EXCEPT
 *  constraint. Constraint modules don't write any `$var`; they only
 *  constrain the relationship between two existing wildcards, so the
 *  `instance.internal` flag has no surface to hide and toggling it
 *  would be a no-op. Bundle master-toggle aggregation and the
 *  per-card internal button both gate on this. */
function isInternalable(m: ModuleEntry): boolean {
  return m.type !== "constraint";
}

function isLocked(m: ModuleEntry): boolean {
  return typeof m.instance?.locked_seed === "number";
}
function isInternal(m: ModuleEntry): boolean {
  return !!m.instance?.internal;
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

/** In-card lock toggle. Off → null `locked_seed` but keep
 *  `_ui.last_locked_seed` so the next toggle-on has a fallback.
 *  On → fallback chain (per-module priority so re-locking captures
 *  what THIS specific wildcard actually rolled with):
 *    1. lastUsedSeedReader(m._uid) — seed THIS instance used last
 *       run (locked_seed if it was locked, else chain seed).
 *       Keyed by per-instance _uid so siblings sharing m.id don't
 *       collapse to one value.
 *       Refreshes after every queue. Handles the
 *       lock→run→unlock→lock case correctly: the locked-and-then-
 *       unlocked wildcard restores to ITS locked seed, not the
 *       chain seed of that run.
 *    2. `_ui.last_locked_seed` — cold-start fallback when no queue
 *       has happened yet this session.
 *    3. 0 (final default). */
function toggleLockOnCard(idx: number) {
  const m = value.value.modules[idx];
  if (!m) return;
  const inst = m.instance ?? {};
  let nextInst: NonNullable<ModuleEntry["instance"]>;
  if (typeof inst.locked_seed === "number") {
    // DROP `locked_seed` rather than setting `null` — bundle MOD
    // fingerprint stableStringify distinguishes `null` from missing,
    // and a bundle was lighting up "modified" on the first per-card
    // unlock because the JSON shape changed even though the engine
    // treats both states identically.
    const { locked_seed: _drop, ...restInst } = inst;
    void _drop;
    nextInst = restInst;
  } else {
    let fallback: number;
    // Read by per-instance `_uid` — sibling rows share `m.id` (library
    // uuid) so id-keyed reads would return the same value for every
    // sibling regardless of which one rolled last. Engine trace now
    // emits `_uid` per entry; `module_seeds` is keyed by it. Falls back
    // to `m.id` for pre-`_uid` migration entries.
    const lastUsed = props.lastUsedSeedReader?.(m._uid ?? m.id);
    if (typeof lastUsed === "number") {
      fallback = lastUsed;
    } else if (typeof inst._ui?.last_locked_seed === "number") {
      fallback = inst._ui.last_locked_seed;
    } else {
      fallback = 0;
    }
    nextInst = { ...inst, locked_seed: fallback, _ui: { ...inst._ui, last_locked_seed: fallback } };
  }
  // Drop the bundle master_lock marker — the user is now hand-
  // managing this row's lock state, so a future master OFF on the
  // bundle should leave it alone. Strips both legacy `master_lock`
  // (boolean) and the per-bundle `master_lock_by` (uid) tag.
  if (nextInst._ui && (nextInst._ui.master_lock || nextInst._ui.master_lock_by)) {
    const { master_lock: _drop, master_lock_by: _drop2, ...restUi } = nextInst._ui;
    void _drop;
    void _drop2;
    nextInst = { ...nextInst, _ui: restUi };
  }
  // Phase B: index-based mutation — sibling rows share `m.id`, so a
  // map-by-id pass would toggle every sibling at once. Indexing into
  // the array hits the specific instance the user clicked.
  const list = [...value.value.modules];
  list[idx] = { ...m, instance: nextInst };
  commitModules(list);
}

/** In-card internal toggle. Drops the field on toggle-off so the
 *  persisted JSON stays minimal (matches the modal). */
function toggleInternalOnCard(idx: number) {
  const m = value.value.modules[idx];
  if (!m) return;
  const inst = m.instance ?? {};
  // Dropping the `master_internal` markers (legacy boolean + per-bundle
  // `master_internal_by` uid tag) means the bundle master's OFF
  // cascade won't revert this row — the user is now hand-managing it.
  // Whether they're turning it on for the first time or off after
  // the master had set it, ownership transfers here.
  const ui = inst._ui ?? {};
  const { master_internal: _dropMarker, master_internal_by: _dropMarker2, ...restUi } = ui;
  void _dropMarker;
  void _dropMarker2;
  const nextUi = restUi;
  let nextInst: NonNullable<ModuleEntry["instance"]>;
  if (inst.internal) {
    const { internal: _drop, ...rest } = inst;
    void _drop;
    nextInst = { ...rest, _ui: nextUi };
  } else {
    nextInst = { ...inst, internal: true, _ui: nextUi };
  }
  const list = [...value.value.modules];
  list[idx] = { ...m, instance: nextInst };
  commitModules(list);
}

/** Tooltip listing what's been overridden on the module — surfaced
 *  on hover of the modified-indicator dot. Order matches each kind's
 *  modal section layout for visual consistency. */
function modifiedTooltip(m: ModuleEntry): string {
  const inst = m.instance;
  if (!inst) return "";
  const bits: string[] = [];
  switch (m.type) {
    case "wildcard":
      if (inst.mode === "pinned") bits.push("pinned");
      else if (inst.mode === "subcategory") bits.push("subset");
      if (inst.category_filter) {
        bits.push(`cats: ${inst.category_filter}`);
      }
      if (Array.isArray(inst.enabled_options)) {
        bits.push(`${inst.enabled_options.length} option(s) enabled`);
      }
      if (nonEmptyObj(inst.option_weights)) {
        bits.push(`${Object.keys(inst.option_weights as Record<string, unknown>).length} weight override(s)`);
      }
      break;
    case "fixed_values": {
      const overrides = (inst as { values_overrides?: unknown[] }).values_overrides;
      if (Array.isArray(overrides) && overrides.length > 0) {
        bits.push(`${overrides.length} value override(s)`);
      }
      if (Array.isArray(inst.enabled_options)) {
        bits.push(`${inst.enabled_options.length} row(s) enabled`);
      }
      break;
    }
    case "combine":
      if (typeof inst.template_override === "string" && inst.template_override.length > 0) {
        bits.push("template override");
      }
      if (typeof inst.variable_binding === "string" && inst.variable_binding.length > 0) {
        bits.push(`binding: ${inst.variable_binding}`);
      }
      break;
    case "derivation":
      if (nonEmptyArr(inst.disabled_rule_ids)) bits.push(`${(inst.disabled_rule_ids as string[]).length} rule(s) disabled`);
      if (nonEmptyArr(inst.disabled_branch_keys)) bits.push(`${(inst.disabled_branch_keys as string[]).length} branch(es) disabled`);
      if (nonEmptyObj(inst.action_value_overrides)) bits.push("action overrides");
      if (nonEmptyObj(inst.condition_value_overrides)) bits.push("condition overrides");
      if (nonEmptyArr(inst.rule_order_override)) bits.push("reordered");
      break;
    case "constraint": {
      const cellOverrides =
        (nonEmptyObj(inst.cell_mode_overrides) ? Object.keys(inst.cell_mode_overrides as object).length : 0)
        + (nonEmptyObj(inst.cell_factor_overrides) ? Object.keys(inst.cell_factor_overrides as object).length : 0);
      if (cellOverrides > 0) bits.push(`${cellOverrides} cell override(s)`);
      if (nonEmptyArr(inst.disabled_matrix_cells)) bits.push(`${(inst.disabled_matrix_cells as string[]).length} cell(s) disabled`);
      if (nonEmptyArr(inst.disabled_exception_keys)) bits.push(`${(inst.disabled_exception_keys as string[]).length} exception(s) disabled`);
      const excOverrides =
        (nonEmptyObj(inst.exception_mode_overrides) ? Object.keys(inst.exception_mode_overrides as object).length : 0)
        + (nonEmptyObj(inst.exception_factor_overrides) ? Object.keys(inst.exception_factor_overrides as object).length : 0);
      if (excOverrides > 0) bits.push(`${excOverrides} exception override(s)`);
      if (nonEmptyArr(inst.extra_exceptions)) bits.push(`${(inst.extra_exceptions as unknown[]).length} extra exception(s)`);
      break;
    }
  }
  return bits.length > 0 ? `Modified: ${bits.join(" · ")}` : "Modified";
}

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
      const inst = m.instance?.variable_binding;
      const payloadBinding = (p.var_binding as string | undefined)?.trim();
      const binding = (typeof inst === "string" && inst.trim()) || payloadBinding;
      const opts = Array.isArray(p.options) ? p.options.length : 0;
      const head: SummaryToken = binding ? v(binding) : lit("wildcard");
      return opts
        ? [head, lit(` · ${opts} option${opts === 1 ? "" : "s"}`)]
        : [head];
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

/**
 * Normalize a module type into the slug used by the
 * `--wp-kind-{slug}` CSS tokens (see `shared/theme.css`). The engine
 * uses `fixed_values` but the colour token is `--wp-kind-fixed`, so
 * the kind chip needs a small alias map. Other kinds pass through
 * unchanged so adding a new kind requires only a token + a
 * `KIND_TITLE` entry, no chip-side change.
 */
function kindChipModifier(kind: string): string {
  return kind === "fixed_values" ? "fixed" : kind;
}

/**
 * Handle a picker `pick` event.
 *
 * The picker emits an array of library UUIDs. We POST them to the
 * embed-bundle endpoint and append a `ModuleEntry` for each returned
 * module to `value.modules` — uniformly with how inline-created
 * fixed_values land in the same array. There is no separate
 * snapshots / catalog list in the workflow JSON; the runtime side
 * builds its `__wp_catalog__` by filtering `modules` for wildcards.
 *
 * Already-present uuids are skipped (no duplicate cards). Server
 * walks transitive `@{}` deps and returns them in the same `modules`
 * array — they each become their own card so the user sees what
 * was auto-included.
 */
async function onPickerAdd(ids: string[]) {
  if (ids.length === 0) return;
  await onLibraryPick(ids);
}

async function onLibraryPick(uuids: string[]) {
  if (uuids.length === 0) {
    showPicker.value = false;
    return;
  }
  try {
    const res = await fetch("/wp/api/modules/embed-bundle", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuids }),
    });
    if (!res.ok) {
      throw new Error(`Embed bundle failed (HTTP ${res.status}).`);
    }
    const bundle = (await res.json()) as {
      modules?: Record<string, unknown>[];
      snapshots?: Record<string, {
        uuid: string;
        type: string;
        name: string;
        payload: Record<string, unknown>;
        payload_hash: string;
      }>;
      pickOrder?: string[];
      walkOverflow?: { uuid: string; reason: string }[];
    };

    // The server returns:
    //   - `modules`: full payloads of explicit picks (executor view)
    //   - `snapshots`: catalog map keyed by uuid (picks + transitive
    //                  wildcards walked via `@{}` refs)
    //
    // For the unified-list UI we want one card per snapshot — picks
    // AND transitive deps both render as full cards so the user sees
    // exactly what got embedded. Walk `snapshots` for the union.
    const snaps = bundle.snapshots ?? {};
    const incomingOrder = bundle.pickOrder ?? Object.keys(snaps);

    const existingIds = new Set(value.value.modules.map((m) => m.id));
    const newEntries: ModuleEntry[] = [];

    // Hoist `payload.values` → `entries` for fixed_values so the
    // widget UI (collapsed summary, modal entries editor) finds the
    // bindings. Engine reads from `payload.values` directly so this
    // is purely a UI-side mirror; the modal's save() step keeps the
    // two in sync after edits.
    function entriesFromSnapshot(
      entry: { type: string; payload: Record<string, unknown> },
    ): { variable_name: string; value: string }[] {
      if (entry.type !== "fixed_values") return [];
      const values = (entry.payload as { values?: unknown }).values;
      if (!Array.isArray(values)) return [];
      return values
        .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
        .map((v) => ({
          variable_name: String(v.name ?? v.var ?? ""),
          value: String(v.value ?? ""),
        }));
    }

    // Honor wp.collapsedByDefault + wp.newModuleDisabled — if the
    // user opted into either, every newly-embedded module respects
    // the preference. Existing modules retain their previous state
    // because we only mutate `newEntries` here, not existing cards.
    //
    // Accordion mode wins over collapsedByDefault for new adds: only
    // one module can be expanded at a time, and we don't know which
    // freshly-added module the user wants expanded — so start them
    // all collapsed and let the user click to expand whichever they
    // need. This keeps the accordion invariant (max 1 expanded) intact.
    const startCollapsed = getCollapseMode() === "accordion" ? true : getCollapsedByDefault();
    const startDisabled = getNewModuleDisabled();

    // Append picks first (in input order). Phase B: same-uuid picks
    // become siblings with an auto-suffixed binding (pre-B silently
    // skipped them).
    const seenInBundle = new Set<string>();
    const existingBindings = collectInContextBindings(value.value.modules);
    for (const uuid of incomingOrder) {
      if (seenInBundle.has(uuid)) continue;
      const entry = snaps[uuid];
      if (!entry) continue;
      seenInBundle.add(uuid);
      const isSibling = existingIds.has(uuid);
      const newEntry: ModuleEntry = {
        id: uuid,
        _uid: newRowUid(),
        type: entry.type as ModuleEntry["type"],
        enabled: !startDisabled,
        meta: { name: entry.name, library_name: entry.name },
        entries: entriesFromSnapshot(entry),
        payload: entry.payload,
        payload_hash: entry.payload_hash,
        collapsed: startCollapsed,
      };
      if (isSibling) {
        const baseBinding = extractPrimaryBinding(newEntry);
        if (baseBinding) {
          const suffixed = nextBindingSuffix(baseBinding, existingBindings);
          newEntry.instance = {
            ...(newEntry.instance ?? {}),
            variable_binding: suffixed,
          };
          existingBindings.add(suffixed);
        }
      }
      newEntries.push(newEntry);
    }
    // Then any transitive deps the walker pulled in but that weren't
    // in the explicit pickOrder.
    for (const [uuid, entry] of Object.entries(snaps)) {
      if (existingIds.has(uuid) || seenInBundle.has(uuid)) continue;
      seenInBundle.add(uuid);
      newEntries.push({
        id: uuid,
        _uid: newRowUid(),
        type: entry.type as ModuleEntry["type"],
        enabled: !startDisabled,
        meta: { name: entry.name, library_name: entry.name },
        entries: entriesFromSnapshot(entry),
        payload: entry.payload,
        payload_hash: entry.payload_hash,
        collapsed: startCollapsed,
      });
    }

    if (newEntries.length === 0) {
      pushToast(
        "Already embedded — nothing new added.",
        { severity: "info", lifeMs: 2500 },
      );
      showPicker.value = false;
      return;
    }

    commitModules([...value.value.modules, ...newEntries]);

    // Phase B.6: fade-in + slide-X each newly added row. No FLIP capture
    // here — new rows are appended at the tail so existing rows don't
    // shift. Two-pass batched class lifecycle ensures every row arrives
    // simultaneously instead of in a staircase.
    await nextTick();
    if (modulesContainer.value) {
      await animateEnterBatch(
        newEntries.map(e => e._uid),
        modulesContainer.value,
      );
    }

    const overflow = bundle.walkOverflow ?? [];
    if (overflow.length > 0) {
      const cycles = overflow.filter((o) => o.reason === "cycle_detected").length;
      const missing = overflow.filter((o) => o.reason === "missing_target").length;
      const depth = overflow.filter((o) => o.reason === "max_depth").length;
      const parts: string[] = [];
      if (cycles) parts.push(`${cycles} cycle${cycles === 1 ? "" : "s"}`);
      if (missing) parts.push(`${missing} missing`);
      if (depth) parts.push(`${depth} depth-cap`);
      pushToast(
        `Embedded ${newEntries.length} module${newEntries.length === 1 ? "" : "s"} (walker noted: ${parts.join(", ")}).`,
        { severity: "warning", lifeMs: 5000 },
      );
    } else {
      pushToast(
        `Embedded ${newEntries.length} module${newEntries.length === 1 ? "" : "s"} into the workflow.`,
        { severity: "success", lifeMs: 3000 },
      );
    }
  } catch (e) {
    pushToast(
      e instanceof Error ? e.message : "Embed failed.",
      { severity: "error", lifeMs: 5000 },
    );
  } finally {
    showPicker.value = false;
  }
}

async function removeModule(idx: number): Promise<void> {
  // Soft-delete: capture position + module, drop a toast with Undo. Undo
  // splices it back at its original index. Phase B: removes by index so
  // sibling rows (same uuid, multiple instances) only delete the
  // specific row the user clicked. Pre-Phase-B `filter(m => m.id !== id)`
  // would have removed every sibling at once.
  if (idx < 0 || idx >= value.value.modules.length) return;
  const removed = value.value.modules[idx];
  const moduleLabel = removed.meta.name?.trim() || "module";

  // Phase B.6: animate row out with --leaving, then commit the splice.
  // FLIP captures pre-mutation rects so sibling rows below slide up to
  // close the gap once the row is gone.
  const uid = removed._uid;
  if (uid) {
    await withLeaveAnimation(uid, modulesContainer.value ?? document.body, () => {
      // No-op — mutation happens below after the await resolves.
    });
  }

  // Snapshot bundles BEFORE the remove so the Undo path can restore
  // a bundle that dissolved when its last child left. Without this,
  // reconcile on undo can only revive bundles still present in the
  // current bundles[]; a dissolved single-child bundle would leave
  // the restored module orphaned outside the frame.
  const prevBundles = value.value.bundles ?? [];
  // Anchor for Undo: the _uid of the module that NOW sits at
  // `idx + 1` (i.e. the neighbor immediately after the row we're
  // about to remove). Splicing relative to this anchor on Undo lands
  // the restored row in the right slot even if sibling ops shifted
  // things between remove and click. Falls back to clamped idx when
  // the anchor is gone too — degrades gracefully rather than failing.
  const anchorAfter = value.value.modules[idx + 1]?._uid ?? null;
  const flipSnap = captureFlipSnapshot();
  const next = [...value.value.modules];
  next.splice(idx, 1);

  // Bundle-range integrity: removing a module from inside a bundle
  // must shrink that bundle's end_idx (one fewer child). Bundles
  // that started AFTER the removed index shift left by one. Bundles
  // whose range collapses to empty dissolve entirely.
  const nextBundles = (value.value.bundles ?? [])
    .map((b) => {
      if (b.start_idx <= idx && idx <= b.end_idx) {
        const newEnd = b.end_idx - 1;
        if (newEnd < b.start_idx) return null;  // empty → dissolve
        return { ...b, end_idx: newEnd };
      }
      if (b.start_idx > idx) {
        return { ...b, start_idx: b.start_idx - 1, end_idx: b.end_idx - 1 };
      }
      return b;
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  commitModules(next, nextBundles);
  await nextTick();
  playFlipSnapshot(flipSnap);
  pushToast(`Removed “${moduleLabel}”`, {
    severity: "info",
    action: {
      label: "Undo",
      onSelect: async () => {
        const restoreUid = removed._uid;
        const scope = modulesContainer.value;
        // Re-insert at idx + reconcile so any BundleInstance whose
        // start_idx/end_idx sits at or beyond the restored position
        // tracks the index shift. Without this, undo of a remove
        // that happened above a bundle would leave bundles[] stale
        // and `topLevelItems` would slurp the wrong children — the
        // same shift bug the drag-drop paths had.
        // Resolve insert point via the anchor _uid; fall back to the
        // captured idx (clamped). Splicing here works regardless of
        // sibling ops that may have shifted modules since remove.
        const findAnchor = (): number => {
          if (anchorAfter) {
            const i = value.value.modules.findIndex((m) => m._uid === anchorAfter);
            if (i >= 0) return i;
          }
          return Math.min(idx, value.value.modules.length);
        };
        if (restoreUid && scope) {
          await withEnterAnimation(restoreUid, scope, () => {
            const list = [...value.value.modules];
            list.splice(findAnchor(), 0, removed);
            // Pass prevBundles so a single-child bundle that dissolved
            // when this module left gets re-added by reconcile — the
            // restored module's bundle_origin field still points at
            // its old BundleInstance _uid, and reconcile matches it
            // against the snapshotted entry to rebuild the range.
            commitModules(list, prevBundles);
          });
        } else {
          const list = [...value.value.modules];
          list.splice(findAnchor(), 0, removed);
          commitModules(list, prevBundles);
        }
      },
    },
  });
}

async function duplicateModule(idx: number): Promise<void> {
  if (idx < 0 || idx >= value.value.modules.length) return;
  const flipSnap = captureFlipSnapshot();
  const list = [...value.value.modules];
  const i = idx;
  // Phase B: duplicate is a SIBLING — same uuid + payload_hash, only
  // the per-instance binding gets auto-suffixed. FORK (new uuid + new
  // library row) lives on Save-to-library when siblings > 1.
  const copy: ModuleEntry = JSON.parse(JSON.stringify(list[i]));
  // Stamp a fresh `_uid` so the new row has a stable, unique Vue key
  // that DOESN'T collide with the source sibling's `_uid`. Without
  // this, both rows would share the source's `_uid` after JSON-clone
  // and Vue's v-for would warn about duplicate keys.
  copy._uid = newRowUid();
  const baseBinding = extractPrimaryBinding(copy);
  if (baseBinding) {
    const taken = collectInContextBindings(list);
    const next = nextBindingSuffix(baseBinding, taken);
    copy.instance = {
      ...(copy.instance ?? {}),
      variable_binding: next,
    };
  }
  list.splice(i + 1, 0, copy);
  // Reconcile bundle ranges — without this, any BundleInstance whose
  // `start_idx`/`end_idx` sits at or beyond the insertion point still
  // points at its old indices, and the `topLevelItems` walker slurps
  // the wrong modules into the bundle (the duplicate gets sucked in,
  // the bundle's tail child gets ejected as standalone).
  commitModules(list);
  await nextTick();
  // Sibling rows below the inserted slot shift down via FLIP; the new
  // row itself fades + slides in via animateEnterBatch.
  playFlipSnapshot(flipSnap);
  if (modulesContainer.value && copy._uid) {
    await animateEnterBatch([copy._uid], modulesContainer.value);
  }
  pushToast(`Duplicated "${list[i].meta.name?.trim() || "module"}" as sibling`, {
    severity: "success",
    lifeMs: 3000,
    action: {
      label: "Undo",
      onSelect: async () => {
        const scope = modulesContainer.value;
        const dupUid = copy._uid;
        // Filter by the duplicate's _uid instead of splicing at the
        // captured idx. The captured `i + 1` would point at the wrong
        // row if another op (a sibling Undo, a row move, a remove)
        // shifted modules between the duplicate and its Undo. _uid is
        // stable per instance, so the undo composes with any sibling
        // op regardless of click order.
        if (dupUid && scope) {
          await withLeaveAnimation(dupUid, scope, () => {
            commitModules(value.value.modules.filter((m) => m._uid !== dupUid));
          });
        } else if (dupUid) {
          commitModules(value.value.modules.filter((m) => m._uid !== dupUid));
        } else {
          // No _uid → pre-migration entry. Best-effort: splice at the
          // recorded idx, accepting that sibling ops may have shifted
          // things. Same risk as before; we degrade rather than fail.
          const cur = [...value.value.modules];
          cur.splice(i + 1, 1);
          commitModules(cur);
        }
      },
    },
  });
}

/** Returns the kind-specific primary binding name (without `$`),
 *  honoring instance overrides. Null when the kind has no single
 *  primary binding (derivation, constraint, fixed_values). */
function extractPrimaryBinding(m: ModuleEntry): string | null {
  const inst = m.instance?.variable_binding;
  if (typeof inst === "string" && inst.trim()) return inst.trim();
  const p = (m.payload ?? {}) as Record<string, unknown>;
  if (m.type === "wildcard") {
    const b = p.var_binding;
    return typeof b === "string" && b.trim() ? b.trim() : null;
  }
  if (m.type === "combine") {
    const b = p.output_var;
    return typeof b === "string" && b.trim() ? b.trim() : null;
  }
  return null;
}

/** Collect every binding currently in use within this Context's
 *  modules — used to seed the auto-suffix collision set. */
function collectInContextBindings(modules: readonly ModuleEntry[]): Set<string> {
  const out = new Set<string>();
  for (const m of modules) {
    const b = extractPrimaryBinding(m);
    if (b) out.add(b);
    if (m.type === "fixed_values") {
      for (const e of m.entries ?? []) {
        if (e.variable_name?.trim()) out.add(e.variable_name.trim());
      }
    }
  }
  return out;
}

function moveToEdge(idx: number, edge: "top" | "bottom") {
  const list = [...value.value.modules];
  if (idx < 0 || idx >= list.length) return;
  const [m] = list.splice(idx, 1);
  if (edge === "top") list.unshift(m);
  else list.push(m);
  // Move-to-edge shifts every module between idx and the new position
  // by one slot; bundle ranges follow.
  commitModules(list);
  // Vue reorders the DOM by detach+reattach; focus is dropped.
  // Refocus the moved card by its new position.
  const newIdx = edge === "top" ? 0 : list.length - 1;
  nextTick(() => {
    const el = document.querySelector<HTMLElement>(`.wp-module[data-module-idx="${newIdx}"]`);
    el?.focus();
  });
}

function toggleEnabled(idx: number) {
  if (idx < 0 || idx >= value.value.modules.length) return;
  const list = [...value.value.modules];
  list[idx] = { ...list[idx], enabled: !list[idx].enabled };
  commitModules(list);
}

function toggleCollapsed(idx: number) {
  const target = value.value.modules[idx];
  if (!target) return;
  // Phase B: index-keyed so sibling rows (same uuid) collapse
  // independently. Pre-Phase-B map-by-id flipped every sibling at once.
  const willExpand = target.collapsed === true;
  const accordion = getCollapseMode() === "accordion" && willExpand;

  const list = value.value.modules.map((m, i) => {
    if (i === idx) return { ...m, collapsed: !m.collapsed };
    if (accordion) return { ...m, collapsed: true };
    return m;
  });
  commitModules(list);
}

/** Bulk collapse/expand. Used by the section-header chevron — one
 *  click flips every card to the same state. Idempotent if all
 *  cards already match the target state (the deep watcher will
 *  diff-eq and skip the onChange emit). */
function setAllCollapsed(collapsed: boolean) {
  const nextModules = value.value.modules.map((m) => ({ ...m, collapsed }));
  // Bundle FRAMES carry their own `collapsed` flag (separate from the child
  // module cards). Collapse/expand-all flips both so the action visibly folds
  // bundle frames, not just loose modules.
  const nextBundles = (value.value.bundles ?? []).map((b) => ({ ...b, collapsed }));
  commitModules(nextModules, nextBundles);
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

/** Toolbar bulk actions — wrappers so the toolbar template stays compact. */
function collapseAll(): void { setAllCollapsed(true); }
function expandAll(): void { setAllCollapsed(false); }
function toggleAllEnabled(): void {
  // Operate at the TOP LEVEL only. A standalone module is one unit (its own
  // `enabled`); a bundle is one unit (its MASTER `enabled` gate). Children
  // inside a bundle are governed by the master (effective = master AND
  // child), so toggle-all NEVER reaches in to flip them — disabling a bundle
  // goes through its master, leaving each child's own `enabled` intact for a
  // restore-safe re-enable. Nested bundles (parent_uid set) follow their
  // parent master via the AND chain, so only top-level masters are flipped.
  const isChild = (m: ModuleEntry): boolean =>
    !!(m as ModuleEntry & { bundle_origin?: string | null }).bundle_origin;
  const bundles = value.value.bundles ?? [];
  const topModules = value.value.modules.filter((m) => !isChild(m));
  const topBundles = bundles.filter((b) => !b.parent_uid);
  // Direction: if ANY top-level unit is on, turn everything off; else on.
  const anyOn =
    topModules.some((m) => m.enabled !== false)
    || topBundles.some((b) => b.enabled !== false);
  const next = !anyOn;
  const nextModules = value.value.modules.map((m) =>
    isChild(m) ? m : { ...m, enabled: next },
  );
  const nextBundles = bundles.map((b) => (b.parent_uid ? b : { ...b, enabled: next }));
  commitModules(nextModules, nextBundles);
}

/** Open the SPA dashboard in a new tab. Mirrors `extension/topbar.ts`'s
 *  `openSpa` so widget + topbar both land on the dashboard overview
 *  rather than the wildcards list (which is what the SPA root redirect
 *  resolves to). */
function openSpaLibrary(): void {
  window.open("/wp/dashboard", "_blank", "noopener");
}

/**
 * Edit opens `ModuleEditModal` for every kind. The modal renders a
 * kind-aware body:
 *   - `fixed_values` → inline name/value entry editor (legacy flow).
 *   - everything else → snapshot-instance preview with name +
 *     description editing + a deep-link to the full SPA editor.
 *
 * Snapshot edits stay local to this workflow — the underlying
 * library row is not touched. Major payload edits (option weights,
 * ref bindings, derivation rules, …) live in the SPA editor.
 */
function openEditModal(idx: number) {
  if (idx < 0 || idx >= value.value.modules.length) return;
  editingIdx.value = idx;
}

function saveEditedModule(updated: ModuleEntry & { _originalId?: string }) {
  // Phase B: index-based replacement — sibling rows share `m.id`, so
  // mapping `m.id === updated.id` would clobber every sibling at once.
  // We use `editingIdx` captured at modal-open to target the specific
  // row. `_originalId` survives from the fork path (id changed during
  // save) to drive the post-fork green flash.
  const targetIdx = editingIdx.value;
  if (targetIdx == null || targetIdx < 0 || targetIdx >= value.value.modules.length) {
    editingIdx.value = null;
    return;
  }
  const cleaned: ModuleEntry = { ...updated };
  delete (cleaned as { _originalId?: string })._originalId;
  const list = [...value.value.modules];
  list[targetIdx] = cleaned;
  commitModules(list);
  if (updated._originalId && updated._originalId !== updated.id) {
    nextTick(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-module-idx="${targetIdx}"]`,
      );
      if (el) {
        el.classList.add("wp-module--flash");
        setTimeout(() => el.classList.remove("wp-module--flash"), 420);
      }
    });
  }
  editingIdx.value = null;
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

function onCardKeydown(ev: KeyboardEvent, m: ModuleEntry, idx: number) {
  // Don't intercept keys when focus is inside an input/textarea inside the
  // card (none today, but defense in depth for future inline controls).
  const target = ev.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
  void m; // module ref retained for future kind-aware shortcuts

  // Ctrl/Cmd+D — duplicate focused module
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "d") {
    ev.preventDefault();
    duplicateModule(idx);
    return;
  }

  // Ctrl/Cmd+Shift+ArrowUp / ArrowDown — jump to edge of list.
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === "ArrowUp") {
    ev.preventDefault();
    moveToEdge(idx, "top");
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === "ArrowDown") {
    ev.preventDefault();
    moveToEdge(idx, "bottom");
    return;
  }

  // Shift+ArrowUp / Shift+ArrowDown — reorder ±1
  if (ev.shiftKey && ev.key === "ArrowUp") {
    ev.preventDefault();
    moveModule(idx, -1);
    return;
  }
  if (ev.shiftKey && ev.key === "ArrowDown") {
    ev.preventDefault();
    moveModule(idx, 1);
    return;
  }

  // Enter — open edit modal (matches the context menu's primary action)
  if (ev.key === "Enter") {
    ev.preventDefault();
    openEditModal(idx);
    return;
  }

  // Delete — remove module
  if (ev.key === "Delete") {
    ev.preventDefault();
    removeModule(idx);
    return;
  }
}

function moveModule(idx: number, dir: -1 | 1) {
  const list = [...value.value.modules];
  const j = idx + dir;
  if (idx < 0 || idx >= list.length || j < 0 || j >= list.length) return;
  [list[idx], list[j]] = [list[j], list[idx]];
  // Reconcile bundle ranges: when the swapped pair straddles a bundle
  // boundary, the bundle's children shift by one slot and the start/
  // end indices have to follow.
  commitModules(list);
  // Vue reorders the DOM by detach+reattach even with :key; focus is dropped.
  // Refocus the moved card by its new idx (composite key includes idx).
  nextTick(() => {
    const el = document.querySelector<HTMLElement>(`.wp-module[data-module-idx="${j}"]`);
    el?.focus();
  });
}

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
  // Refresh + Save are mutually exclusive in normal use (a module is
  // either drifted OR missing OR clean), so hiding the inactive entry
  // beats greying it — matches Save's existing conditional-push pattern
  // and keeps the menu shorter.
  if (isDrifted(m)) {
    items.push({
      label: "Refresh from library",
      icon: "pi-refresh",
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
    items.push({
      label: "Push to library…",
      icon: "pi-cloud-upload",
      subtitle: missing ? "Library entry deleted — re-add as new entry" : undefined,
      accent: missing,
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

// ── Drag-and-drop ───────────────────────────────────────────────────────
function onDragStart(ev: DragEvent, mod: ModuleEntry, idx: number) {
  // sourceIdx disambiguates siblings sharing `mod.id` at drop time.
  dragState.value = {
    kind: "module",
    sourceNodeId: props.nodeId,
    module: JSON.parse(JSON.stringify(mod)),
    sourceIdx: idx,
    sourceBundleUid: (mod as ModuleEntry & { bundle_origin?: string }).bundle_origin ?? null,
  };
  draggingModuleUid.value = mod._uid ?? null;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", mod.id);
  }
}

// Pulses the just-dropped module(s) so the user sees where they landed.
// Accepts a single uid OR an array — cross-node bundle drops pass every
// freshly-inserted child so all rows pulse (Phase B.4 bug fix).
//
// Pulse start is delayed by MOTION_FLIP_MS so the row has finished its
// arriving fade-slide before the box-shadow ring fires. Without the
// delay the pulse started mid-fade and the ring painted on a row whose
// opacity was still transitioning — read as 'pulse before row arrived'.
let dropPulseStartTimer: number | null = null;
function pulseDrop(uids: string | string[] | undefined | null): void {
  if (!uids) return;
  const list = (Array.isArray(uids) ? uids : [uids]).filter((u): u is string => !!u);
  if (list.length === 0) return;
  if (dropPulseTimer != null) window.clearTimeout(dropPulseTimer);
  if (dropPulseStartTimer != null) window.clearTimeout(dropPulseStartTimer);
  dropPulseStartTimer = window.setTimeout(() => {
    recentDropUids.value = new Set(list);
    pulseOrder.value = new Map(list.map((uid, i) => [uid, i]));
    dropPulseStartTimer = null;
    // Last pulse must complete: stagger * (n-1) + pulse duration + 50ms buffer.
    const totalMs = 420 + (list.length - 1) * 60 + 50;
    dropPulseTimer = window.setTimeout(() => {
      recentDropUids.value = new Set();
      pulseOrder.value = new Map();
      dropPulseTimer = null;
    }, totalMs);
  }, MOTION_FLIP_MS);
}

// Per-row CSS animation-delay derived from pulse order. Returns "0ms"
// when uid isn't in the current pulse batch — falls through harmlessly
// because no .wp-drop-pulse class is applied either.
function pulseDelayFor(uid: string | null | undefined): string {
  if (!uid) return "0ms";
  const idx = pulseOrder.value.get(uid);
  return idx == null ? "0ms" : `${idx * 60}ms`;
}

// Bundle-as-unit drag — header drag handle initiates a "bundle" payload
// carrying the bundle's uid + pre-drag range. Receiver re-slices the
// range out and re-inserts at the resolved zone.
function onBundleDragStart(ev: DragEvent, uid: string) {
  const b = (value.value.bundles ?? []).find((bb) => bb._uid === uid);
  if (!b) return;
  // Snapshot children so cross-node drop can splice them into a
  // different Context. Deep clone via JSON to detach from the source
  // node's reactive state. Children carry their ORIGINAL bundle_origin
  // (which may be outer-uid OR inner-uid) so the receiver can remap
  // the nesting chain after minting fresh uids.
  const children = value.value.modules
    .slice(b.start_idx, b.end_idx + 1)
    .map((m) => JSON.parse(JSON.stringify(m)) as ModuleEntry);
  // Capture inner BundleInstances (parent_uid === outer). Without
  // this, cross-node drop loses the nesting — receiver only mints
  // the outer and stamps every child with outer.uid, flattening any
  // inner bundle structure. Deep-clone to detach from source state.
  const innerInstances = (value.value.bundles ?? [])
    .filter((bb) => bb.parent_uid === uid)
    .map((bb) => JSON.parse(JSON.stringify(bb)) as BundleInstance);
  dragState.value = {
    kind: "bundle",
    sourceNodeId: props.nodeId,
    bundleUid: uid,
    sourceStartIdx: b.start_idx,
    sourceEndIdx: b.end_idx,
    libraryId: b.library_id,
    bundleName: b.name,
    bundleColor: b.color ?? null,
    bundleCollapsed: b.collapsed,
    bundleEnabled: b.enabled,
    children,
    innerInstances,
  };
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", `bundle:${uid}`);
  }
}

function onDragEnd() {
  const ds = dragState.value;
  if (ds && ds.sourceNodeId === props.nodeId && !sameNodeDropHandled) {
    const consumedByOther = ds.consumedBy != null && ds.consumedBy !== props.nodeId;
    if (consumedByOther) {
      if (ds.kind === "module") {
        // Cross-node consumption — filter by `_uid`, NOT by sourceIdx.
        // The handoff queue watch may have already removed the row
        // before this dragend fires (Vue's watch flush ordering vs
        // browser-dispatched dragend isn't deterministic). Splicing
        // at the recorded sourceIdx would then delete the row that
        // shifted into that slot — observed as "drag deleted my
        // target wildcard" when the constraint sat next to its
        // target. Filtering by _uid is idempotent: if the row's
        // already gone, the filter is a no-op. `m.id` is the library
        // uuid shared by siblings, so it's only a fallback for
        // pre-_uid migration entries.
        const dragUid = ds.module._uid;
        const curBundles = value.value.bundles ?? [];
        if (dragUid) {
          const filtered = value.value.modules.filter((m) => m._uid !== dragUid);
          if (filtered.length !== value.value.modules.length) {
            commitModules(filtered, curBundles);
          }
        } else {
          // No _uid — only happens for ancient saved workflows that
          // predate the per-row uid stamping pass. Best-effort splice
          // by sourceIdx, accepting the risk of removing the wrong
          // row if anything shifted it.
          const srcIdx = ds.sourceIdx;
          if (srcIdx >= 0 && srcIdx < value.value.modules.length) {
            const list = [...value.value.modules];
            list.splice(srcIdx, 1);
            commitModules(list, curBundles);
          } else {
            const filtered = value.value.modules.filter((m) => m.id !== ds.module.id);
            commitModules(filtered, curBundles);
          }
        }
      } else if (ds.kind === "bundle") {
        // Cross-node bundle drop — same idempotency story as the
        // module path. Filter the bundle range by its bundleUid +
        // descendants instead of relying on stored start_idx/end_idx
        // that the handoff queue may have already invalidated.
        const movingBundleUids = new Set<string>([ds.bundleUid]);
        // First pass: collect every inner whose parent is in the set.
        // Repeated until no new uids land — covers nested bundles
        // even though the tier-2 cap means one inner level today.
        const curBundles = value.value.bundles ?? [];
        let grew = true;
        while (grew) {
          grew = false;
          for (const b of curBundles) {
            if (b.parent_uid && movingBundleUids.has(b.parent_uid) && !movingBundleUids.has(b._uid)) {
              movingBundleUids.add(b._uid);
              grew = true;
            }
          }
        }
        const bundleStillPresent = curBundles.some((b) => b._uid === ds.bundleUid);
        if (!bundleStillPresent) {
          // Handoff already cleaned up; nothing left to do.
        } else {
          const movingBundle = curBundles.find((b) => b._uid === ds.bundleUid);
          if (movingBundle) {
            const start = movingBundle.start_idx;
            const end = movingBundle.end_idx;
            const before = value.value.modules.slice(0, start);
            const after = value.value.modules.slice(end + 1);
            const removedCount = end - start + 1;
            const remainingBundles = curBundles
              .filter((b) => !movingBundleUids.has(b._uid))
              .map((b) => (b.start_idx > end
                ? { ...b, start_idx: b.start_idx - removedCount, end_idx: b.end_idx - removedCount }
                : b));
            commitModules([...before, ...after], remainingBundles);
          }
        }
      }
    }
  }
  dragState.value = null;
  sameNodeDropHandled = false;
  dragOver.value = null;
  draggingModuleUid.value = null;
}

let sameNodeDropHandled = false;

// Dragover on a row: standalone rows produce row zones (before/after);
// any bundle-member row resolves to its bundle's "inside" zone — the
// frame highlights as a single drop target. "before-bundle" comes from
// the bundle header (dragover handler on BundleHeader); "after-bundle"
// comes from the row immediately after the bundle range (treated as a
// row "before" drop on the post-bundle row).
// List-level dragover resolver — walks every top-level item (rows +
/** Dragover handler — delegates pointer-to-zone classification to the
 *  pure resolver. The resolver walks DOM from the pointer (innermost
 *  `.wp-bundle` ancestor wins as the target container) and applies the
 *  tier-2 cap. ContextWidget just sets `dragOver.value`; the indicator
 *  paint happens via the per-container `<BundleDropBar>` reading
 *  `dropBarFor()`. */
function onListDragOver(ev: DragEvent) {
  const ds = dragState.value;
  if (!ds) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  const container = modulesContainer.value;
  if (!container) return;
  dragOver.value = resolveDropZone(ev, container, value.value, ds);
}

// Empty-state hero is the drop target when the node has no modules.
// Cross-node drag onto an empty node lands here.
function onEmptyHeroDragOver(ev: DragEvent) {
  const ds = dragState.value;
  if (!ds) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  dragOver.value = { kind: "slot", containerUid: null, insertIdx: 0 };
}

function onEndDragOver(ev: DragEvent) {
  if (!dragState.value) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  dragOver.value = {
    kind: "slot",
    containerUid: null,
    insertIdx: value.value.modules.length,
  };
}

function onContainerLeave(ev: DragEvent) {
  const container = ev.currentTarget as HTMLElement;
  const next = ev.relatedTarget as Node | null;
  if (next && container.contains(next)) return;
  clearDragHover();
}

async function onDrop(ev: DragEvent, targetIdx: number | null) {
  ev.preventDefault();
  ev.stopPropagation();
  const ds = dragState.value;
  if (!ds) return;
  // Sync claim BEFORE any `await`. Browsers fire `dragend` on the
  // source element as soon as the drop handler returns its first
  // Promise (the `await nextTick()` below), and the source widget's
  // dragend reads `dragState.value.consumedBy` synchronously to decide
  // whether to splice out the moved row. Without this claim, the
  // source widget always reads `null` (we set consumedBy at the END
  // of the cross-node paths, well past several awaits) and the
  // cross-node MOVE silently becomes a COPY — the row stays in both
  // places. Skip the claim when the cross-node module path would
  // dedupe-reject; otherwise we'd tell the source to remove its row
  // even though the target rejected the drop.
  const isCrossNode = ds.sourceNodeId !== props.nodeId;
  if (isCrossNode) {
    if (ds.kind === "module") {
      const willDedupeBlock = value.value.modules.some((m) => m.id === ds.module.id);
      if (!willDedupeBlock) {
        dragState.value = { ...ds, consumedBy: props.nodeId };
        // Belt-and-suspenders: queue an explicit handoff for the
        // source widget. dragend on the source is the primary cleanup
        // path, but has been observed to miss intermittently for
        // constraint rows whose containing bundle frame re-renders
        // during the drag tick — the dragend bubbles before the row
        // re-mounts, then the consumedBy read races with the source
        // widget's reactive update. Queue ensures the source's
        // post-drop watch removes the row even if dragend skipped it.
        if (ds.module._uid) {
          queueHandoff({
            kind: "module",
            sourceNodeId: ds.sourceNodeId,
            uid: ds.module._uid,
          });
        }
      }
    } else if (ds.kind === "bundle") {
      // Bundle cross-node drops always accept (no dedupe gate on the
      // bundle branch); claim eagerly.
      dragState.value = { ...ds, consumedBy: props.nodeId };
      queueHandoff({
        kind: "bundle",
        sourceNodeId: ds.sourceNodeId,
        bundleUid: ds.bundleUid,
        sourceStartIdx: ds.sourceStartIdx,
        sourceEndIdx: ds.sourceEndIdx,
      });
    }
  }
  // Snapshot zone before clearing hover state. Null target idx + null
  // zone → slot at end of top-level (empty hero / sticky footer drop).
  const zone: DropZone =
    dragOver.value ??
    (targetIdx === null
      ? { kind: "slot", containerUid: null, insertIdx: value.value.modules.length }
      : null);
  dragOver.value = null;
  // Wait for Vue to flush the dragOver=null update so the wp-gap-before
  // / wp-gap-after class is removed from the anchor row/bundle BEFORE
  // we capture rects. Otherwise the captured rect carries the 14px
  // gap margin → post-Vue rect doesn't → FLIP animates a phantom
  // 14px shift on the anchor and its siblings (user-visible as
  // "other modules animate when swapping children").
  await nextTick();
  // Capture pre-mutation rects for FLIP-move. Captures top-level + every
  // in-bundle child container so any reorder animates its scope after
  // Vue commits + re-renders.
  const flipSnap = captureFlipSnapshot();

  // Same-node module drop — applyDrop covers the full reorder +
  // bundle_origin rewriting in one pure step.
  if (ds.kind === "module" && ds.sourceNodeId === props.nodeId) {
    const dragUid = ds.module._uid;
    // Fallback resolution when sourceIdx was invalidated mid-drag.
    // Prefer matching the per-instance _uid so the right sibling moves;
    // matching `m.id` (library uuid) would hit the FIRST sibling.
    const list = value.value.modules;
    const fromIdx = ds.sourceIdx >= 0 && ds.sourceIdx < list.length
      ? ds.sourceIdx
      : dragUid
        ? list.findIndex((mm) => mm._uid === dragUid)
        : list.findIndex((mm) => mm.id === ds.module.id);
    if (fromIdx < 0) return;
    const payload: DropPayload = { kind: "module", sourceIdx: fromIdx, sourceUid: dragUid ?? "" };
    const next = applyDrop(zone, payload, value.value);
    // Cross-scope detection for the FLIP/arriving animation seam.
    const movedRow = next.modules.find((mm) => mm._uid === dragUid);
    const newOrigin = (movedRow as ModuleEntry & { bundle_origin?: string } | undefined)?.bundle_origin ?? null;
    const crossScope = (ds.sourceBundleUid ?? null) !== newOrigin;
    if (crossScope && dragUid) excludeFromFlipSnapshot(flipSnap, dragUid);
    // Auto-expand the destination bundle when a row drops INTO it —
    // without this the child lands invisibly under a collapsed frame.
    const finalBundles = (next.bundles ?? []).map((b) =>
      newOrigin && b._uid === newOrigin && b.collapsed ? { ...b, collapsed: false } : b,
    );
    commitModules(next.modules, finalBundles);
    await nextTick();
    playFlipSnapshot(flipSnap);
    if (crossScope && dragUid && modulesContainer.value) {
      await animateEnterBatch([dragUid], modulesContainer.value);
    }
    pulseDrop(dragUid ?? undefined);
    sameNodeDropHandled = true;
    return;
  }

  // Same-node bundle move — applyDrop slices the range out + re-inserts
  // at the resolved position + rewrites parent_uid.
  if (ds.kind === "bundle" && ds.sourceNodeId === props.nodeId) {
    const payload: DropPayload = {
      kind: "bundle",
      bundleUid: ds.bundleUid,
      sourceStartIdx: ds.sourceStartIdx,
      sourceEndIdx: ds.sourceEndIdx,
    };
    const next = applyDrop(zone, payload, value.value);
    // No-op when applyDrop returns the same value object (self-drop
    // guard inside applyDrop fires for header on own uid). Still
    // clear drag state explicitly — browser's dragend may not fire
    // reliably after a bundle's DOM gets re-keyed by the patch, and
    // a lingering dragState keeps the "Drop here" affordance visible.
    if (next === value.value) {
      sameNodeDropHandled = true;
      dragState.value = null;
      return;
    }
    holdSuppressMove();
    commitModules(next.modules, next.bundles);
    await nextTick();
    playFlipSnapshot(flipSnap);
    // Pulse the bundle wrapper AND every row in its range so a
    // collapsed bundle still shows a landing flash.
    const rangeRows = next.modules.slice(
      (next.bundles ?? []).find((b) => b._uid === ds.bundleUid)?.start_idx ?? 0,
      ((next.bundles ?? []).find((b) => b._uid === ds.bundleUid)?.end_idx ?? -1) + 1,
    );
    pulseDrop([ds.bundleUid, ...rangeRows.map((r) => r._uid).filter((u): u is string => !!u)]);
    sameNodeDropHandled = true;
    // Belt-and-suspenders: clear drag state here too. The bundle
    // frame's dragend listener may not fire if Vue's reconciler
    // detaches the source frame during the same-tick patch.
    dragState.value = null;
    return;
  }

  // Cross-node bundle drag. Receiver splices the bundle's children
  // (with fresh _uid + remapped bundle_origin) into its modules array
  // at the zone-resolved position, and registers a fresh BundleInstance
  // for the outer + every inner. Source-uid → fresh-uid map preserves
  // the nesting chain across the cross-node trip. The resolver enforces
  // tier-2 cap, so the dropped outer's parent_uid stays null on
  // cross-node lands.
  if (ds.kind === "bundle") {
    const list = [...value.value.modules];
    const bundles = value.value.bundles ?? [];
    const { insertIdx } = resolveCrossNodeInsertion(zone, list, bundles);
    // Receiver's drop container becomes newBundle's parent_uid when
    // dropping INSIDE another bundle's body. Without this, the
    // newBundle is top-level while its children sit inside the
    // receiver bundle's range — reconcile sees non-contiguous indices
    // on the receiver and dissolves it.
    const outerParentUid = zone?.kind === "slot" ? zone.containerUid : null;
    const { newBundle, freshInners, newChildren } = buildCrossNodeBundleInsertion(
      {
        bundleUid: ds.bundleUid,
        libraryId: ds.libraryId,
        bundleName: ds.bundleName,
        bundleColor: ds.bundleColor,
        bundleCollapsed: ds.bundleCollapsed,
        bundleEnabled: ds.bundleEnabled,
        children: ds.children,
        innerInstances: ds.innerInstances,
      },
      insertIdx,
      outerParentUid,
      newRowUid,
      emptyBundleInstance,
    );
    list.splice(insertIdx, 0, ...newChildren);
    // reconcileBundleRanges (via commitModules) will recompute
    // start_idx/end_idx for every bundle from each child's bundle_origin
    // chain — the placeholder ranges on freshInners get overwritten.
    commitModules(list, [...bundles, newBundle, ...freshInners]);
    // Snap fingerprints on the freshly-cloned outer + inners so the
    // cross-node receive registers as a clean baseline (matches the
    // semantics of a library insert).
    {
      const justReceived = new Set<string>([
        newBundle._uid,
        ...freshInners.map((b) => b._uid),
      ]);
      value.value = {
        ...value.value,
        bundles: snapBundleFingerprints(value.value.bundles ?? [], value.value.modules, justReceived),
      };
    }
    await nextTick();
    playFlipSnapshot(flipSnap);
    pulseDrop([
      newBundle._uid,
      ...freshInners.map((b) => b._uid),
      ...newChildren.map((c) => c._uid).filter((u): u is string => !!u),
    ]);
    // consumedBy was claimed synchronously at the top of onDrop — see
    // the comment there. Re-assigning here would resurrect dragState
    // after the source widget's dragend cleared it, leaving a stale
    // payload visible to dragOver handlers until the next dragstart.
    return;
  }

  // Cross-node MODULE drop. Same dedupe rule as before.
  if (value.value.modules.some((m) => m.id === ds.module.id)) {
    const dupName = ds.module.meta?.name?.trim() || ds.module.type;
    pushToast(
      `"${dupName}" is already in this node. Use right-click → Duplicate to add another instance.`,
      { severity: "error" },
    );
    const existingEl = document.querySelector<HTMLElement>(
      `[data-module-id="${ds.module.id}"]`,
    );
    if (existingEl) {
      existingEl.classList.add("wp-module--shake");
      setTimeout(() => existingEl.classList.remove("wp-module--shake"), 220);
    }
    sameNodeDropHandled = true;
    return;
  }
  const isLibraryBacked = ds.module.type !== "fixed_values"
    || (ds.module.payload !== undefined && Object.keys(ds.module.payload ?? {}).length > 0);
  const baseInsert: ModuleEntry = isLibraryBacked
    ? { ...ds.module, _uid: newRowUid() }
    : { ...ds.module, id: newModuleId(), _uid: newRowUid() };
  const list = [...value.value.modules];
  const bundles = value.value.bundles ?? [];

  const { insertIdx, stamp } = resolveCrossNodeInsertion(zone, list, bundles);
  const inserted = { ...baseInsert } as ModuleEntry & { bundle_origin?: string };
  if (stamp) inserted.bundle_origin = stamp;
  else delete inserted.bundle_origin;
  list.splice(insertIdx, 0, inserted);
  const preBundles = bundles.map((b) =>
    stamp && b._uid === stamp && b.collapsed ? { ...b, collapsed: false } : b,
  );
  commitModules(list, preBundles);
  await nextTick();
  playFlipSnapshot(flipSnap);
  pulseDrop(inserted._uid);
  // consumedBy was claimed synchronously at the top of onDrop. See
  // the comment there for why we don't reassign post-await.
}

/** Map the slot DropZone to `{insertIdx, stamp}` for the cross-node
 *  insertion paths (where we're adding a NEW row/bundle to this widget
 *  rather than moving an existing one). Trivial under the slot model:
 *  insertIdx + containerUid go straight through. */
function resolveCrossNodeInsertion(
  zone: DropZone,
  modules: ModuleEntry[],
  _bundles: BundleInstance[],
): { insertIdx: number; stamp: string | undefined } {
  if (!zone) return { insertIdx: modules.length, stamp: undefined };
  return { insertIdx: zone.insertIdx, stamp: zone.containerUid ?? undefined };
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
};
provide(ModuleRowCtxKey, moduleRowCtx);

const bundleFrameCtx: BundleFrameCtx = {
  bundleChildDriftCount,
  isBundleLibraryDrifted,
  isBundleMissingFromLibrary,
  bundleInternalState,
  bundleLockState,
  bundleHeaderGap,
  isBundleDropTarget,
  isBundleSnapshotModified: (b: BundleInstance) => bundleSnapshotModified(b, value.value.modules),
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
      :upstream-resolved="resolvedForEditing"
      :sibling-vars="siblingNodeVars"
      :sibling-modules="value.modules"
      :chain-modules="chainModules"
      :via-option-pairs="editingModuleViaOptionPairs"
      :last-used-seed-reader="lastUsedSeedReader"
      @save="saveEditedModule"
      @close="editingIdx = null"
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
/* NOT wrapped in @layer wp-extension despite the rest of the
 * extension being layered. The block below has ~1000 lines of
 * interleaved rules whose cascade priority relative to
 * component-scoped (unlayered) Vue rules has been stable. Layering
 * this block would flip the priority of dozens of rules that
 * currently win source-order — visual regressions in modules,
 * bundles, summaries. The .wp-* namespace prefix is the primary
 * isolation here; consider re-introducing @layer per-section once
 * each section's cascade interaction is verified. */
.wp-context, .wp-context * { box-sizing: border-box; }

/* Mute / bypass dim. Litegraph dims the title bar + node frame natively
 * for modes 2/4 but leaves DOM-rendered widget content at full opacity.
 * Match the native dim so the runtime-skipped state reads consistently
 * — one less "is this thing actually doing anything?" question for the
 * user. Module rows stay editable (no pointer-events block); the dim is
 * a perceptual cue, not a functional gate. The corner pill names which
 * mode is active so muted vs. bypassed are distinguishable at a glance. */
.wp-context--muted {
  position: relative;
  opacity: 0.45;
  filter: saturate(0.6);
  transition: opacity var(--wp-motion-hover), filter var(--wp-motion-hover);
}
.wp-context--muted::before {
  /* Label dropped — the dim opacity + litegraph's native title bar
   * dim are enough signal. Keeping the empty pseudo so the existing
   * positioning rules don't dangle (cheap; renders nothing). */
  content: "";
  position: absolute;
  top: 4px;
  right: 6px;
  z-index: 4;
  padding: 0;
  border-radius: 999px;
  background: transparent;
  border: 0;
  color: var(--wp-text2);
  font-family: var(--wp-font-mono, monospace);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  pointer-events: none;
  opacity: 1;
}
.wp-context {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
  cursor: default;
}

.wp-modules {
  display: flex;
  flex-direction: column;
  gap: var(--wp-row-gap);
  /* Drop-bar anchor — the floating <BundleDropBar :container-uid="null">
   * is absolutely positioned and needs this as its offset parent so
   * its top/left coordinates resolve against the top-level scope. */
  position: relative;
}

/* ── Bundle frame (Phase 2 Task 10b) ───────────────────────────────
 * Bundle members + BundleHeader are flat siblings in the flex column.
 * The frame is drawn via per-row borders + bg tint, with negative
 * margins eliminating the row-gap so the box reads as ONE container.
 *
 * Bundle children also get a "compact" treatment: action buttons
 * hidden (edit via right-click), tighter padding, slightly indented.
 * Goal — children read as sub-items of the bundle, not as full
 * standalone modules competing for visual weight.
 *
 * Frame color from `--wp-bundle-color` set inline on each row from
 * `bundleStyleForModule()`. Fallback: `--wp-bundle-default`. */

/* BundleHeader carries the frame's top edge + side walls (rendered
 * inside its scoped styles, see BundleHeader.vue). Frame walls
 * continue from the header's bottom into the children below via
 * negative-margin overlap. */

/* Children visually NESTED inside the bundle frame:
 *   1. Horizontal margin shrinks them inward — they don't touch the
 *      frame walls, so the eye reads them as contained
 *   2. Tighter padding + smaller name font — they read as sub-items
 *   3. Smaller kind-icon + chip — proportional shrink to match
 *   !important throughout since density-pref `--wp-pad-row` token
 *   would otherwise win at the same specificity. */
.wp-module--in-bundle {
  margin-left: 8px !important;
  margin-right: 8px !important;
  /* Children render at their default row height — drag handle,
   * collapse caret, kind icon all read the same size as standalone
   * modules. Tighter padding here squeezed icons visually; reverted
   * to inherit `--wp-pad-row` from `.wp-module`.
   *
   * Background inherits from `.wp-module` (`var(--wp-bg3)`) — no
   * !important override here so `.wp-disabled`'s diagonal-stripe
   * gradient still wins when the child is disabled. */
}
/* All bundle children — including the first — keep the natural
 * flex row-gap of `.wp-modules` so there's breathing room between
 * the header and first child, and between siblings inside the
 * bundle. The overlay extends 6px below the last child for the
 * matching bottom-padding effect. */

/* Last bundle child gets extra margin-bottom so the overlay's
 * PAD_BOTTOM (6px below last child) doesn't overlap into the next
 * standalone module — keeps a visible gap after the bundle ends. */
.wp-module--bundle-last {
  margin-bottom: 8px !important;
}
/* Children render at full default row dimensions — no padding or
 * font overrides. Drag handle SVG, collapse caret, kind icon all
 * match the size they have on standalone modules.
 *
 * Belt-and-suspenders: re-declare the canonical sizes here with
 * !important so density-pref or other context-class overrides can't
 * shrink bundle child controls below their standalone equivalents. */
.wp-module--in-bundle .wp-drag-handle {
  width: 6px !important;
}
.wp-module--in-bundle .wp-collapse-btn {
  width: 14px !important;
}
.wp-module--in-bundle .wp-collapse-btn .pi {
  font-size: 10px !important;
}
.wp-module--in-bundle .wp-toggle-mark {
  width: 12px !important;
  height: 12px !important;
}
.wp-module--in-bundle .wp-row-type-icon {
  width: 16px !important;
  height: 16px !important;
}
.wp-module--in-bundle .wp-row-type-icon .pi {
  font-size: 12px !important;
  line-height: 1 !important;
}

/* Bundle as a real DOM container — header + children inside. Border
 * + bg paint via CSS on this div, growing/shrinking with content.
 *
 * Collapse/expand (Phase B.1) — pure CSS, no v-show, no JS measurement.
 * grid-template-rows transitions from `auto 1fr` (expanded) to `auto 0fr`
 * (collapsed); the children container needs min-height: 0 + overflow:
 * hidden for the row size to collapse to zero. opacity + padding on the
 * children fade together with the frame shrink. Header divider snaps off
 * at start of collapse and snaps on at end of expand via 0s transition
 * with strategic delays. */
.wp-modules-frame { position: relative; }
.wp-bundle {
  border: 1px solid var(--wp-bundle-color, var(--wp-bundle-default));
  border-left-width: 3px;
  border-radius: var(--wp-radius, 4px);
  background: color-mix(in srgb, var(--wp-bundle-color, var(--wp-bundle-default)) 5%, transparent);
  display: grid;
  grid-template-rows: auto 1fr;
  transition: grid-template-rows var(--wp-motion-collapse) var(--wp-motion-curve-collapse),
              border-width var(--wp-motion-quick) ease,
              background var(--wp-motion-quick) ease,
              box-shadow var(--wp-motion-quick) ease;
}
.wp-bundle--collapsed {
  grid-template-rows: auto 0fr;
}
/* Bundle disabled overlay — dims the entire frame (children included)
 * without touching each row's `wp-disabled` class. Children keep their
 * own `instance.enabled` state on the workflow side; the bundle gate is
 * purely visual. Re-enabling the bundle pops every row back to its
 * previous individual state with zero data loss. Matches the
 * BundleHeader's diagonal-stripe pattern via the same `.wp-disabled`
 * cosmetic vocabulary so a disabled bundle and a disabled module read
 * as cousins of the same off-state. */
.wp-bundle--disabled {
  opacity: 0.55;
  background: repeating-linear-gradient(
    45deg,
    var(--wp-bg3),
    var(--wp-bg3) 6px,
    var(--wp-bg2) 6px,
    var(--wp-bg2) 8px
  );
}
.wp-bundle--disabled .wp-bundle-children {
  /* Stripes shine through; lighten children one notch so the bundle
   * stripe pattern reads as a single overlay across header + body. */
  background: transparent;
}
.wp-bundle-children {
  padding: 5px 6px 7px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow: hidden;
  opacity: 1;
  transition: opacity var(--wp-motion-collapse) var(--wp-motion-curve-collapse),
              padding var(--wp-motion-collapse) var(--wp-motion-curve-collapse);
}
.wp-bundle--collapsed .wp-bundle-children {
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
/* Per-module animation INSIDE a bundle — modules actively fade + slide
 * up toward the header during collapse, not just get clipped. This is
 * what makes the joint motion visually obvious vs. "frame snaps and
 * children disappear instantly". Overrides the default .wp-module
 * transition (lines below) for the duration / curve. */
.wp-bundle-children .wp-module {
  transition: opacity var(--wp-motion-collapse) var(--wp-motion-curve-collapse),
              transform var(--wp-motion-collapse) var(--wp-motion-curve-collapse),
              background var(--wp-motion-quick) ease,
              border-color var(--wp-motion-quick) ease;
}
.wp-bundle--collapsed .wp-bundle-children .wp-module {
  opacity: 0;
  transform: translateY(-8px);
  pointer-events: none;
}
/* Drop-target highlight — fires when the slot zone's container is
 * this bundle's body. Single rule covers in-bundle reorder AND
 * crossing into the bundle from outside, since "drop will land here"
 * is the same affordance either way.
 *
 * Visual mix:
 *   - 28% bundle-color background tint → frame body brightens in its
 *     own color (preserves identity, no color clash).
 *   - 3px solid bundle-color outer ring → frame edge stands forward
 *     from sibling rows without using a foreign accent hue.
 *   - 10px soft glow at 60% bundle-color → silhouette pop so the
 *     affordance reads under ComfyUI's canvas zoom-out.
 *
 * Earlier version used --wp-accent-glow (15% alpha) — barely visible
 * under canvas zoom + against the standard frame border. Switched to
 * solid bundle-color so the receiving container reads at a glance. */
.wp-bundle.wp-bundle--drop-target {
  background: color-mix(
    in srgb,
    var(--wp-bundle-color, var(--wp-bundle-default)) 16%,
    transparent
  );
  box-shadow:
    0 0 0 2px var(--wp-bundle-color, var(--wp-bundle-default)),
    0 0 8px 0 color-mix(
      in srgb,
      var(--wp-bundle-color, var(--wp-bundle-default)) 30%,
      transparent
    );
}
/* Header divider — snap off at start of collapse, snap on at END of expand.
 * Default rule (no collapsed class) waits MOTION_COLLAPSE_MS before snapping
 * border-bottom visible; collapsed rule snaps immediately to 0-width so
 * the row consumes NO extra height. Previously the divider stayed at 1px
 * with `border-bottom-color: transparent`, which made collapsed bundles
 * render 1px taller than collapsed modules — the user spotted that the
 * two row types didn't match in compact state. */
.wp-bundle .wp-bundle-header {
  transition: border-bottom-color 0s var(--wp-motion-collapse), border-bottom-width 0s var(--wp-motion-collapse);
}
.wp-bundle--collapsed .wp-bundle-header {
  border-bottom-width: 0;
  border-bottom-color: transparent;
  transition: border-bottom-color 0s 0s, border-bottom-width 0s 0s;
}
/* Caret rotation tied to bundle collapsed state — replaces the previous
 * icon-class swap (pi-caret-down ↔ pi-caret-right). The BundleHeader
 * template now always renders pi-caret-down so the CSS rotation owns
 * the transition. */
.wp-bundle .wp-bundle-collapse {
  transition: transform var(--wp-motion-collapse) var(--wp-motion-curve-collapse);
}
.wp-bundle--collapsed .wp-bundle-collapse {
  transform: rotate(-90deg);
}

/* Populated ↔ Empty page swap. */
.wp-page { display: flex; flex-direction: column; gap: 6px; }
.wp-page-enter-active,
.wp-page-leave-active {
  transition: opacity var(--wp-motion-fade) ease;
}
.wp-page-enter-from,
.wp-page-leave-to {
  opacity: 0;
}

/* ── Corrupt-workflow recovery (5.6) ──────────────────────────────────── */
.wp-recovery {
  background: rgba(248, 113, 113, 0.06);
  border: 1px solid var(--wp-red);
  border-radius: var(--wp-radius-sm);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wp-recovery__header { display: flex; gap: 8px; align-items: flex-start; }
.wp-recovery__icon {
  color: var(--wp-red);
  font-size: 14px;
  padding-top: 2px;
  flex-shrink: 0;
}
.wp-recovery__msg { flex: 1; min-width: 0; }
.wp-recovery__msg strong {
  color: var(--wp-text);
  font-size: 12px;
  display: block;
}
.wp-recovery__detail {
  color: var(--wp-text2);
  font-size: 11px;
  font-family: var(--wp-font-mono, monospace);
  margin-top: 2px;
  word-break: break-word;
}
.wp-recovery__actions { display: flex; gap: 6px; }
.wp-recovery__btn {
  flex: 1;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text2);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background var(--wp-motion-quick), border-color var(--wp-motion-quick), color var(--wp-motion-quick);
}
.wp-recovery__btn:hover {
  background: var(--wp-bg4);
  border-color: var(--wp-border2);
  color: var(--wp-text);
}
.wp-recovery__btn--danger {
  color: var(--wp-red);
  border-color: var(--wp-red);
}
.wp-recovery__btn--danger:hover {
  background: var(--wp-red-bg);
  color: var(--wp-red);
}
.wp-recovery__raw {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 6px 8px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px;
  color: var(--wp-text3);
  max-height: 120px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ── Section label (matches assembler + picker) ──────────────────────── */
.wp-section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--wp-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text3);
  padding: 0 2px;
  margin-top: 2px;
}
.wp-section-label__icon {
  font-size: 10px;
  color: var(--wp-violet);
}
.wp-section-label__count {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--wp-violet-bg);
  color: var(--wp-violet);
  letter-spacing: 0;
}

/* Bulk collapse/expand toggle — pushed to the right of the row via
 * auto-margin. Compact text-button shape so it doesn't clash with
 * per-card chevrons + matches the section-label's mono/uppercase
 * vibe. */
.wp-section-label__bulk {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text3);
  cursor: pointer;
  font-family: var(--wp-font-mono, monospace);
  font-size: 9px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 6px;
  transition: color var(--wp-motion-quick), border-color var(--wp-motion-quick), background var(--wp-motion-quick);
}
.wp-section-label__bulk:hover {
  color: var(--wp-text);
  border-color: var(--wp-border);
  background: var(--wp-bg2);
}
.wp-section-label__bulk .pi { font-size: 9px; }
.wp-section-label__bulk--drift {
  border-color: var(--wp-warn);
  color: var(--wp-warn);
}
.wp-section-label__bulk--drift:hover {
  /* Re-assert drift colour because base `:hover` flips both `color` +
   * `border-color` to the neutral text/border tokens; equal-specificity
   * selectors lose the cascade race otherwise and the amber accent
   * vanishes on hover. */
  color: var(--wp-warn);
  border-color: var(--wp-warn);
  background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
}

/* ── Empty-state hero (Task 10) ─────────────────────────────────────────
 * Brand-glyph hero with "No modules yet" copy + dual CTA. Replaces the
 * old .wp-emptystate layout (logo + "Wildcard Pipeline" title). */
.wp-empty-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px dashed var(--wp-border-soft, var(--wp-border2));
  border-radius: var(--wp-radius, 4px);
  gap: 10px;
  text-align: center;
  transition: border-color var(--wp-motion-quick) ease, background var(--wp-motion-quick) ease;
}
.wp-empty-hero--drop-target {
  border-color: var(--wp-accent);
  background: color-mix(in srgb, var(--wp-accent) 8%, var(--wp-bg-deep, var(--wp-bg)));
}
.wp-empty-hero-glyph {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.85;
  /* Defensive: SVG paths default to `pointer-events: visiblePainted` and
   * the logo's painted area extends to the very edges of its 1024×1024
   * viewBox. Keep hit-testing off the glyph regardless of layout
   * surprises (overflow, sibling stacking, etc.) so place-mode clicks
   * always fall through to the canvas. */
  pointer-events: none;
}
.wp-empty-hero-glyph :deep(svg) {
  width: 100%;
  height: 100%;
}
.wp-empty-hero-title { font: 500 13px/1.3 var(--wp-font-sans); color: var(--wp-text); }
.wp-empty-hero-sub   { font: 11px/1.5 var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text2)); max-width: 280px; }
.wp-empty-hero-actions { display: flex; gap: 6px; margin-top: 4px; }

/* Kept for CSS cascade completeness — actual value that gets used in
 * empty-state CTA is via .wp-btn--primary below. Placeholder rule to avoid
 * breaking any potential refs to these old class names (none after Task 10). */
.wp-emptystate__cta {
  background: var(--wp-brand-gradient);
  border: none;
  border-radius: var(--wp-radius-sm);
  color: #fff;
  font-family: var(--wp-font-sans);
  font-size: 12px;
  font-weight: 600;
  padding: 9px 18px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  letter-spacing: 0.02em;
  /* Dimmed at rest; hover lifts to full brand saturation. */
  filter: brightness(0.82) saturate(0.85);
  transition: filter var(--wp-motion-hover);
}
.wp-emptystate__cta:hover { filter: brightness(1) saturate(1); }
.wp-emptystate__cta:focus-visible {
  outline: 2px solid var(--wp-violet);
  outline-offset: 2px;
}

.wp-module {
  background: var(--wp-bg3);
  border: 1px solid var(--wp-border);
  border-left-width: 3px;
  border-left-color: var(--wp-kind-wildcard);
  border-radius: var(--wp-radius-sm);
  padding: var(--wp-pad-row);
  display: flex;
  flex-direction: column;
  /* Gap applied directly to the collapse-row when visible (rule
   * below). Flex `gap: 4px` would otherwise paint a 4px band
   * BELOW the header even when `.wp-collapse-row[data-collapsed=
   * "true"]` has 0 track height, pushing the header off the
   * module's visual mid-line. Bundle had the matching 1px header
   * border-bottom residual fixed in a separate rule below so
   * collapsed bundles and collapsed modules now both render flush
   * around their header. */
  /* `position: relative` is the anchor for the ::before / ::after
   * insertion-line pseudos used by the drop indicators below. */
  position: relative;
  transition: background-color var(--wp-motion-hover), border-color var(--wp-motion-hover), transform var(--wp-motion-hover), box-shadow var(--wp-motion-hover);
}
.wp-module .wp-collapse-row { margin-top: 4px; }
.wp-module .wp-collapse-row[data-collapsed="true"] { margin-top: 0; }
/* Kind border-left color — driven by data-kind attribute (Task 8). */
.wp-module[data-kind="combine"]      { border-left-color: var(--wp-kind-combine); }
.wp-module[data-kind="derivation"]   { border-left-color: var(--wp-kind-derivation); }
.wp-module[data-kind="constraint"]   { border-left-color: var(--wp-kind-constraint); }
.wp-module[data-kind="fixed_values"] { border-left-color: var(--wp-kind-fixed); }
.wp-module:hover {
  border-color: var(--wp-border2);
  background: var(--wp-bg4);
}
.wp-module:focus {
  outline: none;
  border-color: var(--wp-accent);
  box-shadow: 0 0 0 1px var(--wp-accent);
}
.wp-module:focus-visible {
  outline: none;
  border-color: var(--wp-accent);
  box-shadow: 0 0 0 2px var(--wp-accent-glow);
}
.wp-module.wp-disabled {
  opacity: 0.55;
  background: repeating-linear-gradient(
    45deg,
    var(--wp-bg3),
    var(--wp-bg3) 6px,
    var(--wp-bg2) 6px,
    var(--wp-bg2) 8px
  );
}
.wp-module.wp-disabled .wp-module-name { color: var(--wp-text3); }

/* Card-border tint by state — severity cascade (last selector wins).
 * Order: info → modified → warning → drift → missing → error. */
.wp-module.wp-conflict-info     { border-color: var(--wp-accent); }
.wp-module.wp-state-modified    { border-color: var(--wp-status-modified); }
.wp-module.wp-conflict-warning  { border-color: var(--wp-amber); }
.wp-module.wp-state-drift       { border-color: var(--wp-warn); }
.wp-module.wp-state-missing     { border-color: var(--wp-danger); }
.wp-module.wp-conflict-error    { border-color: var(--wp-red); }
/* Status-state full-border + bg tint, kind border-left preserved. */
.wp-module.wp-mod--mod   { border-color: var(--wp-status-modified); background: color-mix(in srgb, var(--wp-status-modified) 8%, var(--wp-bg3)); }
.wp-module.wp-mod--drift { border-color: var(--wp-warn);            background: color-mix(in srgb, var(--wp-warn) 8%, var(--wp-bg3)); }
.wp-module.wp-mod--err   { border-color: var(--wp-danger);          background: color-mix(in srgb, var(--wp-danger) 8%, var(--wp-bg3)); }

/* Gap metaphor: target row gets margin so a slot opens; the
 * `.wp-gap-bar` element paints inside that slot. Margin transitions
 * via the row's existing `transition: transform/...` rule below; we
 * extend it to cover `margin`. */
.wp-module.wp-gap-before,
.wp-bundle-header.wp-gap-before,
.wp-w-footer.wp-gap-before { margin-top: 14px; }
.wp-module.wp-gap-after { margin-bottom: 14px; }
/* Margins snap (no transition) so back-to-back zone changes don't
 * leave half-open gaps mid-flight. Transform/opacity/etc still animate
 * via TransitionGroup's FLIP rules + the wp-list-* classes below. */
.wp-modules .wp-module {
  transition: transform var(--wp-motion-fade) var(--wp-motion-curve-flip),
    background var(--wp-motion-quick) ease, border-color var(--wp-motion-quick) ease, opacity var(--wp-motion-quick) ease;
}
.wp-bundle-header { transition: border-bottom-color var(--wp-motion-fade) ease, background var(--wp-motion-quick) ease; }
.wp-bundle {
  transition: border-width var(--wp-motion-quick) ease, background var(--wp-motion-quick) ease, box-shadow var(--wp-motion-quick) ease;
}
.wp-bundle.wp-gap-before { margin-top: 14px; }
.wp-bundle.wp-gap-after { margin-bottom: 14px; }

/* Source ghost — lift the row while it's mid-drag. */
.wp-module--dragging {
  opacity: 0.45;
  transform: scale(0.98);
}
.wp-bundle--dragging {
  opacity: 0.55;
  transform: scale(0.99);
  box-shadow: 0 10px 24px rgba(0,0,0,0.45);
}

/* Drop-pulse + library-flash + drop-shake keyframes → moved to
 * src/components/shared/row-primitives.css so InjectorRow can use
 * the same animations. .wp-module--flash kept here as an alias to
 * the shared .wp-row-flash so existing flip.ts default classes
 * still work for Context's library-op flash path. */
.wp-module--flash { animation: wp-row-flash var(--wp-motion-pulse) ease-out; }
.wp-module--shake { animation: wp-row-shake var(--wp-motion-swap) ease-in-out; }

/* Module header — flex row with every control centered on the
 * row's mid-line. Mirrors `.wp-bundle-header`'s typography stack
 * (`font: 500 11px/1.4 sans`) so a standalone module row and a
 * bundle header read with identical chrome — same baseline rules,
 * same visual heft. `.wp-row-type-icon .pi { line-height: 1 }`
 * keeps the PrimeIcons glyphs from inheriting the 1.4 line-box,
 * which would overflow their fixed-size container on Windows + DPI
 * != 1 and round the icon a hair above the action-button siblings. */
.wp-module-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 500 11px/1.4 var(--wp-font-sans);
  color: var(--wp-text);
}
.wp-module-header > * { align-self: center; }
.wp-module-header .wp-row-type-icon .pi { line-height: 1; }

/* Drag handle — grab cursor scoped here, full card stays draggable. */
/* .wp-drag-handle base styles → src/components/shared/row-primitives.css */
.wp-module:hover .wp-drag-handle,
.wp-module:focus-within .wp-drag-handle { opacity: 1; color: var(--wp-text2); }

/* .wp-collapse-btn base → src/components/shared/row-primitives.css.
 * Module-specific: PrimeIcons sets 16px on `.pi` itself; our shared
 * rule sets 10px which matches what Context wanted. */

.wp-toggle { display: flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.wp-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.wp-toggle-mark {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  border: 1px solid var(--wp-border2);
  background: var(--wp-bg2);
  transition: background-color var(--wp-motion-hover), border-color var(--wp-motion-hover), box-shadow var(--wp-motion-hover);
}
.wp-toggle input:checked + .wp-toggle-mark { background: var(--wp-accent); border-color: var(--wp-accent); }
.wp-toggle input:focus-visible + .wp-toggle-mark {
  /* Distinct from accent so the ring stays visible whether the toggle is
   * on (accent fill) or off (transparent fill). */
  box-shadow: 0 0 0 2px var(--wp-violet);
}

/* Type icon — colored per type so users scan-recognize the module type */
.wp-type-icon {
  font-size: 12px;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}
.wp-type-icon.type-fixed_values { color: var(--wp-kind-fixed, var(--wp-rose)); }
.wp-type-icon.type-wildcard     { color: var(--wp-kind-wildcard); }
.wp-type-icon.type-combine      { color: var(--wp-kind-combine); }
.wp-type-icon.type-derivation   { color: var(--wp-kind-derivation); }
.wp-type-icon.type-constraint   { color: var(--wp-kind-constraint); }

/* Kind icon — canonical PrimeIcons per module type (Task 8).
 * Base styles live in src/components/shared/row-primitives.css under
 * `.wp-row-type-icon`. Color follows the same --wp-kind-* token map
 * as the border-left. Default color override (wildcard) + bump font
 * size to 12 to match Module density. */
.wp-row-type-icon { color: var(--wp-kind-wildcard); }
.wp-row-type-icon .pi { font-size: 12px; }
.wp-module[data-kind="combine"]      .wp-row-type-icon { color: var(--wp-kind-combine); }
.wp-module[data-kind="derivation"]   .wp-row-type-icon { color: var(--wp-kind-derivation); }
.wp-module[data-kind="constraint"]   .wp-row-type-icon { color: var(--wp-kind-constraint); }
.wp-module[data-kind="fixed_values"] .wp-row-type-icon { color: var(--wp-kind-fixed); }

.wp-module-name {
  flex: 1;
  font-size: var(--wp-mod-font);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* .wp-conflict-dot + .wp-conflict-badge + severity variants →
 * src/components/shared/row-primitives.css. Kept commented anchor
 * here for grep discoverability — every row-list widget consumes
 * the same cluster (ModuleRow, InjectorRow, future Debug rows). */

/* Cluster wrapper — keeps every status dot (modified, missing,
 * conflict) on one inline run so they never get separated by
 * interactive controls. Empty cluster collapses (no children → no
 * gap), so cards without indicators look unchanged. */
.wp-mod-dots {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  /* Cap so a long stack of state badges (mod + drift + missing +
   * override) doesn't push action buttons off the row. Wrap to a
   * second line if needed — module card grows slightly taller, but
   * the name + action cluster stay aligned. */
  max-width: 50%;
  justify-content: flex-end;
}
.wp-mod-dots:empty { display: none; }

/* Per-instance / library-state dots — distinct from conflict dots
 * (which signal STRUCTURAL graph issues). All three share the SPA
 * `.wp-chip--*` color triple (bg = token@14%, border = token@36%) so
 * dots, IO badges, and chips all encode "this hue means X" the same
 * way. ComfyUI's canvas zooms widgets down hard, so shape-based
 * differentiation (rings, dashed borders) disappears at typical view
 * distances — colour does all the work.
 *
 * Token map — kept in sync with `src/manager/views/ImportExport.vue`:
 *   modified → --wp-status-modified  (SPA "mod"      — user diff)
 *   drift    → --wp-warn             (SPA "exists"   — overwriteable)
 *   missing  → --wp-danger           (no SPA twin    — gone from lib)
 */
.wp-mod-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: help;
  border: 1px solid transparent;
}
/* Bg stays chip-style translucent (14%), but border uses the full
 * token hue: at 7×7 + canvas zoom-out, a 36% border like the SPA
 * chips fades into the card surface. Pills at 11px+ get to be
 * subtle; dots at canvas scale need the saturation. */
.wp-mod-dot--modified {
  background:   color-mix(in oklab, var(--wp-status-modified) 14%, transparent);
  border-color: var(--wp-status-modified);
}
.wp-mod-dot--drift {
  background:   color-mix(in oklab, var(--wp-warn) 14%, transparent);
  border-color: var(--wp-warn);
}
.wp-mod-dot--missing {
  background:   color-mix(in oklab, var(--wp-danger) 14%, transparent);
  border-color: var(--wp-danger);
}
/* clash → --wp-accent (violet): id reused by a DIFFERENT kind. Distinct
 * from modified/drift/missing so a cross-kind collision reads at a glance. */
.wp-mod-dot--clash {
  background:   color-mix(in oklab, var(--wp-accent) 14%, transparent);
  border-color: var(--wp-accent);
}

/* ── Sibling badge ──────────────────────────────────────────────────────
 * Rendered when the same uuid appears more than once in this Context.
 * Phase A: count display only. Phase B will wire auto-fork prompt. */
/* .wp-mod-badge + .wp-mod-badge--* + .wp-mod-badge--sibling →
 * src/components/shared/row-primitives.css. */

/* Status text-badges (mockup v5 lines 714, 736, 861) — kind-tinted
 * label that pairs with the matching `.wp-mod-dot--*` so users see
 * BOTH the colour glance and the textual state. Kind palette is the
 * same triple used by the dot cluster:
 *   --wp-status-modified  → "mod"     (user diff vs library)
 *   --wp-warn             → "drift"   (library has a newer version)
 *   --wp-warn             → "no link" (Injector socket — re-uses drift hue)
 *   --wp-danger           → "missing" (gone from library)
 */
/* Hover cursor for the status text badges — kept here (not in
 * shared) because cursor:help is a Context-row-specific UX
 * decision (the badges have hover-tooltips that explain the state). */
.wp-mod-badge--mod,
.wp-mod-badge--drift,
.wp-mod-badge--missing { cursor: help; }
/* .wp-mod-badge--mod/drift/missing color rules → row-primitives.css */

/* `.wp-kind-chip` rules live in shared/theme.css so the chip stays
 * visually identical across the row, picker, and edit-modal header.
 * Kept as a comment-only anchor here for grep discoverability. */

/* ── Inline action cluster (lock + internal + remove) ───────────────────
 * Always visible (was hover-revealed) — discoverability over chrome.
 * Uses PrimeIcons via `pi` class (Task 9). Replaces the old
 * wp-card-toggle + wp-icon-btn / wp-delete pattern. */
.wp-mod-actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}
/* .wp-btn--icon-sm + variants (.is-active, .is-locked, .wp-btn--danger)
 * → src/components/shared/row-primitives.css. Used by ModuleRow,
 * BundleHeader, InjectorRow, and any future row surface that needs
 * a small icon button. */

/* .wp-summary + .wp-summary__main base styles → row-primitives.css.
 * Default padding-left:36px aligns under the module header's icon
 * column (drag+collapse+toggle+icon = 36px); InjectorRow can
 * override in its scoped block if its header column widths differ. */
.wp-summary__sibling {
  font-family: var(--wp-font-mono);
  font-size: 9px;
  color: var(--wp-text2);
  background: color-mix(in srgb, var(--wp-text3) 22%, transparent);
  padding: 2px 6px;
  border-radius: 999px;
  flex-shrink: 0;
  cursor: help;
}
/* Var tokens inside the summary — re-use the same kind-color hashing
 * as the assembler chip strip + combine preview so the eye reads
 * `$hair_style` as the same hue everywhere it appears. Color comes
 * from the `.var-N` class set by `varColorClass()` (defined in the
 * shared theme); we only bump font-weight here. NO color override —
 * Vue's scoped specificity would beat the unscoped `.var-N` rule
 * and force the fallback colour, which would silently blank the
 * highlighting (the user-facing bug fixed here). */
.wp-summary .var-tok {
  font-weight: 600;
}

/* ── Toolbar (Task 10) ──────────────────────────────────────────────────
 * Replaces wp-section-label for the populated header row. */
.wp-w-toolbar { display: flex; align-items: center; gap: 4px; padding: 4px 0 8px; }
.wp-w-toolbar-label { font: 500 11px/1 var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text3)); text-transform: lowercase; letter-spacing: 0.02em; }
.wp-w-count { font: 500 11px/1 var(--wp-font-mono); color: var(--wp-text-dim, var(--wp-text3)); padding: 2px 6px; background: var(--wp-bg-deep, var(--wp-bg)); border-radius: var(--wp-radius, 4px); }
.wp-w-toolbar-spacer { flex: 1; }

/* ── Node identity chip (SP3 P7) ────────────────────────────────────────
 * A small, unobtrusive header strip naming this WP_Context node. Amber
 * accent (matches the design proposal); sits above the toolbar/hero in a
 * compact row so it never disturbs their layout. */
.wp-node-id { display: flex; align-items: center; gap: 6px; padding: 2px 0 4px; }
.wp-node-id__tag {
  font: 500 10px/1 var(--wp-font-sans, sans-serif);
  color: var(--wp-text-dim, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.wp-node-id__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 2px 8px;
  font: 600 11px/1.2 var(--wp-font-sans, sans-serif);
  /* Neutral — a fixed codename is an identity, not an attention cue (was
     amber). Muted text + a faint text-tinted wash + standard border, the
     same neutral idiom used elsewhere in the widget; reads on light + dark. */
  color: var(--wp-text-muted, var(--wp-text2));
  background: color-mix(in srgb, var(--wp-text) 6%, transparent);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 4px);
}
/* Fixed codename — a read-only identity, not an interactive control. */
.wp-node-id__chip--fixed { cursor: default; }
.wp-node-id__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Generic button system (Task 10) ────────────────────────────────────
 * .wp-btn--icon-sm (Task 9) already exists for inline card actions;
 * these are the larger toolbar/footer variants. */
.wp-btn {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border2);
  color: var(--wp-text);
  font: 500 11px/1 var(--wp-font-sans);
  padding: 5px 9px;
  border-radius: var(--wp-radius, 4px);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background var(--wp-motion-quick) ease, border-color var(--wp-motion-quick) ease;
}
.wp-btn:hover { background: var(--wp-bg4); border-color: var(--wp-border, var(--wp-border2)); }
.wp-btn--icon { padding: 5px 6px; width: 26px; height: 26px; justify-content: center; }
.wp-btn--icon .pi { font-size: 12px; }
.wp-btn--primary { background: var(--wp-accent); border-color: var(--wp-accent); color: #fff; }
.wp-btn--primary:hover { background: var(--wp-accent); border-color: var(--wp-accent); filter: brightness(1.08); }

/* ── Footer (Task 10) ───────────────────────────────────────────────── */
.wp-w-footer { display: flex; gap: 4px; padding-top: 4px; border-top: 1px dashed var(--wp-border-soft, var(--wp-border2)); }
.wp-w-footer .wp-btn { flex: 1; justify-content: center; }

.wp-drop-end {
  display: none;
  border: 1px dashed var(--wp-border2);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text3);
  font-size: 11px;
  text-align: center;
  padding: 6px;
  margin-top: 4px;
  font-style: italic;
}
.wp-drop-end--show { display: block; }
.wp-drop-end--active {
  border-color: var(--wp-accent);
  background: var(--wp-accent-glow);
  color: var(--wp-accent);
}

/* ── Animations ─────────────────────────────────────────────────────── */

/* FLIP reorder — TransitionGroup applies wp-list-move when items reorder. */
.wp-list-move { transition: transform var(--wp-motion-flip) ease-out; }
/* Leave is instant. `.wp-module` declares `transition: transform var(--wp-motion-hover)`
 * as its base, which makes Vue's TransitionGroup wait for a phantom
 * transitionend before tearing leaving rows out. Killing the transition
 * on leave-active short-circuits that wait. */
.wp-list-leave-active { transition: none !important; }
/* Bundle delete / bundle drag suppress both FLIP move AND leave-active
 * transitions for the full 300ms hold so the overlay, children, and
 * follow-up rows all reposition on the same paint (#5 jank + #8). */
.wp-modules[data-suppress-move="true"] .wp-list-move,
.wp-modules[data-suppress-move="true"] .wp-list-leave-active {
  transition: none !important;
}
/* Items entering the list (e.g. add via picker) — fade + slide in.
 * Leave is intentionally instant; the dying card lingering during a
 * fade-out felt sluggish, especially when chained with a FLIP move. */
.wp-list-enter-active { transition: opacity var(--wp-motion-swap), transform var(--wp-motion-swap); }
.wp-list-enter-from { opacity: 0; transform: translateY(-4px); }

/* ── Cross-container enter/leave + module add/remove (Phase B.3 + B.6) ──
 * Manual orchestration via flip.ts:withEnterAnimation/withLeaveAnimation.
 * No TransitionGroup — Batch 2 ghosting risk. Classes applied + removed
 * by orchestration helpers; a row is in one state at a time. */
.wp-module.wp-module--leaving,
.wp-bundle.wp-module--leaving {
  opacity: 0;
  transform: translateX(-12px);
  transition: opacity var(--wp-motion-fade) var(--wp-motion-curve-linear),
              transform var(--wp-motion-flip) var(--wp-motion-curve-flip);
  pointer-events: none;
}
.wp-module.wp-module--arriving,
.wp-bundle.wp-module--arriving {
  /* Snap to from-state. Without `transition: none` the base
   * `.wp-modules .wp-module` transition (opacity var(--wp-motion-quick)) starts fading
   * the row OUT when we add --arriving, then --arrived fights back —
   * net effect is a barely-visible flicker instead of clear fade-in. */
  opacity: 0;
  transform: translateX(12px);
  transition: none;
}
.wp-module.wp-module--arrived,
.wp-bundle.wp-module--arrived {
  opacity: 1;
  transform: translateX(0);
  transition: opacity var(--wp-motion-fade) var(--wp-motion-curve-linear),
              transform var(--wp-motion-flip) var(--wp-motion-curve-flip);
}

/* `.wp-collapse-row` utility → row-primitives.css. Wraps the summary
 * line for both ModuleRow and InjectorRow, interpolating a grid track
 * from 1fr → 0fr (same trick as `.wp-bundle` and
 * `.wp-inj-rows-wrap`). Replaces the older `wp-collapse` Vue
 * transition that capped at a 32px max-height. */

/* Pulse on first appear — applies uniformly to every state-marker dot
 * (mod / drift / missing AND every conflict severity) so the user gets
 * the same visual cue regardless of which state surfaced. Previously
 * only `.wp-conflict-dot` carried the animation, which made conflict
 * dots feel different from mod-state dots in side-by-side testing. */
.wp-conflict-dot,
.wp-mod-dot {
  animation: wp-pulse 800ms ease-out;
}
@keyframes wp-pulse {
  0%   { transform: scale(0.4); opacity: 0; }
  40%  { transform: scale(1.4); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

</style>
