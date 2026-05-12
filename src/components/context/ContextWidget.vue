<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, provide } from "vue";
import {
  parseWidgetJsonWithRecovery, serializeWidgetJson,
  emptyContextValue, newModuleId, newRowUid,
  type ContextWidgetValue, type ModuleEntry,
} from "../../widgets/_shared";
import { scanConflicts, labelFor as conflictLabelFor, type Conflict } from "../../extension/conflicts";
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
import BundleHeader from "./bundles/BundleHeader.vue";
import ModuleRow from "./ModuleRow.vue";
import { ModuleRowCtxKey, type ModuleRowCtx } from "./module-row-ctx";
import { buildBundleInsertion, type BundleLibraryEntry } from "./bundles/insert";
import { reconcileBundleRanges, type DropZone } from "./bundles/drag";
import { api } from "../../manager/api/client";
import { emptyBundleInstance, type BundleInstance } from "../../widgets/_shared";
import ModuleEditModal from "./ModuleEditModal.vue";
import ContextMenu, {
  type ContextMenuEntry,
  type ContextMenuHeader,
  type ContextMenuItem,
} from "../shared/ContextMenu.vue";
import { dragState } from "./drag-store";
import { nextBindingSuffix } from "./duplicates/binding-suffix";
import { pushToast } from "../shared/toast-store";
import { kindIcon } from "../shared/kind-icons";
import { KIND_TITLE } from "./editors/_shell";
import { varColorClass } from "../shared/var-color";
import wpLogoSvg from "../shared/wp-logo.svg?raw";
import {
  forceRefresh as forceRefreshHashes,
  hashes as libraryHashes,
  refreshMany,
  refreshModule,
  subscribe as subscribeDrift,
  unsubscribe as unsubscribeDrift,
} from "./drift-store";

const props = withDefaults(defineProps<{
  nodeId: number;
  initialJson: string;
  upstreamVars: string[];
  /** Resolved upstream-var snapshot — `$name → resolved string` map.
   *  Drives the combine modal's live-preview pane so users see the
   *  template with vars substituted (e.g. `red portrait` instead of
   *  `$style portrait`) at edit time. Optional for headless mounts. */
  upstreamResolved?: Record<string, string>;
  /** Per-module resolved reader — given a moduleId, returns the map of
   *  vars visible from that module's perspective (upstream chain +
   *  earlier siblings, excluding the module itself). Modal uses this
   *  for the combine live preview because static `upstreamResolved`
   *  alone misses sibling bindings produced in the same node. */
  localResolvedReader?: (moduleId?: string) => Record<string, string>;
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
  /** Litegraph node mode: 0 ALWAYS, 2 NEVER (mute), 4 BYPASS.
   *  Used to dim the body when the host node is muted/bypassed so
   *  the runtime-skipped state is visually obvious. Other modes are
   *  unused for WP_Context but accepted as default-active (run). */
  nodeMode?: number;
  /** Last-run seed reader keyed by module id. Null = user hasn't queued. */
  lastUsedSeedReader?: (moduleId?: string) => number | null;
  onChange: (json: string) => void;
}>(), {
  nodeMode: 0,
  upstreamWildcardUuids: () => [],
  downstreamWildcardUuids: () => [],
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
const recentDropUid = ref<string | null>(null);
let dropPulseTimer: number | null = null;

// Disables `.wp-list-move` + `.wp-list-leave-active` transitions while
// active so children + overlay vanish on the same tick as the frame
// (and rows below snap up instead of sliding for 250ms FLIP).
const suppressMove = ref(false);
let suppressMoveTimer: number | null = null;

// Gap-metaphor indicator: rows that own a "before"/"after" slot get a
// margin so the gap opens; the bar element paints inside that gap.
// Bundle "before"/"after" zones DO NOT project onto bundle-member rows
// — the .wp-bundle div itself handles its outer margin via
// bundleHeaderGap(), so projecting onto the first child would open a
// second gap INSIDE the bundle while the bar paints OUTSIDE.
function rowGap(idx: number): "before" | "after" | null {
  const z = dragOver.value;
  if (!z) return null;
  if (z.kind === "row") return z.idx === idx ? z.pos : null;
  if (z.kind === "bundle-slot" && z.targetIdx === idx) return z.before ? "before" : "after";
  return null;
}

// True when the drag is targeting this bundle's frame — header bottom
// half from outside, or any bundle-slot with crossing=true. Drives the
// `.wp-bundle-overlay--drop-inside` highlight.
function isBundleInsideTarget(uid: string): boolean {
  const z = dragOver.value;
  if (!z) return false;
  if (z.kind === "bundle" && z.uid === uid && z.zone === "inside") return true;
  if (z.kind === "bundle-slot" && z.uid === uid && z.crossing) return true;
  return false;
}

// Bundle header gets `wp-gap-before` when the bundle "before" zone is
// active — opens a gap above the header so the bar paints in it.
function bundleHeaderGap(uid: string): "before" | null {
  const z = dragOver.value;
  return z?.kind === "bundle" && z.uid === uid && z.zone === "before" ? "before" : null;
}

// Computed gap-bar position relative to the modules container. Null when
// no zone needs a bar (inside-bundle / end / null). Uses offsetTop/Left
// walkers so the values reflect post-margin layout (not the mid-flight
// rect from getBoundingClientRect).
const gapBarStyle = computed<Record<string, string> | null>(() => {
  const z = dragOver.value;
  const container = modulesContainer.value;
  if (!z || !container) return null;

  let anchor: HTMLElement | null = null;
  let beforeSide = true;
  if (z.kind === "row") {
    anchor = container.querySelector<HTMLElement>(`.wp-module[data-module-idx="${z.idx}"]`);
    beforeSide = z.pos === "before";
  } else if (z.kind === "bundle-slot") {
    anchor = container.querySelector<HTMLElement>(`.wp-module[data-module-idx="${z.targetIdx}"]`);
    beforeSide = z.before;
  } else if (z.kind === "bundle" && z.zone === "before") {
    anchor = container.querySelector<HTMLElement>(`[data-bundle-uid="${z.uid}"][data-bundle-header]`);
    beforeSide = true;
  } else if (z.kind === "bundle" && z.zone === "after") {
    const b = (value.value.bundles ?? []).find((bb) => bb._uid === z.uid);
    if (b) anchor = container.querySelector<HTMLElement>(`.wp-module[data-module-idx="${b.end_idx}"]`);
    beforeSide = false;
  } else if (z.kind === "end") {
    const n = value.value.modules.length;
    if (n === 0) return null;
    const lastIdx = n - 1;
    // If the last module lives inside a bundle, anchor on the bundle
    // DIV itself so the bar lands below the bundle's frame border
    // (anchoring on the last child puts the bar inside the bundle's
    // padding-bottom area).
    const lastBundle = (value.value.bundles ?? []).find((b) => b.end_idx === lastIdx);
    if (lastBundle) {
      anchor = container.querySelector<HTMLElement>(`.wp-bundle[data-bundle-uid="${lastBundle._uid}"]`);
    } else {
      anchor = container.querySelector<HTMLElement>(`.wp-module[data-module-idx="${lastIdx}"]`);
    }
    beforeSide = false;
  } else {
    return null;
  }
  if (!anchor) return null;

  // Walk offsetTop/Left from anchor up to the modules container so the
  // values reflect the post-margin layout immediately.
  let oTop = 0;
  let oLeft = 0;
  for (let cur: HTMLElement | null = anchor; cur && cur !== container; cur = cur.offsetParent as HTMLElement | null) {
    oTop += cur.offsetTop;
    oLeft += cur.offsetLeft;
  }
  const h = anchor.offsetHeight;
  const w = anchor.offsetWidth;
  const y = beforeSide ? oTop - 7 : oTop + h + 7;
  return { top: `${y}px`, left: `${oLeft}px`, width: `${w}px` };
});

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
const editingModule = computed<ModuleEntry | null>(() =>
  editingIdx.value != null ? (value.value.modules[editingIdx.value] ?? null) : null,
);

/** Live-preview source of truth for the modal: combines upstream-chain
 *  bindings + sibling bindings produced in this same node (minus the
 *  module being edited). Falls back to the static `upstreamResolved`
 *  prop when the per-module reader isn't wired (legacy mounts /
 *  headless tests). Recomputed on every editingIdx change so the
 *  preview pane reflects the right perspective. */
const resolvedForEditing = computed<Record<string, string>>(() => {
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
  for (let mi = 0; mi < value.value.modules.length; mi++) {
    const m = value.value.modules[mi];
    if (mi === editingIdx.value) continue;
    if (!m.enabled) continue;
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

// Initial parse runs through the recovery path so we can flag bad workflow
// JSON instead of silently swallowing it. parseWidgetJson stays exported for
// the debug/assembler widgets which don't need recovery semantics.
const initialParse = parseWidgetJsonWithRecovery(props.initialJson, emptyContextValue());
ensureRowUids(initialParse.value.modules);
const value = ref<ContextWidgetValue>(initialParse.value);

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
    const { modulesToSplice, bundleInstance } = buildBundleInsertion(libEntry, insertIdx);
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
    value.value = {
      ...value.value,
      modules: [...value.value.modules, ...splice],
      bundles: [...(value.value.bundles ?? []), bundleInstance],
    };
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
  // Cascade enabled flag to every child module in the bundle range.
  // Engine's pipeline reads `module.enabled` per-row, so this is all
  // we need — no engine changes required for bundle-level disable.
  const nextModules = value.value.modules.map((m, mIdx) => {
    if (mIdx >= updated.start_idx && mIdx <= updated.end_idx) {
      return { ...m, enabled };
    }
    return m;
  });
  value.value = {
    ...value.value,
    modules: nextModules,
    bundles: nextBundles,
  };
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

function removeBundle(uid: string): void {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  // Drop all child modules in [start_idx..end_idx] from the flat
  // modules array AND drop the BundleInstance itself.
  const before = value.value.modules.slice(0, target.start_idx);
  const after = value.value.modules.slice(target.end_idx + 1);
  const removedCount = target.end_idx - target.start_idx + 1;
  // Adjust any sibling bundle indices that sit after the removed range.
  const remainingBundles = bundles
    .filter((b) => b._uid !== uid)
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
  // Suppress FLIP-move + leave-active for the transition window so the
  // overlay, children, and follow-up rows all snap on the same frame.
  holdSuppressMove();
  value.value = {
    ...value.value,
    modules: [...before, ...after],
    bundles: remainingBundles,
  };
}

/** Detach bundle frame — keep children as standalone modules but
 *  drop the bundle instance + clear `bundle_origin` on each child.
 *  Useful when user wants to keep what's inside but no longer wants
 *  the group wrapping. */
function detachBundle(uid: string): void {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  const nextModules = value.value.modules.map((m, idx) => {
    if (idx < target.start_idx || idx > target.end_idx) return m;
    // Strip bundle_origin from this child; spread so other fields
    // survive untouched.
    const next = { ...m } as ModuleEntry & { bundle_origin?: string };
    delete next.bundle_origin;
    return next;
  });
  const remainingBundles = bundles.filter((b) => b._uid !== uid);
  value.value = {
    ...value.value,
    modules: nextModules,
    bundles: remainingBundles,
  };
}

/** Duplicate bundle — re-fetch the library entry + run insert
 *  again at the position right after the current bundle. Children
 *  share library ids with the existing instance (sibling pattern). */
async function duplicateBundle(uid: string): Promise<void> {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  await onPickBundle(target.library_id);
}

/** Reset bundle to library snapshot — re-fetch the library entry
 *  + replace current children with the frozen blob. Drops any user
 *  edits made to bundle children since insert. Confirms first since
 *  it's destructive. */
async function resetBundleToLibrary(uid: string): Promise<void> {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  // No `window.confirm` — ComfyUI's host suppresses native modal APIs
  // in some runtimes (returns false silently → silent no-op). Same
  // failure mode as wrap's prompt. The op is recoverable: users can
  // resave via "Save changes to library" if they regret it.
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
    const newChildren = replacementInsertion.modulesToSplice.map((c) => {
      const rec = c as Record<string, unknown>;
      const meta = (rec.meta as ModuleEntry["meta"] | undefined) ?? { name: "" };
      const entries = (rec.entries as ModuleEntry["entries"] | undefined) ?? [];
      return {
        id: c.id,
        _uid: c._uid,
        type: c.type as ModuleEntry["type"],
        enabled: (rec.enabled as boolean | undefined) ?? true,
        collapsed: (rec.collapsed as boolean | undefined) ?? false,
        meta,
        entries,
        payload: c.payload,
        instance: c.instance,
        payload_hash: c.payload_hash,
        // Stamp bundle_origin to the EXISTING bundle's _uid so the
        // frame stays attached to the same BundleInstance.
        bundle_origin: target._uid,
      } as ModuleEntry;
    });
    const before = value.value.modules.slice(0, startIdx);
    const after = value.value.modules.slice(target.end_idx + 1);
    const sizeDelta = newChildren.length - (target.end_idx - target.start_idx + 1);
    // Update bundle range to match new children length + shift
    // later bundles by the delta.
    const nextBundles = bundles.map((b) => {
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
    value.value = {
      ...value.value,
      modules: [...before, ...newChildren, ...after],
      bundles: nextBundles,
    };
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
    value.value = { ...value.value, modules: nextModules };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushToast(`Reset failed: ${msg}`, { severity: "error" });
  }
}

/** Canonical ChildSnapshot dict — strips per-instance fields
 *  (`_uid`, `bundle_origin`). Shared by saveBundleToLibrary +
 *  wrapIntoNewBundle so the library shape stays consistent. */
function toChildSnapshot(m: ModuleEntry): Record<string, unknown> {
  return {
    id: m.id, type: m.type, enabled: m.enabled, collapsed: m.collapsed,
    meta: m.meta, entries: m.entries, payload: m.payload,
    instance: m.instance, payload_hash: m.payload_hash,
  };
}

/** Push current bundle children back to library — mirrors
 *  resetBundleToLibrary in the opposite direction. */
async function saveBundleToLibrary(uid: string): Promise<void> {
  const bundles = value.value.bundles ?? [];
  const target = bundles.find((b) => b._uid === uid);
  if (!target) return;
  // No `window.confirm` — ComfyUI host suppresses it in some runtimes.
  // Op is library-side; users can revert by re-saving an older instance
  // or editing in the SPA library editor.
  const childrenOut = value.value.modules
    .slice(target.start_idx, target.end_idx + 1)
    .map(toChildSnapshot);
  try {
    const updated = await api.bundles.update(target.library_id, {
      children: childrenOut,
    });
    // Refresh the BundleInstance's `inserted_at_hash` so a future
    // resetBundleToLibrary call would compare against the newly
    // written hash (i.e. "no drift").
    const nextBundles = bundles.map((b) =>
      b._uid === uid ? { ...b, inserted_at_hash: updated.payload_hash } : b,
    );
    value.value = { ...value.value, bundles: nextBundles };
    pushToast(`Saved "${updated.name}" to library`, { severity: "success" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushToast(`Save failed: ${msg}`, { severity: "error" });
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
    value.value = {
      ...value.value, modules: nextModules,
      bundles: [...(value.value.bundles ?? []), bundleInstance],
    };
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
    {
      label: "Save changes to library",
      icon: "pi-cloud-upload",
      subtitle: "Overwrite library with current children",
      onSelect: () => { void saveBundleToLibrary(uid); },
      divider: true,
    },
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
  // Disabled modules don't ship to runtime; skip them in the scan so they
  // don't generate phantom shadows_upstream / duplicate_variable warnings.
  const enabledOnly: ContextWidgetValue = {
    ...value.value,
    modules: value.value.modules.filter((m) => m.enabled),
  };
  const all = scanConflicts(
    enabledOnly,
    props.upstreamVars,
    props.upstreamWildcardUuids,
    props.downstreamWildcardUuids,
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
  // so the badge wording stays stable across renders.
  const order = { error: 0, warning: 1, info: 2 } as const;
  const top = [...list].sort(
    (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9),
  )[0];
  switch (top.type) {
    case "shadows_upstream":           return "override";
    case "duplicate_variable":         return "duplicate";
    case "missing_template_variable":  return "missing var";
    case "constraint_source_after_self":     return "src after";
    case "constraint_source_missing":        return "src missing";
    case "constraint_target_before_self":    return "tgt before";
    case "constraint_target_in_upstream":    return "tgt upstream";
    case "constraint_target_missing":        return "tgt missing";
    case "constraint_source_in_downstream":  return "src downstream";
    default:                                  return "conflict";
  }
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
function isMissingFromLibrary(m: ModuleEntry): boolean {
  if (!m.payload_hash) return false;
  if (libraryHashes.value === null) return false;
  return !(m.id in libraryHashes.value);
}

/**
 * Drift = library still has this uuid, but the live `payload_hash`
 * differs from what was embedded into the workflow at pick time.
 * Independent of `isModified` (user overrides) and `isMissingFromLibrary`
 * (uuid gone). Reads `false` until the store's first fetch lands so we
 * don't flash drift before we know the truth.
 */
function isDrifted(m: ModuleEntry): boolean {
  if (!m.payload_hash) return false;
  if (libraryHashes.value === null) return false;
  const live = libraryHashes.value[m.id];
  if (live === undefined) return false;       // covered by isMissingFromLibrary
  return live !== m.payload_hash;
}

/**
 * Save a workflow-resident module snapshot back into the live
 * library at the SAME uuid so the next workflow load won't flag it
 * missing. POSTs to a small new endpoint that bypasses the regular
 * uuid-generator and inserts at the supplied id. On success, refresh
 * the library set so the indicator dot disappears immediately
 * instead of waiting for the next poll.
 */
async function saveToLibrary(m: ModuleEntry) {
  if (!m.payload) {
    pushToast("This module has no payload to save.", { severity: "warning" });
    return;
  }
  try {
    const res = await fetch("/wp/api/modules/import-from-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: m.id,
        type: m.type,
        name: m.meta.name || `(unnamed ${m.type})`,
        description: m.meta.description ?? "",
        tags: m.meta.tags ?? [],
        payload: m.payload,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body as { error?: string }).error ?? `${res.status}`;
      pushToast(`Save failed: ${detail}`, { severity: "error" });
      return;
    }
    pushToast(`Saved "${m.meta.name || m.type}" to library.`, {
      severity: "success",
    });
    await forceRefreshHashes();
  } catch (err) {
    pushToast(`Save failed: ${(err as Error).message}`, { severity: "error" });
  }
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
  try {
    const merged = await refreshModule(m);
    if (value.value.modules[idx] !== m) return;  // row shifted while loading
    const next = [...value.value.modules];
    next[idx] = merged;
    value.value.modules = next;
    pushToast(`Refreshed "${merged.meta.name || merged.type}".`, { severity: "success" });
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
  const result = await refreshMany(driftedRows);

  if (result.refreshed.length > 0) {
    const queueByUuid = new Map<string, ModuleEntry[]>();
    for (const r of result.refreshed) {
      const q = queueByUuid.get(r.id) ?? [];
      q.push(r);
      queueByUuid.set(r.id, q);
    }
    const next = [...value.value.modules];
    for (const i of driftedIdx) {
      const m = next[i];
      const merged = queueByUuid.get(m.id)?.shift();
      if (merged) next[i] = merged;
    }
    value.value.modules = next;
    await forceRefreshHashes();
  }

  if (result.failed.length === 0) {
    pushToast(`Refreshed all ${result.refreshed.length}.`, { severity: "success" });
  } else {
    pushToast(
      `Refreshed ${result.refreshed.length} of ${driftedRows.length}; ${result.failed.length} stayed drifted.`,
      { severity: "warning" },
    );
  }
}

/** Surfaced as a computed for the bulk-button visibility + label. */
const driftedCount = computed(() => value.value.modules.filter(isDrifted).length);

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
      // Template override + variable_binding override (binding lives on
      // identity but is per-instance so counts as a diff vs library).
      if (typeof inst.template_override === "string" && inst.template_override.length > 0) return true;
      if (typeof inst.variable_binding === "string" && inst.variable_binding.length > 0) return true;
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
 *  (constraint, pipeline) ignore the field — engine doesn't read it.
 *  Inline lock action gates on this set so the icon only appears
 *  where it actually does something. */
const SEED_LOCKABLE_KINDS: ReadonlySet<string> = new Set([
  "wildcard", "combine", "fixed_values", "derivation",
]);
function isSeedLockable(m: ModuleEntry): boolean {
  return SEED_LOCKABLE_KINDS.has(m.type);
}

function isLocked(m: ModuleEntry): boolean {
  return typeof m.instance?.locked_seed === "number";
}
function isInternal(m: ModuleEntry): boolean {
  return !!m.instance?.internal;
}

/** In-card lock toggle. Off → null `locked_seed` but keep
 *  `_ui.last_locked_seed` so the next toggle-on has a fallback.
 *  On → fallback chain (per-module priority so re-locking captures
 *  what THIS specific wildcard actually rolled with):
 *    1. lastUsedSeedReader(m.id) — seed THIS wildcard used last
 *       run (locked_seed if it was locked, else chain seed).
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
    nextInst = { ...inst, locked_seed: null };
  } else {
    let fallback: number;
    const lastUsed = props.lastUsedSeedReader?.(m.id);
    if (typeof lastUsed === "number") {
      fallback = lastUsed;
    } else if (typeof inst._ui?.last_locked_seed === "number") {
      fallback = inst._ui.last_locked_seed;
    } else {
      fallback = 0;
    }
    nextInst = { ...inst, locked_seed: fallback, _ui: { ...inst._ui, last_locked_seed: fallback } };
  }
  // Phase B: index-based mutation — sibling rows share `m.id`, so a
  // map-by-id pass would toggle every sibling at once. Indexing into
  // the array hits the specific instance the user clicked.
  const list = [...value.value.modules];
  list[idx] = { ...m, instance: nextInst };
  value.value = { ...value.value, modules: list };
}

/** In-card internal toggle. Drops the field on toggle-off so the
 *  persisted JSON stays minimal (matches the modal). */
function toggleInternalOnCard(idx: number) {
  const m = value.value.modules[idx];
  if (!m) return;
  const inst = m.instance ?? {};
  let nextInst: NonNullable<ModuleEntry["instance"]>;
  if (inst.internal) {
    const { internal: _drop, ...rest } = inst;
    void _drop;
    nextInst = rest;
  } else {
    nextInst = { ...inst, internal: true };
  }
  const list = [...value.value.modules];
  list[idx] = { ...m, instance: nextInst };
  value.value = { ...value.value, modules: list };
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
      if (nonEmptyArr(inst.category_filter)) {
        bits.push(`cats: ${(inst.category_filter as string[]).join(", ")}`);
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
    const named = m.entries.filter((e) => e.variable_name.trim() !== "");
    if (named.length === 0) return [lit("(empty)")];
    const heads = named.slice(0, 2);
    const more = named.length - heads.length;
    const out: SummaryToken[] = [];
    heads.forEach((e, i) => {
      if (i > 0) out.push(lit(", "));
      out.push(v(e.variable_name));
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
    case "pipeline":     return [lit(`${Array.isArray(p.steps) ? p.steps.length : 0} steps`)];
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

    value.value = {
      ...value.value,
      modules: [...value.value.modules, ...newEntries],
    };

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

function removeModule(idx: number) {
  // Soft-delete: capture position + module, drop a toast with Undo. Undo
  // splices it back at its original index. Phase B: removes by index so
  // sibling rows (same uuid, multiple instances) only delete the
  // specific row the user clicked. Pre-Phase-B `filter(m => m.id !== id)`
  // would have removed every sibling at once.
  if (idx < 0 || idx >= value.value.modules.length) return;
  const removed = value.value.modules[idx];
  const moduleLabel = removed.meta.name?.trim() || "module";
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

  value.value = { ...value.value, modules: next, bundles: nextBundles };
  pushToast(`Removed “${moduleLabel}”`, {
    severity: "info",
    action: {
      label: "Undo",
      onSelect: () => {
        const list = [...value.value.modules];
        list.splice(Math.min(idx, list.length), 0, removed);
        value.value = { ...value.value, modules: list };
      },
    },
  });
}

function duplicateModule(idx: number) {
  if (idx < 0 || idx >= value.value.modules.length) return;
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
  value.value = { ...value.value, modules: list };
  pushToast(`Duplicated "${list[i].meta.name?.trim() || "module"}" as sibling`, {
    severity: "success",
    lifeMs: 3000,
    action: {
      label: "Undo",
      onSelect: () => {
        // Splice the most recently added sibling at position i+1 — can't
        // filter by id since the original shares it.
        const cur = [...value.value.modules];
        cur.splice(i + 1, 1);
        value.value = { ...value.value, modules: cur };
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
  value.value = { ...value.value, modules: list };
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
  value.value = { ...value.value, modules: list };
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
  value.value = { ...value.value, modules: list };
}

/** Bulk collapse/expand. Used by the section-header chevron — one
 *  click flips every card to the same state. Idempotent if all
 *  cards already match the target state (the deep watcher will
 *  diff-eq and skip the onChange emit). */
function setAllCollapsed(collapsed: boolean) {
  value.value = {
    ...value.value,
    modules: value.value.modules.map((m) => ({ ...m, collapsed })),
  };
}

/** Toolbar counts — total modules + how many are enabled. */
const totalCount = computed(() => value.value.modules.length);
const enabledCount = computed(() => value.value.modules.filter((m) => m.enabled).length);

/** Toolbar bulk actions — wrappers so the toolbar template stays compact. */
function collapseAll(): void { setAllCollapsed(true); }
function expandAll(): void { setAllCollapsed(false); }
function toggleAllEnabled(): void {
  const anyEnabled = value.value.modules.some((m) => m.enabled);
  // If any are enabled, disable all; otherwise enable all.
  value.value = {
    ...value.value,
    modules: value.value.modules.map((m) => ({ ...m, enabled: !anyEnabled })),
  };
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
  value.value = { ...value.value, modules: list };
  if (updated._originalId && updated._originalId !== updated.id) {
    nextTick(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-module-idx="${targetIdx}"]`,
      );
      if (el) {
        el.classList.add("wp-module--flash");
        setTimeout(() => el.classList.remove("wp-module--flash"), 1500);
      }
    });
  }
  editingIdx.value = null;
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
  value.value = { ...value.value, modules: list };
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
  if (isMissingFromLibrary(m) && !!m.payload) {
    items.push({
      label: "Save to library",
      icon: "pi-cloud-upload",
      onSelect: () => saveToLibrary(m),
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
    header: undefined,  // Module ctxmenu has no scope header; clear bundle header leak
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

// Pulses the just-dropped module so the user sees where it landed.
function pulseDrop(uid: string | undefined | null): void {
  if (!uid) return;
  if (dropPulseTimer != null) window.clearTimeout(dropPulseTimer);
  recentDropUid.value = uid;
  dropPulseTimer = window.setTimeout(() => {
    recentDropUid.value = null;
    dropPulseTimer = null;
  }, 460);
}

// Bundle-as-unit drag — header drag handle initiates a "bundle" payload
// carrying the bundle's uid + pre-drag range. Receiver re-slices the
// range out and re-inserts at the resolved zone.
function onBundleDragStart(ev: DragEvent, uid: string) {
  const b = (value.value.bundles ?? []).find((bb) => bb._uid === uid);
  if (!b) return;
  dragState.value = {
    kind: "bundle",
    sourceNodeId: props.nodeId,
    bundleUid: uid,
    sourceStartIdx: b.start_idx,
    sourceEndIdx: b.end_idx,
  };
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", `bundle:${uid}`);
  }
}

function onDragEnd() {
  const ds = dragState.value;
  if (ds && ds.kind === "module" && ds.sourceNodeId === props.nodeId && !sameNodeDropHandled) {
    if (ds.consumedBy != null && ds.consumedBy !== props.nodeId) {
      // Cross-node consumption — remove source by recorded sourceIdx.
      const srcIdx = ds.sourceIdx;
      if (srcIdx >= 0 && srcIdx < value.value.modules.length) {
        const list = [...value.value.modules];
        list.splice(srcIdx, 1);
        value.value = { ...value.value, modules: list };
      } else {
        value.value = { ...value.value, modules: value.value.modules.filter((m) => m.id !== ds.module.id) };
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
// bundle frames) once per pointer event. The flat DOM (rows are siblings
// of bundle headers, bundles render via overlay) means per-row dragover
// handlers miss the 14px margin gap that opens during drag, so we
// resolve from the pointer Y against ALL items in one pass.
//
// Slots fall into the following categories:
//   - row "before"/"after" — between top-level standalone rows.
//   - bundle "before" — above a bundle frame.
//   - bundle "inside" — drop INTO a bundle as new child at end (crossing).
//   - bundle-slot before/after — between two specific bundle children
//     (or AFTER the last child while still inside the bundle, extending
//     its range).
//   - end — below all items.
function onListDragOver(ev: DragEvent) {
  const ds = dragState.value;
  if (!ds) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  const container = modulesContainer.value;
  if (!container) return;
  const cy = ev.clientY;
  const modules = value.value.modules;
  const bundles = value.value.bundles ?? [];

  // Build top-level item list in render order. Each item carries the
  // DOM rect we need to test pointer Y against.
  interface TopItem {
    type: "row" | "bundle";
    moduleIdx: number;
    uid?: string;
    bundleStartIdx?: number;
    bundleEndIdx?: number;
    top: number;
    bottom: number;
  }
  const items: TopItem[] = [];
  let i = 0;
  while (i < modules.length) {
    const b = bundles.find((bb) => bb.start_idx === i);
    if (b) {
      const hEl = container.querySelector<HTMLElement>(`[data-bundle-uid="${b._uid}"][data-bundle-header]`);
      // Collapsed bundle hides its children via v-show; their
      // getBoundingClientRect collapses to zero. Use the header rect
      // as both top and bottom in that case.
      const lastEl = b.collapsed
        ? hEl
        : container.querySelector<HTMLElement>(`.wp-module[data-module-idx="${b.end_idx}"]`);
      if (hEl && lastEl) {
        const hr = hEl.getBoundingClientRect();
        const lr = lastEl.getBoundingClientRect();
        items.push({
          type: "bundle", moduleIdx: i, uid: b._uid,
          bundleStartIdx: b.start_idx, bundleEndIdx: b.end_idx,
          top: hr.top, bottom: lr.bottom,
        });
      }
      i = b.end_idx + 1;
    } else {
      const el = container.querySelector<HTMLElement>(`.wp-module[data-module-idx="${i}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        items.push({ type: "row", moduleIdx: i, top: r.top, bottom: r.bottom });
      }
      i++;
    }
  }
  if (items.length === 0) { dragOver.value = { kind: "end" }; return; }

  // Walk items: cy in a gap before an item → slot before that item. cy
  // inside an item → handle row or bundle internals.
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (cy < it.top) {
      if (it.type === "bundle") dragOver.value = { kind: "bundle", uid: it.uid!, zone: "before" };
      else dragOver.value = { kind: "row", idx: it.moduleIdx, pos: "before" };
      return;
    }
    if (cy > it.bottom) continue;

    if (it.type === "row") {
      const mid = it.top + (it.bottom - it.top) / 2;
      if (cy < mid) {
        dragOver.value = { kind: "row", idx: it.moduleIdx, pos: "before" };
      } else {
        // Bottom half — canonicalise to "before next top-level item" so
        // bottom-of-N and top-of-N+1 resolve to one slot + one bar.
        const next = items[k + 1];
        if (!next) dragOver.value = { kind: "end" };
        else if (next.type === "bundle") dragOver.value = { kind: "bundle", uid: next.uid!, zone: "before" };
        else dragOver.value = { kind: "row", idx: next.moduleIdx, pos: "before" };
      }
      return;
    }

    // Inside a bundle's rect.
    const hEl = container.querySelector<HTMLElement>(`[data-bundle-uid="${it.uid}"][data-bundle-header]`);
    if (!hEl) { dragOver.value = { kind: "bundle", uid: it.uid!, zone: "inside" }; return; }
    const hr = hEl.getBoundingClientRect();
    const crossing = !(ds.kind === "module" && ds.sourceBundleUid === it.uid);

    // Bundle-as-unit drag never nests — treat the bundle as a single
    // top-level item: top half = before, bottom half = before next (or end).
    if (ds.kind === "bundle") {
      const mid = it.top + (it.bottom - it.top) / 2;
      if (cy < mid) {
        dragOver.value = { kind: "bundle", uid: it.uid!, zone: "before" };
      } else {
        const next = items[k + 1];
        if (!next) dragOver.value = { kind: "end" };
        else if (next.type === "bundle") dragOver.value = { kind: "bundle", uid: next.uid!, zone: "before" };
        else dragOver.value = { kind: "row", idx: next.moduleIdx, pos: "before" };
      }
      return;
    }

    if (cy <= hr.bottom) {
      // Pointer is on the bundle header itself.
      if (cy < hr.top + hr.height / 2) {
        dragOver.value = { kind: "bundle", uid: it.uid!, zone: "before" };
      } else if (crossing || it.bundleEndIdx! < it.bundleStartIdx!) {
        dragOver.value = { kind: "bundle", uid: it.uid!, zone: "inside" };
      } else {
        dragOver.value = { kind: "bundle-slot", uid: it.uid!, targetIdx: it.bundleStartIdx!, before: true, crossing: false };
      }
      return;
    }

    // Pointer is in the bundle children area. Find the closest gap.
    for (let m = it.bundleStartIdx!; m <= it.bundleEndIdx!; m++) {
      const cEl = container.querySelector<HTMLElement>(`.wp-module[data-module-idx="${m}"]`);
      if (!cEl) continue;
      const cr = cEl.getBoundingClientRect();
      if (cy < cr.top + cr.height / 2) {
        dragOver.value = { kind: "bundle-slot", uid: it.uid!, targetIdx: m, before: true, crossing };
        return;
      }
    }
    dragOver.value = { kind: "bundle-slot", uid: it.uid!, targetIdx: it.bundleEndIdx!, before: false, crossing };
    return;
  }
  // Below all items.
  dragOver.value = { kind: "end" };
}

function onEndDragOver(ev: DragEvent) {
  if (!dragState.value) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  dragOver.value = { kind: "end" };
}

function onContainerLeave(ev: DragEvent) {
  const container = ev.currentTarget as HTMLElement;
  const next = ev.relatedTarget as Node | null;
  if (next && container.contains(next)) return;
  clearDragHover();
}

function onDrop(ev: DragEvent, targetIdx: number | null) {
  ev.preventDefault();
  ev.stopPropagation();
  const ds = dragState.value;
  if (!ds) return;
  // Snapshot zone before clearing hover state.
  const zone: DropZone = dragOver.value ?? (targetIdx === null ? { kind: "end" } : null);
  dragOver.value = null;

  // Same-node bundle move — slice the whole range out + re-insert at zone.
  if (ds.kind === "bundle" && ds.sourceNodeId === props.nodeId) {
    const list = [...value.value.modules];
    const bundles = value.value.bundles ?? [];
    const rangeSize = ds.sourceEndIdx - ds.sourceStartIdx + 1;
    const range = list.splice(ds.sourceStartIdx, rangeSize);
    const adj = (i: number) => (i > ds.sourceEndIdx ? i - rangeSize : i);
    let ii: number;
    if (!zone || zone.kind === "end") ii = list.length;
    else if (zone.kind === "row") {
      const a = adj(zone.idx);
      ii = zone.pos === "after" ? a + 1 : a;
    } else if (zone.uid === ds.bundleUid) {
      // Dropped onto self — no-op, restore.
      list.splice(ds.sourceStartIdx, 0, ...range);
      sameNodeDropHandled = true;
      return;
    } else if (zone.kind === "bundle-slot") {
      const t = adj(zone.targetIdx);
      ii = zone.before ? t : t + 1;
    } else {
      const ob = bundles.find((b) => b._uid === zone.uid);
      if (!ob) ii = list.length;
      else {
        const s = adj(ob.start_idx);
        const e = adj(ob.end_idx);
        // "inside" another bundle treated as "after" — no nesting v1.
        ii = zone.zone === "before" ? s : e + 1;
      }
    }
    list.splice(ii, 0, ...range);
    holdSuppressMove();
    value.value = { ...value.value, modules: list, bundles: reconcileBundleRanges(list, bundles) };
    // Pulse the first row of the moved bundle so the user sees where it
    // landed (the bundle frame itself doesn't host the pulse class).
    pulseDrop(range[0]?._uid);
    sameNodeDropHandled = true;
    return;
  }

  if (ds.kind === "module" && ds.sourceNodeId === props.nodeId) {
    const list = [...value.value.modules];
    const fromIdx = ds.sourceIdx >= 0 && ds.sourceIdx < list.length
      ? ds.sourceIdx
      : list.findIndex((m) => m.id === ds.module.id);
    if (fromIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    let ii: number;
    let stamp: string | undefined;
    if (!zone || zone.kind === "end") ii = list.length;
    else if (zone.kind === "row") {
      const a = zone.idx > fromIdx ? zone.idx - 1 : zone.idx;
      ii = zone.pos === "after" ? a + 1 : a;
    } else if (zone.kind === "bundle-slot") {
      const t = zone.targetIdx > fromIdx ? zone.targetIdx - 1 : zone.targetIdx;
      ii = zone.before ? t : t + 1;
      stamp = zone.uid;
    } else {
      const ob = (value.value.bundles ?? []).find((b) => b._uid === zone.uid);
      if (!ob) ii = list.length;
      else {
        const s = ob.start_idx - (fromIdx < ob.start_idx ? 1 : 0);
        const e = ob.end_idx - (fromIdx <= ob.end_idx ? 1 : 0);
        if (zone.zone === "before") ii = s;
        else { ii = e + 1; if (zone.zone === "inside") stamp = zone.uid; }
      }
    }
    const m = { ...moved } as ModuleEntry & { bundle_origin?: string };
    if (stamp) m.bundle_origin = stamp;
    else delete m.bundle_origin;
    list.splice(ii, 0, m);
    // Auto-expand the target bundle when a row drops INTO it — without
    // this the child lands invisibly under a collapsed frame.
    const preBundles = (value.value.bundles ?? []).map((b) =>
      stamp && b._uid === stamp && b.collapsed ? { ...b, collapsed: false } : b,
    );
    value.value = { ...value.value, modules: list, bundles: reconcileBundleRanges(list, preBundles) };
    pulseDrop(m._uid);
    sameNodeDropHandled = true;
    return;
  }

  // Cross-node bundle drag not supported v1 — surface a toast + bail.
  if (ds.kind === "bundle") {
    pushToast("Drag bundles within the same Context only.", { severity: "info" });
    sameNodeDropHandled = true;
    return;
  }

  // Cross-node drop. Keep the source module's id — for library-picked
  // entries that id IS the canonical 8-hex uuid the catalog keys by,
  // and re-id'ing it would silently break `@{uuid}` ref resolution
  // for nested wildcards. If the target widget already has that id
  // (same module embedded twice), dedupe by skipping; the picker
  // applies the same rule. Toast so the user gets feedback —
  // pre-fix the drop appeared to silently fail because the visual
  // reorder cue cleared but the module never appeared.
  if (value.value.modules.some((m) => m.id === ds.module.id)) {
    const dupName = ds.module.meta?.name?.trim() || ds.module.type;
    pushToast(
      `"${dupName}" is already in this node. Use right-click → Duplicate to add another instance.`,
      { severity: "error" },
    );
    // Phase B: 200ms shake on the existing row so the user sees what
    // was rejected. Pre-Phase-B the visual feedback was just the toast;
    // the row stayed silent, which felt like the drop disappeared.
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
  // Inline-created fixed_values modules don't carry a library uuid,
  // so a fresh random id keeps the value.modules invariant
  // (each entry's id unique within a widget) when copying them.
  const isLibraryBacked = ds.module.type !== "fixed_values"
    || (ds.module.payload !== undefined && Object.keys(ds.module.payload ?? {}).length > 0);
  const inserted: ModuleEntry = isLibraryBacked
    ? { ...ds.module, _uid: newRowUid() }
    : { ...ds.module, id: newModuleId(), _uid: newRowUid() };
  const list = [...value.value.modules];
  // Honor the resolved drop position — pre-Phase-3a this branch
  // always inserted at `targetIdx` so cross-node drops landed
  // BEFORE the target regardless of whether the visual indicator
  // showed "before" or "after". Mirror the same-node math: "after"
  // → targetIdx + 1, "before" (or unresolved) → targetIdx.
  let insertIdx: number;
  const dropPos: "before" | "after" | null =
    zone && zone.kind === "row" ? zone.pos : null;
  if (targetIdx === null) {
    insertIdx = list.length;
  } else if (targetIdx < 0 || targetIdx >= list.length) {
    insertIdx = list.length;
  } else {
    insertIdx = dropPos === "after" ? targetIdx + 1 : targetIdx;
  }
  list.splice(insertIdx, 0, inserted);
  value.value = { ...value.value, modules: list };
  dragState.value = { ...ds, consumedBy: props.nodeId };
}

// Top-level render list: standalone modules + bundle wrappers, in
// document order. Each bundle entry packs its child rows so the
// template can iterate once + nest children inside a real .wp-bundle
// div (no more absolute-positioned overlay).
interface TopLevelItem {
  kind: "mod" | "bundle";
  key: string;
  module?: ModuleEntry;
  idx?: number;
  bundle?: BundleInstance;
  children?: Array<{ module: ModuleEntry; idx: number }>;
}
const topLevelItems = computed<TopLevelItem[]>(() => {
  const modules = value.value.modules;
  const bundles = value.value.bundles ?? [];
  const out: TopLevelItem[] = [];
  let i = 0;
  while (i < modules.length) {
    const b = bundles.find((bb) => bb.start_idx === i);
    if (b && b.end_idx >= b.start_idx) {
      const kids: Array<{ module: ModuleEntry; idx: number }> = [];
      for (let j = b.start_idx; j <= b.end_idx; j++) {
        kids.push({ module: modules[j], idx: j });
      }
      out.push({ kind: "bundle", key: `b-${b._uid}`, bundle: b, children: kids });
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
  isModified, isDrifted, isMissingFromLibrary,
  severityFor, conflictTooltip, conflictBadgeText,
  modifiedTooltip, summaryFor, summaryTokens, siblingInfo,
  rowGap, draggingModuleUid, recentDropUid,
  toggleCollapsed, toggleEnabled, removeModule,
  toggleLockOnCard, toggleInternalOnCard,
  onDragStart, onDragEnd, openContextMenu, onCardKeydown,
};
provide(ModuleRowCtxKey, moduleRowCtx);
</script>

<template>
  <div
    class="wp-context"
    :class="{ 'wp-context--muted': isMuted }"
    :data-mode-label="isMuted ? muteLabel : undefined"
    @dragleave="onContainerLeave"
  >
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
            class="wp-btn wp-btn--icon"
            title="Collapse all"
            aria-label="Collapse all modules"
            @click="collapseAll"
          ><i class="pi pi-chevron-up" /></button>
          <button
            type="button"
            class="wp-btn wp-btn--icon"
            title="Expand all"
            aria-label="Expand all modules"
            @click="expandAll"
          ><i class="pi pi-chevron-down" /></button>
          <button
            type="button"
            class="wp-btn wp-btn--icon"
            title="Toggle all enabled"
            aria-label="Toggle all enabled"
            @click="toggleAllEnabled"
          ><i class="pi pi-eye" /></button>
        </div>

        <div
          class="wp-modules-frame"
          ref="modulesContainer"
        >
        <!-- Persistent drop-zone bar. Single element kept under the
             modules container; position computed from `dragOver`. -->
        <Transition name="wp-gap-bar">
          <div
            v-if="gapBarStyle"
            class="wp-gap-bar"
            :style="gapBarStyle"
            aria-hidden="true"
          />
        </Transition>
        <div
          class="wp-modules"
          :data-suppress-move="suppressMove ? 'true' : null"
        >
      <template v-for="item in topLevelItems" :key="item.key">
        <!-- Bundle wrapper: header + children container, real DOM
             nesting (no more absolute overlay). Border/bg painted by
             .wp-bundle directly. -->
        <div
          v-if="item.kind === 'bundle'"
          class="wp-bundle"
          :class="{
            'wp-bundle--collapsed': item.bundle!.collapsed,
            'wp-bundle--drop-inside': isBundleInsideTarget(item.bundle!._uid),
            'wp-gap-before': bundleHeaderGap(item.bundle!._uid) === 'before',
          }"
          :style="{ '--wp-bundle-color': item.bundle!.color ? item.bundle!.color : 'var(--wp-bundle-default)' }"
          :data-bundle-uid="item.bundle!._uid"
        >
          <BundleHeader
            :instance="item.bundle!"
            :name="item.bundle!.name ?? 'Bundle'"
            :color="item.bundle!.color"
            :child-count="item.children!.length"
            @toggle-collapse="toggleBundleCollapsed(item.bundle!._uid)"
            @toggle-enabled="(next) => toggleBundleEnabled(item.bundle!._uid, next)"
            @remove="removeBundle(item.bundle!._uid)"
            @contextmenu="(ev) => openBundleContextMenu(ev, item.bundle!._uid)"
            @dragstart="(ev) => onBundleDragStart(ev, item.bundle!._uid)"
            @dragend="onDragEnd"
          />
          <!-- Plain v-for, no inner TransitionGroup — nested
               TransitionGroups produced ghosting when a row crossed
               containers (outer leave + inner enter). Drop-target
               animations now ride on the outer TransitionGroup +
               CSS transitions on .wp-module's transform. -->
          <div
            v-show="!item.bundle!.collapsed"
            class="wp-bundle-children"
          >
            <ModuleRow
              v-for="child in item.children"
              :key="child.module._uid ?? `${child.module.id}|${child.idx}`"
              :module="child.module"
              :idx="child.idx"
            />
          </div>
        </div>
        <!-- Standalone module — rendered directly via ModuleRow. -->
        <ModuleRow
          v-else
          :module="item.module!"
          :idx="item.idx!"
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
        <div class="wp-w-footer">
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
        data-test="context-empty"
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
      :class="{ 'wp-drop-end--active': dragOver?.kind === 'end', 'wp-drop-end--show': dragState !== null }"
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
      :last-used-seed-reader="lastUsedSeedReader"
      @save="saveEditedModule"
      @close="editingIdx = null"
    />

    <ContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      :header="ctxMenu.header"
      @close="ctxMenu.visible = false"
    />
  </div>
</template>

<style>
@import "../shared/theme.css";
</style>

<style>
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
  transition: opacity 0.15s, filter 0.15s;
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
.wp-module--in-bundle .wp-mod-icon {
  width: 16px !important;
  height: 16px !important;
}
.wp-module--in-bundle .wp-mod-icon .pi {
  font-size: 12px !important;
  line-height: 1 !important;
}

/* Bundle as a real DOM container — header + children inside. Border
 * + bg paint via CSS on this div, growing/shrinking with content. */
.wp-modules-frame { position: relative; }
.wp-bundle {
  border: 1px solid var(--wp-bundle-color, var(--wp-bundle-default));
  border-left-width: 3px;
  border-radius: var(--wp-radius, 4px);
  background: color-mix(in srgb, var(--wp-bundle-color, var(--wp-bundle-default)) 5%, transparent);
  transition: border-width 0.12s, background 0.12s, box-shadow 0.12s;
  display: flex;
  flex-direction: column;
}
.wp-bundle-children {
  padding: 5px 6px 7px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* Frame highlight when crossing into the bundle. */
.wp-bundle--drop-inside {
  border-width: 2px;
  border-left-width: 4px;
  background: color-mix(in srgb, var(--wp-bundle-color, var(--wp-bundle-default)) 15%, transparent);
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.3);
}

/* Populated ↔ Empty page swap. */
.wp-page { display: flex; flex-direction: column; gap: 6px; }
.wp-page-enter-active,
.wp-page-leave-active {
  transition: opacity 0.18s ease;
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
  transition: background 0.12s, border-color 0.12s, color 0.12s;
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
  transition: color 0.12s, border-color 0.12s, background 0.12s;
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
}
.wp-empty-hero-glyph {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.85;
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
  transition: filter 0.15s;
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
  gap: 4px;
  /* `position: relative` is the anchor for the ::before / ::after
   * insertion-line pseudos used by the drop indicators below. */
  position: relative;
  transition: background-color 0.15s, border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}
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
.wp-bundle-header.wp-gap-before { margin-top: 14px; }
.wp-module.wp-gap-after { margin-bottom: 14px; }
/* Margins snap (no transition) so back-to-back zone changes don't
 * leave half-open gaps mid-flight. Transform/opacity/etc still animate
 * via TransitionGroup's FLIP rules + the wp-list-* classes below. */
.wp-modules .wp-module {
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    background 0.14s ease, border-color 0.14s ease, opacity 0.14s ease;
}
.wp-bundle-header { transition: border-bottom-color 0.18s ease, background 0.14s ease; }
.wp-bundle {
  transition: border-width 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}
.wp-bundle.wp-gap-before { margin-top: 14px; }

/* The bar itself. Animates between slots; enter/leave via Transition. */
.wp-gap-bar {
  position: absolute;
  height: 3px;
  background: var(--wp-accent);
  border-radius: 2px;
  box-shadow: 0 0 8px var(--wp-accent);
  pointer-events: none;
  z-index: 4;
  transform-origin: center;
  transition: top 0.1s ease,
    left 0.1s ease,
    width 0.1s ease;
}
.wp-gap-bar-enter-active,
.wp-gap-bar-leave-active {
  transition: opacity 0.12s ease, transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}
.wp-gap-bar-enter-from,
.wp-gap-bar-leave-to {
  opacity: 0;
  transform: scaleX(0.4) scaleY(0.5);
}

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

/* Drop landing pulse — runs once on the dropped row/bundle. */
@keyframes wp-drop-pulse {
  0%   { box-shadow: 0 0 0 0 var(--wp-accent), 0 0 0 0 transparent; }
  35%  { box-shadow: 0 0 0 3px var(--wp-accent), 0 0 16px rgba(167,139,250,0.45); }
  100% { box-shadow: 0 0 0 0 transparent, 0 0 0 0 transparent; }
}
.wp-drop-pulse { animation: wp-drop-pulse 420ms ease-out; }

/* Phase B: drop-rejection shake (200ms) + post-fork flash (1.5s). */
@keyframes wp-shake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
}
@keyframes wp-flash {
  0% { box-shadow: 0 0 0 2px var(--wp-kind-combine), 0 0 14px rgba(52,211,153,0.4); }
  100% { box-shadow: none; }
}
.wp-module--shake { animation: wp-shake 200ms ease-in-out; }
.wp-module--flash { animation: wp-flash 1500ms ease-out; border-color: var(--wp-kind-combine); }

.wp-module-header { display: flex; align-items: center; gap: 6px; }

/* Drag handle — grab cursor scoped here, full card stays draggable. */
.wp-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--wp-text3);
  width: 6px;
  flex-shrink: 0;
  cursor: grab;
  opacity: 0.45;
  transition: opacity 0.15s, color 0.15s;
}
.wp-drag-handle:active { cursor: grabbing; }
.wp-drag-handle__grip { display: block; }
.wp-module:hover .wp-drag-handle,
.wp-module:focus-within .wp-drag-handle { opacity: 1; color: var(--wp-text2); }

.wp-collapse-btn {
  background: none;
  border: none;
  color: var(--wp-text3);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
}
/* Target `.pi` directly — PrimeIcons sets 16px on `.pi` itself. */
.wp-collapse-btn .pi { font-size: 10px; }
.wp-collapse-btn:hover { color: var(--wp-text); }

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
  transition: background-color 0.15s, border-color 0.15s, box-shadow 0.15s;
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
.wp-type-icon.type-pipeline     { color: var(--wp-kind-pipeline); }

/* Kind icon — canonical PrimeIcons per module type (Task 8).
 * Color follows the same --wp-kind-* token map as the border-left. */
.wp-mod-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--wp-kind-wildcard);
}
.wp-mod-icon .pi { font-size: 12px; line-height: 1; }
.wp-module[data-kind="combine"]      .wp-mod-icon { color: var(--wp-kind-combine); }
.wp-module[data-kind="derivation"]   .wp-mod-icon { color: var(--wp-kind-derivation); }
.wp-module[data-kind="constraint"]   .wp-mod-icon { color: var(--wp-kind-constraint); }
.wp-module[data-kind="fixed_values"] .wp-mod-icon { color: var(--wp-kind-fixed); }

.wp-module-name {
  flex: 1;
  font-size: var(--wp-mod-font);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* Conflict dots — structural graph issues (missing template var,
 * duplicate variable, shadowed upstream). Same chip-style triple as
 * `.wp-mod-dot` so the cluster reads as one design family — only the
 * hue distinguishes the kind of issue. Sized 7px to match the mod-dots
 * exactly; the previous 8px outlier made the cluster feel uneven. */
.wp-conflict-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: help;
  border: 1px solid transparent;
}
.wp-conflict-dot--info {
  background:   color-mix(in oklab, var(--wp-accent) 14%, transparent);
  border-color: var(--wp-accent);
}
.wp-conflict-dot--warning {
  background:   color-mix(in oklab, var(--wp-amber) 14%, transparent);
  border-color: var(--wp-amber);
}
.wp-conflict-dot--error {
  background:   color-mix(in oklab, var(--wp-red) 14%, transparent);
  border-color: var(--wp-red);
}

/* Conflict text badges — pair with `.wp-conflict-dot--*`. Same
 * shape + sizing as `.wp-mod-badge` (status badges next to status
 * dots), but tinted off the conflict-severity tokens so the badge
 * picks up the same hue as its dot. Surfaces `override`,
 * `missing var`, `duplicate`, and the constraint-* short labels. */
.wp-conflict-badge {
  font-family: var(--wp-font-sans, sans-serif);
  font-weight: 600;
  font-size: var(--wp-chip-font);
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: var(--wp-chip-pad);
  border-radius: 2px;
  flex-shrink: 0;
  cursor: help;
}
.wp-conflict-badge--info {
  background: color-mix(in oklab, var(--wp-accent) 18%, transparent);
  color: var(--wp-accent);
}
.wp-conflict-badge--warning {
  background: color-mix(in oklab, var(--wp-amber) 18%, transparent);
  color: var(--wp-amber);
}
.wp-conflict-badge--error {
  background: color-mix(in oklab, var(--wp-red) 18%, transparent);
  color: var(--wp-red);
}

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

/* ── Sibling badge ──────────────────────────────────────────────────────
 * Rendered when the same uuid appears more than once in this Context.
 * Phase A: count display only. Phase B will wire auto-fork prompt. */
.wp-mod-badge {
  /* Longhand instead of `font:` shorthand so font-size can flex with the
   * --wp-chip-font density token without each density mode re-declaring
   * the full shorthand. */
  font-family: var(--wp-font-sans);
  font-weight: 600;
  font-size: var(--wp-chip-font);
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: var(--wp-chip-pad);
  border-radius: 2px;
}
.wp-mod-badge--sibling {
  background: color-mix(in srgb, var(--wp-text-dim, var(--wp-text3)) 22%, transparent);
  color: var(--wp-text-muted, var(--wp-text3));
  font-family: var(--wp-font-mono);
  text-transform: none;
  flex-shrink: 0;
}

/* Status text-badges (mockup v5 lines 714, 736, 861) — kind-tinted
 * label that pairs with the matching `.wp-mod-dot--*` so users see
 * BOTH the colour glance and the textual state. Kind palette is the
 * same triple used by the dot cluster:
 *   --wp-status-modified  → "mod"     (user diff vs library)
 *   --wp-warn             → "drift"   (library has a newer version)
 *   --wp-warn             → "no link" (Injector socket — re-uses drift hue)
 *   --wp-danger           → "missing" (gone from library)
 */
.wp-mod-badge--mod,
.wp-mod-badge--drift,
.wp-mod-badge--missing {
  flex-shrink: 0;
  cursor: help;
}
.wp-mod-badge--mod {
  background: color-mix(in oklab, var(--wp-status-modified) 18%, transparent);
  color: var(--wp-status-modified);
}
.wp-mod-badge--drift {
  background: color-mix(in oklab, var(--wp-warn) 18%, transparent);
  color: var(--wp-warn);
}
.wp-mod-badge--missing {
  background: color-mix(in oklab, var(--wp-danger) 18%, transparent);
  color: var(--wp-danger);
}

/* `.wp-kind-chip` rules live in shared/theme.css so the chip stays
 * visually identical across the row, picker, and edit-modal header.
 * Kept as a comment-only anchor here for grep discoverability. */

/* ── Inline action cluster (lock + internal + remove) ───────────────────
 * Always visible (was hover-revealed) — discoverability over chrome.
 * Uses PrimeIcons via `pi` class (Task 9). Replaces the old
 * wp-card-toggle + wp-icon-btn / wp-delete pattern. */
.wp-mod-actions {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
}
.wp-btn--icon-sm {
  background: transparent;
  border: 1px solid transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  font: 500 11px/1 var(--wp-font-sans);
  padding: 3px;
  border-radius: var(--wp-radius, 4px);
  cursor: pointer;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.wp-btn--icon-sm:hover {
  background: var(--wp-bg2);
  border-color: var(--wp-border-soft, var(--wp-border2));
  color: var(--wp-text);
}
.wp-btn--icon-sm .pi { font-size: 11px; }
.wp-btn--icon-sm.is-active {
  color: var(--wp-accent-text, var(--wp-accent));
  background: color-mix(in srgb, var(--wp-accent) 14%, transparent);
}
.wp-btn--icon-sm.is-locked {
  color: var(--wp-warn);
  background: color-mix(in srgb, var(--wp-warn) 14%, transparent);
}
.wp-btn--danger:hover {
  color: var(--wp-danger);
  border-color: color-mix(in srgb, var(--wp-danger) 40%, var(--wp-border-soft, var(--wp-border2)));
}

/* Summary line — read-only preview. Edit via right-click → Edit (or Enter
 * on focused card). Keeping the card chrome non-interactive avoids
 * competing click affordances inside the small DOM widget. */
.wp-summary {
  color: var(--wp-text2);
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 2px 4px 2px 36px;  /* align under the module name (past handle/collapse/toggle/icon) */
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}
.wp-summary__main {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
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
  transition: background .12s ease, border-color .12s ease;
}
.wp-btn:hover { background: var(--wp-bg4); border-color: var(--wp-border, var(--wp-border2)); }
.wp-btn--icon { padding: 5px 6px; width: 26px; height: 26px; justify-content: center; }
.wp-btn--icon .pi { font-size: 12px; }
.wp-btn--primary { background: var(--wp-accent); border-color: var(--wp-accent); color: #fff; }
.wp-btn--primary:hover { background: var(--wp-accent); border-color: var(--wp-accent); filter: brightness(1.08); }

/* ── Footer (Task 10) ───────────────────────────────────────────────── */
.wp-w-footer { display: flex; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--wp-border-soft, var(--wp-border2)); }
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
.wp-list-move { transition: transform 0.25s ease-out; }
/* Leave is instant. `.wp-module` declares `transition: transform 0.15s`
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
.wp-list-enter-active { transition: opacity 0.2s, transform 0.2s; }
.wp-list-enter-from { opacity: 0; transform: translateY(-4px); }

/* Collapse/expand summary line */
.wp-collapse-enter-active,
.wp-collapse-leave-active {
  transition: max-height 0.2s ease, opacity 0.15s, padding 0.15s;
  overflow: hidden;
}
.wp-collapse-enter-from,
.wp-collapse-leave-to { max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0; }
.wp-collapse-enter-to,
.wp-collapse-leave-from { max-height: 32px; opacity: 1; }

/* Pulse on first appear — applies uniformly to every state-marker dot
 * (mod / drift / missing AND every conflict severity) so the user gets
 * the same visual cue regardless of which state surfaced. Previously
 * only `.wp-conflict-dot` carried the animation, which made conflict
 * dots feel different from mod-state dots in side-by-side testing. */
.wp-conflict-dot,
.wp-mod-dot {
  animation: wp-pulse 0.8s ease-out;
}
@keyframes wp-pulse {
  0%   { transform: scale(0.4); opacity: 0; }
  40%  { transform: scale(1.4); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

</style>
