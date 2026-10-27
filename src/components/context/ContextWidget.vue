<script setup lang="ts">
import { ref, computed, watch, provide, defineAsyncComponent } from "vue";
import {
  buildBundleEnabledMap,
  isModuleEffectivelyEnabled,
  parseWidgetJsonWithRecovery, serializeWidgetJson,
  emptyContextValue, newRowUid,
  type ContextWidgetValue, type ModuleEntry,
} from "../../widgets/_shared";
import { type ResolvedValue } from "../../widgets/richTokenize";
import type { ChainModule, PairingBadge, RowPairings } from "../../extension/constraint-pairs";
import { baseCodename } from "../../extension/node-codename";
import { derivationTargets } from "../../extension/derivation-conditions";
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
import { reconcileBundleRanges } from "./bundles/drag";
import { bundleSnapshotModified, ensureBundleFingerprints } from "./bundles/bundle-fingerprint";
import BundleDropBar from "./bundles/BundleDropBar.vue";
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
import ContextMenu from "../shared/ContextMenu.vue";
import { dragState } from "./drag-store";
import { useContextDrag } from "./context-drag";
import type { WidgetState } from "./widget-state";
import { createModuleOps } from "./module-ops";
import { useContextMenus } from "./context-menus";
import { useContextConflicts } from "./context-conflicts";
import { siblingInfo, summaryFor, summaryTokens } from "./module-summary";
import {
  effectiveEnabled,
  effectiveLockedSeed,
  frameEnableOverride,
  isCollapsed,
  isHeld,
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
import { useLibrarySync } from "./library-sync";
import {
  bundleChildDriftCount,
  isBundleLibraryDrifted,
  isBundleMissingFromLibrary,
  isBundleUnlinked,
  isDrifted,
  isMissingFromLibrary,
  isTypeConflict,
} from "./library-status";
import ConfirmDialog from "../shared/ConfirmDialog.vue";
import ContextRecoveryPanel from "./ContextRecoveryPanel.vue";
import ContextToolbar from "./ContextToolbar.vue";
import ContextAddActions from "./ContextAddActions.vue";

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

// Phase B: track the currently-edited module by INDEX, not id —
// sibling rows share `m.id`, so a id-keyed editing state would open
// (and save into) the FIRST sibling regardless of which one the user
// double-clicked. Indexing into `value.modules` directly disambiguates.
const editingIdx = ref<number | null>(null);

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

const librarySync = useLibrarySync(widgetState);
const {
  driftedCount, refreshAllDrifted,
  pushDraft, pushOpen, onPushSaved, onPushClosed,
  pushBundleDraft, pushBundleChildrenForLibrary, pushBundleChildrenPreview,
  pushBundleOpen, pushBundleCascadeScan,
  pushBundleCascadeRestore, onBundlePushSaved, onBundlePushClosed,
} = librarySync;

const bundleOps = createBundleOps(widgetState, holdSuppressMove);
const { pendingConfirm, onPickBundle, frameCtx: bundleOpsFrameCtx } = bundleOps;
// Lock / Hide masters: exactly the BundleFrame ctx members of the same names.
const masterToggles = createBundleMasterToggles(widgetState, props);
const { bundleInternalState, bundleLockState } = masterToggles;
const bundleEdit = useBundleEdit(widgetState, { ...masterToggles, ...librarySync, ...bundleOps });
const {
  bundleDraft, bundleLibraryDefaults, editingBundleEntry,
  onBundleEditUpdate, saveBundleEdit, cancelBundleEdit, onBundleEditToggleLock,
  onBundleEditToggleInternal, onBundleEditSaveToLibrary, onBundleEditResetToLibrary,
} = bundleEdit;

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

const {
  conflictsByModule, viaInboundFor, rowCtx: conflictRowCtx,
} = useContextConflicts(widgetState, props);

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

const moduleOps = createModuleOps(widgetState, props, showPicker, editingIdx);
const {
  onPickerAdd, collapseAll, expandAll, toggleAllEnabled,
  saveEditedModule, revertEditingFrame, rowCtx: opsRowCtx,
} = moduleOps;
const { ctxMenu, openContextMenu, openBundleContextMenu } = useContextMenus(widgetState, {
  ...moduleOps, ...librarySync, ...bundleOps, ...bundleEdit,
});

const topLevelItems = computed(() =>
  buildTopLevelItems(value.value.modules, value.value.bundles ?? []));

const moduleRowCtx: ModuleRowCtx = {
  KIND_TITLE,
  kindIcon, kindChipModifier, varColorClass,
  isCollapsed, isLocked, isInternal, isSeedLockable,
  isModified, isDrifted, isMissingFromLibrary, isTypeConflict,
  ...conflictRowCtx,
  modifiedTooltip,
  summaryFor: (m: ModuleEntry) => summaryFor(value.value.modules, m),
  summaryTokens: (m: ModuleEntry) => summaryTokens(value.value.modules, m),
  siblingInfo: (m: ModuleEntry) => siblingInfo(value.value.modules, m),
  ...dragRowCtx,
  ...opsRowCtx,
  openContextMenu,
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
  bundleChildDriftCount: (b: BundleInstance) => bundleChildDriftCount(b, value.value.modules),
  isBundleLibraryDrifted,
  isBundleMissingFromLibrary,
  ...masterToggles,
  // Suppressed for an unlinked bundle — there is no insert for its children to
  // have diverged from, so MOD would be diffing against a ghost.
  isBundleSnapshotModified: (b: BundleInstance) =>
    !isBundleUnlinked(b) && bundleSnapshotModified(b, value.value.modules),
  ...bundleOpsFrameCtx,
  openBundleContextMenu,
  ...dragFrameCtx,
};
provide(BundleFrameCtxKey, bundleFrameCtx);
</script>

<template>
  <div
    class="wp-context"
    :class="{ 'wp-context--muted': isMuted }"
    :data-mode-label="isMuted ? muteLabel : undefined"
    @dragleave="onContainerLeave($event)"
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

    <!-- Corrupt-workflow recovery panel (5.6). -->
    <ContextRecoveryPanel
      v-if="parseError"
      :show-raw="showRaw"
      :error="parseError"
      :raw="parseRaw"
      @reset="resetCorruptValue"
      @toggle-raw="showRaw = !showRaw"
    />

    <!-- Page swap: populated layout vs empty hero. mode="out-in" sequences
         them — the populated block fully fades out before the empty hero
         fades in, so the leaving card and the appearing hero never visually
         stack. Recovery panel + drop-zone live outside the swap. -->
    <Transition name="wp-page" mode="out-in">
      <div
        v-if="!isEmpty"
        key="populated"
        class="wp-page"
        @dragover="onListDragOver($event)"
        @drop="(ev) => onDrop(ev, null)"
      >
        <!-- Toolbar: module count + bulk-drift refresh + collapse/expand/toggle-all. -->
        <ContextToolbar
          :enabled-count="enabledCount"
          :total-count="totalCount"
          :drifted-count="driftedCount"
          @refresh="refreshAllDrifted()"
          @collapse="collapseAll()"
          @expand="expandAll()"
          @toggle-all="toggleAllEnabled()"
        />

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
        <ContextAddActions class="wp-w-footer" @module="openPicker" @bundle="openBundlePicker" />
      </div>

      <!-- Empty-state hero — shown when modules is empty and there's no
           recovery panel up. Brand glyph + dual CTA (add + SPA link). -->
      <div
        v-else-if="!parseError"
        key="empty"
        class="wp-empty-hero"
        :class="{ 'wp-empty-hero--drop-target': isDropEndZone }"
        data-test="context-empty"
        @dragover="onEmptyHeroDragOver($event)"
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
        <ContextAddActions class="wp-empty-hero-actions" @module="openPicker" @bundle="openBundlePicker" />
      </div>
    </Transition>

    <div
      class="wp-drop-end"
      :class="{ 'wp-drop-end--active': isDropEndZone, 'wp-drop-end--show': dragState !== null }"
      @dragover="onEndDragOver($event)"
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
