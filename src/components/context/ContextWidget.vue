<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import {
  parseWidgetJsonWithRecovery, serializeWidgetJson,
  emptyContextValue, newModuleId,
  type ContextWidgetValue, type ModuleEntry,
} from "../../widgets/_shared";
import { scanConflicts, labelFor as conflictLabelFor, type Conflict } from "../../extension/conflicts";
import {
  ensure as ensurePreviewLookup,
  lookup as previewLookup,
  cacheVersion as previewCacheVersion,
} from "../../extension/preview-resolver";
import ModulePickerModal from "./ModulePickerModal.vue";
import ModuleEditModal from "./ModuleEditModal.vue";
import ContextMenu, { type ContextMenuItem } from "../shared/ContextMenu.vue";
import { dragState } from "./drag-store";
import { pushToast } from "../shared/toast-store";
import { kindIcon } from "../shared/kind-icons";
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
  /**
   * Pull the seed that the wildcard with the given module id
   * ACTUALLY rolled with on the last run. For locked wildcards
   * that's their `locked_seed`; for unlocked wildcards it's the
   * chain seed at queue time. Captured by the seed widget's
   * `beforeQueued` hook (see widgets/context.ts).
   *
   * Calling without a module id returns the chain-level snapshot.
   *
   * Used by the in-card lock toggle so re-locking after a run
   * restores the seed THIS wildcard rolled with — not the chain
   * seed (which it may have ignored if it was already locked) and
   * not the previous lock value (which may be stale if the user
   * unlocked + re-ran in between).
   *
   * Returns `null` when the user hasn't queued yet —
   * `last_locked_seed` falls through next, then 0 as final default.
   * Optional so headless mounts (tests) can skip wiring it.
   */
  lastUsedSeedReader?: (moduleId?: string) => number | null;
  onChange: (json: string) => void;
}>(), {
  nodeMode: 0,
  upstreamWildcardUuids: () => [],
  downstreamWildcardUuids: () => [],
});

const isMuted = computed(() => props.nodeMode === 2 || props.nodeMode === 4);
const muteLabel = computed(() => props.nodeMode === 4 ? "bypassed" : "muted");

const dragOverId = ref<string | null>(null);
const dragOverEnd = ref(false);

const ctxMenu = ref<{ visible: boolean; x: number; y: number; items: ContextMenuItem[] }>({
  visible: false,
  x: 0,
  y: 0,
  items: [],
});

const editingId = ref<string | null>(null);
const editingModule = computed<ModuleEntry | null>(() =>
  value.value.modules.find((m) => m.id === editingId.value) ?? null,
);

// Variable names defined in OTHER modules of this same node — used by the
// edit modal's autocomplete + per-entry validity. Exclude the module being
// edited so its own (in-flight) names don't echo back as suggestions.
const siblingNodeVars = computed<string[]>(() => {
  const names = new Set<string>();
  for (const m of value.value.modules) {
    if (m.id === editingId.value) continue;
    if (!m.enabled) continue;
    for (const e of m.entries) {
      const n = e.variable_name.trim();
      if (n) names.add(n);
    }
  }
  return [...names];
});

function clearDragHover() {
  if (dragOverId.value === null && !dragOverEnd.value) return;
  dragOverId.value = null;
  dragOverEnd.value = false;
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
  unsubscribeDrift();
});

watch(dragState, (v) => { if (v === null) clearDragHover(); });

// Initial parse runs through the recovery path so we can flag bad workflow
// JSON instead of silently swallowing it. parseWidgetJson stays exported for
// the debug/assembler widgets which don't need recovery semantics.
const initialParse = parseWidgetJsonWithRecovery(props.initialJson, emptyContextValue());
const value = ref<ContextWidgetValue>(initialParse.value);
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
  return scanConflicts(
    enabledOnly,
    props.upstreamVars,
    props.upstreamWildcardUuids,
    props.downstreamWildcardUuids,
  );
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
 *  flip the dot from drift → missing. */
async function refreshOne(m: ModuleEntry): Promise<void> {
  try {
    const merged = await refreshModule(m);
    // Use map-replace (immutable) to match the rest of the file's mutation
    // idiom + guarantee the deep watcher fires regardless of how Vue's
    // reactive proxy treats indexed array assignment.
    if (!value.value.modules.some((x) => x.id === merged.id)) return;
    value.value.modules = value.value.modules.map((x) => x.id === merged.id ? merged : x);
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

/** Bulk — refresh every drifted entry in one batched fetch. */
async function refreshAllDrifted(): Promise<void> {
  const drifted = value.value.modules.filter(isDrifted);
  if (drifted.length === 0) return;
  const result = await refreshMany(drifted);

  if (result.refreshed.length > 0) {
    // Apply all merges in one mutation so Vue's deep watcher fires once.
    const byId = new Map(result.refreshed.map((r) => [r.id, r]));
    value.value.modules = value.value.modules.map((m) => byId.get(m.id) ?? m);
    await forceRefreshHashes();
  }

  if (result.failed.length === 0) {
    pushToast(`Refreshed all ${result.refreshed.length}.`, { severity: "success" });
  } else {
    pushToast(
      `Refreshed ${result.refreshed.length} of ${drifted.length}; ${result.failed.length} stayed drifted.`,
      { severity: "warning" },
    );
  }
}

/** Surfaced as a computed for the bulk-button visibility + label. */
const driftedCount = computed(() => value.value.modules.filter(isDrifted).length);

function isModified(m: ModuleEntry): boolean {
  // Lock + internal have their own dedicated header buttons, so
  // double-counting them in the "modified" dot is just visual
  // noise. The modified indicator is reserved for state that
  // diverges from the library snapshot:
  //   - wildcard: option-pool overrides (subset / weights / pinned /
  //     category filter) — anything that changes WHICH option a roll
  //     picks.
  //   - fixed_values (library-tracked): `values_overrides` non-empty
  //     means the user edited the entries; library `payload.values`
  //     is still the immutable anchor. Inline-created fixed_values
  //     never light up — they have no library state to diverge from.
  const inst = m.instance;
  if (!inst) return false;
  if (m.type === "fixed_values") {
    const overrides = (inst as { values_overrides?: unknown }).values_overrides;
    return Array.isArray(overrides) && overrides.length > 0;
  }
  if (Array.isArray(inst.enabled_options)) return true;
  if (inst.option_weights && Object.keys(inst.option_weights).length > 0) return true;
  if (inst.mode && inst.mode !== "random") return true;
  if (inst.pinned_option_id) return true;
  if (Array.isArray(inst.category_filter) && inst.category_filter.length > 0) return true;
  return false;
}

function isLocked(m: ModuleEntry): boolean {
  return typeof m.instance?.locked_seed === "number";
}
function isInternal(m: ModuleEntry): boolean {
  return !!m.instance?.internal;
}

/** In-card lock toggle. Off → null `locked_seed` but keep
 *  `last_locked_seed` so the next toggle-on has a fallback.
 *  On → fallback chain (per-module priority so re-locking captures
 *  what THIS specific wildcard actually rolled with):
 *    1. lastUsedSeedReader(m.id) — seed THIS wildcard used last
 *       run (locked_seed if it was locked, else chain seed).
 *       Refreshes after every queue. Handles the
 *       lock→run→unlock→lock case correctly: the locked-and-then-
 *       unlocked wildcard restores to ITS locked seed, not the
 *       chain seed of that run.
 *    2. `last_locked_seed` — cold-start fallback when no queue
 *       has happened yet this session.
 *    3. 0 (final default). */
function toggleLockOnCard(m: ModuleEntry) {
  const inst = m.instance ?? {};
  let nextInst: NonNullable<ModuleEntry["instance"]>;
  if (typeof inst.locked_seed === "number") {
    nextInst = { ...inst, locked_seed: null };
  } else {
    let fallback: number;
    const lastUsed = props.lastUsedSeedReader?.(m.id);
    if (typeof lastUsed === "number") {
      fallback = lastUsed;
    } else if (typeof inst.last_locked_seed === "number") {
      fallback = inst.last_locked_seed;
    } else {
      fallback = 0;
    }
    nextInst = { ...inst, locked_seed: fallback, last_locked_seed: fallback };
  }
  value.value = {
    ...value.value,
    modules: value.value.modules.map((x) => x.id === m.id ? { ...x, instance: nextInst } : x),
  };
}

/** In-card internal toggle. Drops the field on toggle-off so the
 *  persisted JSON stays minimal (matches the modal). */
function toggleInternalOnCard(m: ModuleEntry) {
  const inst = m.instance ?? {};
  let nextInst: NonNullable<ModuleEntry["instance"]>;
  if (inst.internal) {
    const { internal: _drop, ...rest } = inst;
    void _drop;
    nextInst = rest;
  } else {
    nextInst = { ...inst, internal: true };
  }
  value.value = {
    ...value.value,
    modules: value.value.modules.map((x) => x.id === m.id ? { ...x, instance: nextInst } : x),
  };
}

/** Tooltip listing what's been overridden on the module — surfaced
 *  on hover of the modified-indicator dot. Order matches the modal's
 *  field layout for visual consistency. */
function modifiedTooltip(m: ModuleEntry): string {
  const inst = m.instance;
  if (!inst) return "";
  const bits: string[] = [];
  if (inst.mode === "pinned") bits.push("pinned");
  else if (inst.mode === "subcategory") bits.push("subset");
  if (Array.isArray(inst.category_filter) && inst.category_filter.length > 0) {
    bits.push(`cats: ${inst.category_filter.join(", ")}`);
  }
  if (Array.isArray(inst.enabled_options)) {
    bits.push(`${inst.enabled_options.length} option(s) enabled`);
  }
  if (inst.option_weights && Object.keys(inst.option_weights).length > 0) {
    bits.push(`${Object.keys(inst.option_weights).length} weight override(s)`);
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

function summaryFor(m: ModuleEntry): string {
  if (m.type === "fixed_values") {
    const named = m.entries.filter((e) => e.variable_name.trim() !== "");
    if (named.length === 0) return "(empty)";
    const heads = named.slice(0, 2).map((e) => `$${e.variable_name}`);
    const more = named.length - heads.length;
    return more > 0 ? `${heads.join(", ")}, +${more} more` : heads.join(", ");
  }
  const p = (m.payload ?? {}) as Record<string, unknown>;
  switch (m.type) {
    case "wildcard": {
      const binding = (p.var_binding as string)?.trim();
      const opts = Array.isArray(p.options) ? p.options.length : 0;
      const head = binding ? `$${binding}` : "wildcard";
      return opts ? `${head} · ${opts} option${opts === 1 ? "" : "s"}` : head;
    }
    case "combine": {
      const out = (p.output_var as string)?.trim();
      return out ? `→ $${out}` : "template";
    }
    case "derivation": {
      const rules = Array.isArray(p.rules) ? p.rules.length : 0;
      return `${rules} rule${rules === 1 ? "" : "s"}`;
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
      return `$${src} → $${tgt} · ${rowKeys.length}×${colKeys.length}`;
    }
    case "pipeline":     return `${Array.isArray(p.steps) ? p.steps.length : 0} steps`;
    default:             return m.type;
  }
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

    // Append picks first (in input order) so user-picked rows land
    // before any transitive deps in the resulting card list.
    const seenInBundle = new Set<string>();
    for (const uuid of incomingOrder) {
      if (existingIds.has(uuid) || seenInBundle.has(uuid)) continue;
      const entry = snaps[uuid];
      if (!entry) continue;
      seenInBundle.add(uuid);
      newEntries.push({
        id: uuid,
        type: entry.type as ModuleEntry["type"],
        enabled: true,
        meta: { name: entry.name },
        entries: entriesFromSnapshot(entry),
        payload: entry.payload,
        payload_hash: entry.payload_hash,
      });
    }
    // Then any transitive deps the walker pulled in but that weren't
    // in the explicit pickOrder.
    for (const [uuid, entry] of Object.entries(snaps)) {
      if (existingIds.has(uuid) || seenInBundle.has(uuid)) continue;
      seenInBundle.add(uuid);
      newEntries.push({
        id: uuid,
        type: entry.type as ModuleEntry["type"],
        enabled: true,
        meta: { name: entry.name },
        entries: entriesFromSnapshot(entry),
        payload: entry.payload,
        payload_hash: entry.payload_hash,
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

function removeModule(id: string) {
  // Soft-delete: capture position + module, drop a toast with Undo. Undo
  // splices it back at its original index. After 5s the toast auto-dismisses
  // and the deletion is permanent.
  const idx = value.value.modules.findIndex((m) => m.id === id);
  if (idx < 0) return;
  const removed = value.value.modules[idx];
  const moduleLabel = removed.meta.name?.trim() || "module";
  value.value = { ...value.value, modules: value.value.modules.filter((m) => m.id !== id) };
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

function duplicateModule(id: string) {
  const list = [...value.value.modules];
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  // JSON round-trip is Proxy-safe at every depth (toRaw only unwraps the
  // immediate object — nested Proxies in m.entries still throw structuredClone).
  const copy: ModuleEntry = JSON.parse(JSON.stringify(list[i]));
  copy.id = newModuleId();
  copy.meta = { ...copy.meta, name: `${copy.meta.name} (copy)` };
  // Strip `payload_hash` so the duplicate is treated as a local-only
  // module (no library tie). Otherwise the missing-from-library
  // indicator would light up immediately even though the duplicate
  // was never expected to exist in the library — it's a fresh local
  // clone, semantically equivalent to inline-creating a new module.
  // The original library row stays linked through the ORIGINAL entry.
  delete copy.payload_hash;
  list.splice(i + 1, 0, copy);
  value.value = { ...value.value, modules: list };
  pushToast(`Duplicated “${list[i].meta.name?.trim() || "module"}”`, {
    severity: "success",
    lifeMs: 3000,
    action: {
      label: "Undo",
      onSelect: () => {
        value.value = { ...value.value, modules: value.value.modules.filter((m) => m.id !== copy.id) };
      },
    },
  });
}

function moveToEdge(id: string, edge: "top" | "bottom") {
  const list = [...value.value.modules];
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return;
  const [m] = list.splice(i, 1);
  if (edge === "top") list.unshift(m);
  else list.push(m);
  value.value = { ...value.value, modules: list };
}

function toggleEnabled(id: string) {
  const list = value.value.modules.map((m) => m.id !== id ? m : { ...m, enabled: !m.enabled });
  value.value = { ...value.value, modules: list };
}

function toggleCollapsed(id: string) {
  const list = value.value.modules.map((m) => m.id !== id ? m : { ...m, collapsed: !m.collapsed });
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

/** Open the SPA library in a new tab. */
function openSpaLibrary(): void {
  window.open("/wp/", "_blank", "noopener");
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
function openEditModal(id: string) {
  editingId.value = id;
}

function saveEditedModule(updated: ModuleEntry) {
  const list = value.value.modules.map((m) => m.id === updated.id ? updated : m);
  value.value = { ...value.value, modules: list };
  editingId.value = null;
}

function onCardKeydown(ev: KeyboardEvent, m: ModuleEntry) {
  // Don't intercept keys when focus is inside an input/textarea inside the
  // card (none today, but defense in depth for future inline controls).
  const target = ev.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

  // Ctrl/Cmd+D — duplicate focused module
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "d") {
    ev.preventDefault();
    duplicateModule(m.id);
    return;
  }

  // Shift+ArrowUp / Shift+ArrowDown — reorder
  if (ev.shiftKey && ev.key === "ArrowUp") {
    ev.preventDefault();
    moveModule(m.id, -1);
    return;
  }
  if (ev.shiftKey && ev.key === "ArrowDown") {
    ev.preventDefault();
    moveModule(m.id, 1);
    return;
  }

  // Enter — open edit modal (matches the context menu's primary action)
  if (ev.key === "Enter") {
    ev.preventDefault();
    openEditModal(m.id);
    return;
  }

  // Delete — remove module
  if (ev.key === "Delete") {
    ev.preventDefault();
    removeModule(m.id);
    return;
  }
}

function moveModule(id: string, dir: -1 | 1) {
  const list = [...value.value.modules];
  const i = list.findIndex((m) => m.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  value.value = { ...value.value, modules: list };
  // Vue reorders the DOM by detach+reattach even with :key; focus is dropped.
  // Refocus the moved card after the patch flushes.
  nextTick(() => {
    const el = document.querySelector<HTMLElement>(`.wp-module[data-module-id="${id}"]`);
    el?.focus();
  });
}

function openContextMenu(ev: MouseEvent, m: ModuleEntry) {
  const list = value.value.modules;
  const i = list.findIndex((x) => x.id === m.id);
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
    { label: "Edit", icon: "pi-pencil", onSelect: () => openEditModal(m.id) },
  ];
  // Refresh + Save are mutually exclusive in normal use (a module is
  // either drifted OR missing OR clean), so hiding the inactive entry
  // beats greying it — matches Save's existing conditional-push pattern
  // and keeps the menu shorter.
  if (isDrifted(m)) {
    items.push({
      label: "Refresh from library",
      icon: "pi-refresh",
      onSelect: () => { void refreshOne(m); },
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
  items.push(
    { label: m.enabled ? "Disable" : "Enable", icon: m.enabled ? "pi-eye-slash" : "pi-eye", onSelect: () => toggleEnabled(m.id) },
    { label: m.collapsed ? "Expand" : "Collapse", icon: m.collapsed ? "pi-chevron-down" : "pi-chevron-right", onSelect: () => toggleCollapsed(m.id) },
    { label: "Duplicate", icon: "pi-clone", onSelect: () => duplicateModule(m.id), divider: true },
    { label: "Move to top", icon: "pi-angle-double-up", disabled: i === 0, onSelect: () => moveToEdge(m.id, "top") },
    { label: "Move to bottom", icon: "pi-angle-double-down", disabled: i === list.length - 1, onSelect: () => moveToEdge(m.id, "bottom") },
    { label: "Remove", icon: "pi-trash", danger: true, divider: true, onSelect: () => removeModule(m.id) },
  );
  ctxMenu.value = { visible: true, x: Math.max(8, x), y: Math.max(8, y), items };
}

// ── Drag-and-drop ───────────────────────────────────────────────────────
function onDragStart(ev: DragEvent, mod: ModuleEntry) {
  dragState.value = { sourceNodeId: props.nodeId, module: JSON.parse(JSON.stringify(mod)) };
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", mod.id);
  }
}

function onDragEnd() {
  const ds = dragState.value;
  if (ds && ds.sourceNodeId === props.nodeId && !sameNodeDropHandled) {
    if (ds.consumedBy != null && ds.consumedBy !== props.nodeId) {
      value.value = { ...value.value, modules: value.value.modules.filter((m) => m.id !== ds.module.id) };
    }
  }
  dragState.value = null;
  sameNodeDropHandled = false;
  dragOverId.value = null;
  dragOverEnd.value = false;
}

let sameNodeDropHandled = false;

function onDragEnter(ev: DragEvent, targetId: string | null) {
  if (!dragState.value) return;
  ev.preventDefault();
  if (targetId === null) {
    dragOverId.value = null;
    dragOverEnd.value = true;
  } else {
    dragOverId.value = targetId;
    dragOverEnd.value = false;
  }
}

function onDragOver(ev: DragEvent) {
  if (!dragState.value) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
}

function onContainerLeave(ev: DragEvent) {
  const container = ev.currentTarget as HTMLElement;
  const next = ev.relatedTarget as Node | null;
  if (next && container.contains(next)) return;
  clearDragHover();
}

function onDrop(ev: DragEvent, targetId: string | null) {
  ev.preventDefault();
  ev.stopPropagation();
  const ds = dragState.value;
  if (!ds) return;
  dragOverId.value = null;
  dragOverEnd.value = false;

  if (ds.sourceNodeId === props.nodeId) {
    const list = [...value.value.modules];
    const fromIdx = list.findIndex((m) => m.id === ds.module.id);
    if (fromIdx < 0) return;
    list.splice(fromIdx, 1);
    const insertIdx = targetId === null ? list.length : list.findIndex((m) => m.id === targetId);
    list.splice(insertIdx < 0 ? list.length : insertIdx, 0, ds.module);
    value.value = { ...value.value, modules: list };
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
      `"${dupName}" is already in this node — modules can't be duplicated within a single WP_Context.`,
      { severity: "warning" },
    );
    sameNodeDropHandled = true;
    return;
  }
  // Inline-created fixed_values modules don't carry a library uuid,
  // so a fresh random id keeps the value.modules invariant
  // (each entry's id unique within a widget) when copying them.
  const isLibraryBacked = ds.module.type !== "fixed_values"
    || (ds.module.payload !== undefined && Object.keys(ds.module.payload ?? {}).length > 0);
  const inserted: ModuleEntry = isLibraryBacked
    ? { ...ds.module }
    : { ...ds.module, id: newModuleId() };
  const list = [...value.value.modules];
  const insertIdx = targetId === null ? list.length : list.findIndex((m) => m.id === targetId);
  list.splice(insertIdx < 0 ? list.length : insertIdx, 0, inserted);
  value.value = { ...value.value, modules: list };
  dragState.value = { ...ds, consumedBy: props.nodeId };
}
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
      <div v-if="!isEmpty" key="populated" class="wp-page">
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

        <TransitionGroup name="wp-list" tag="div" class="wp-modules">
      <div
        v-for="m in value.modules"
        :key="m.id"
        :data-module-id="m.id"
        :data-kind="m.type"
        class="wp-module"
        tabindex="0"
        :class="{
          'wp-disabled': !m.enabled,
          'wp-conflict-error': severityFor(m.id) === 'error',
          'wp-conflict-warning': severityFor(m.id) === 'warning',
          'wp-conflict-info': severityFor(m.id) === 'info',
          'wp-state-modified': isModified(m),
          'wp-state-drift': isDrifted(m),
          'wp-state-missing': isMissingFromLibrary(m),
          'wp-drop-target': dragOverId === m.id,
          'wp-mod--mod': isModified(m),
          'wp-mod--drift': isDrifted(m),
          'wp-mod--err': isMissingFromLibrary(m),
        }"
        @dragenter="(ev) => onDragEnter(ev, m.id)"
        @dragover="onDragOver"
        @drop="(ev) => onDrop(ev, m.id)"
        @contextmenu.stop.prevent="(ev) => openContextMenu(ev, m)"
        @keydown="(ev) => onCardKeydown(ev, m)"
      >
        <div class="wp-module-header">
          <span
            class="wp-drag-handle"
            draggable="true"
            title="Drag to reorder (drop on another node to move)"
            @dragstart="(ev) => onDragStart(ev, m)"
            @dragend="onDragEnd"
          ><i class="pi pi-bars" aria-hidden="true"></i></span>

          <button
            type="button"
            class="wp-collapse-btn"
            :title="isCollapsed(m) ? 'Expand' : 'Collapse'"
            @click="toggleCollapsed(m.id)"
          ><i :class="['pi', isCollapsed(m) ? 'pi-chevron-right' : 'pi-chevron-down']" aria-hidden="true"></i></button>

          <label class="wp-toggle" :title="m.enabled ? 'Disable' : 'Enable'">
            <input
              type="checkbox"
              :checked="m.enabled"
              :aria-label="`enable ${m.meta.name}`"
              @change="toggleEnabled(m.id)"
            />
            <span class="wp-toggle-mark"></span>
          </label>

          <span class="wp-mod-icon" :title="m.type" aria-hidden="true">
            <i :class="kindIcon(m.type)" />
          </span>

          <span class="wp-module-name" :title="m.meta.name || '(unnamed)'">
            {{ m.meta.name || "(unnamed)" }}
          </span>

          <!-- Sibling badge — shown when the same uuid appears more
               than once in this Context (Phase A: count only; Phase B
               will wire auto-fork). -->
          <span
            v-if="siblingInfo(m)"
            class="wp-mod-badge wp-mod-badge--sibling"
            :title="`used ${siblingInfo(m)!.total} times in this Context`"
          >#{{ siblingInfo(m)!.index }} of {{ siblingInfo(m)!.total }}</span>

          <!-- Status-dots cluster — read-only indicators grouped so
               the eye reads them as a single "module health" glance.
               Order modified → drift → missing → conflict (severity
               rises left → right). Buttons sit AFTER this cluster so
               dots never split the interactive controls. -->
          <span class="wp-mod-dots">
            <span
              v-if="isModified(m)"
              class="wp-mod-dot wp-mod-dot--modified"
              :title="modifiedTooltip(m)"
              aria-hidden="true"
            ></span>
            <span
              v-if="isDrifted(m)"
              class="wp-mod-dot wp-mod-dot--drift"
              title="Drifted — library has a newer version. Right-click → Refresh from library."
              aria-hidden="true"
            ></span>
            <span
              v-if="isMissingFromLibrary(m)"
              class="wp-mod-dot wp-mod-dot--missing"
              title="Not in library — right-click → Save to library to add it"
              aria-hidden="true"
            ></span>
            <span
              v-if="severityFor(m.id)"
              class="wp-conflict-dot"
              :class="`wp-conflict-dot--${severityFor(m.id)}`"
              :title="conflictTooltip(m.id)"
              aria-hidden="true"
            ></span>
          </span>

          <!-- Inline action cluster — lock + internal + remove.
               Fades in on row hover via .wp-mod-actions opacity
               transition. Lock + internal only on wildcard kind
               (engine ignores them elsewhere). -->
          <div class="wp-mod-actions">
            <button
              v-if="m.type === 'wildcard'"
              type="button"
              class="wp-btn wp-btn--icon-sm"
              :class="{ 'is-locked': isLocked(m) }"
              data-test="row-action-lock"
              :title="isLocked(m) ? `Locked seed: ${m.instance?.locked_seed}. Click to unlock.` : 'Lock seed'"
              :aria-label="isLocked(m) ? 'Unlock seed' : 'Lock seed'"
              @click.stop="toggleLockOnCard(m)"
            ><i class="pi pi-lock" /></button>
            <button
              v-if="m.type === 'wildcard'"
              type="button"
              class="wp-btn wp-btn--icon-sm"
              :class="{ 'is-active': isInternal(m) }"
              data-test="row-action-internal"
              :title="isInternal(m) ? 'Unmark internal' : 'Mark internal'"
              :aria-label="isInternal(m) ? 'Unmark internal' : 'Mark internal'"
              @click.stop="toggleInternalOnCard(m)"
            ><i class="pi pi-globe" /></button>
            <button
              type="button"
              class="wp-btn wp-btn--icon-sm wp-btn--danger"
              data-test="row-action-remove"
              title="Remove"
              aria-label="Remove module"
              @click.stop="removeModule(m.id)"
            ><i class="pi pi-trash" /></button>
          </div>
        </div>

        <Transition name="wp-collapse">
          <div v-if="!isCollapsed(m)" class="wp-summary" :title="summaryFor(m)">
            {{ summaryFor(m) }}
          </div>
        </Transition>
      </div>
        </TransitionGroup>

        <!-- Footer: primary add + SPA link. Shown only when list is non-empty. -->
        <div class="wp-w-footer">
          <button
            class="wp-btn wp-btn--primary"
            data-testid="open-picker"
            @click="openPicker"
          >
            <i class="pi pi-plus" /> Add module
          </button>
          <button class="wp-btn" @click="openSpaLibrary">
            Open in SPA <i class="pi pi-external-link" />
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
        <div class="wp-empty-hero-glyph" aria-hidden="true" />
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
          <button class="wp-btn" @click="openSpaLibrary">Open library ↗</button>
        </div>
      </div>
    </Transition>

    <div
      class="wp-drop-end"
      :class="{ 'wp-drop-end--active': dragOverEnd, 'wp-drop-end--show': dragState !== null }"
      @dragenter="(ev) => onDragEnter(ev, null)"
      @dragover="onDragOver"
      @drop="(ev) => onDrop(ev, null)"
    >Drop here</div>

    <ModulePickerModal
      :visible="showPicker"
      :already-added="value.modules.map((m: ModuleEntry) => m.id)"
      :already-added-ids="value.modules.map((m: ModuleEntry) => m.id)"
      @add="onPickerAdd"
      @close="showPicker = false"
    />

    <ModuleEditModal
      :visible="editingModule !== null"
      :module="editingModule"
      :upstream-vars="upstreamVars"
      :sibling-vars="siblingNodeVars"
      :sibling-modules="value.modules"
      :last-used-seed-reader="lastUsedSeedReader"
      @save="saveEditedModule"
      @close="editingId = null"
    />

    <ContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenu.items"
      @close="ctxMenu.visible = false"
    />
  </div>
</template>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
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
  content: attr(data-mode-label);
  position: absolute;
  top: 4px;
  right: 6px;
  z-index: 4;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
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
  gap: 6px;
}

/* ── Populated ↔ Empty page swap ───────────────────────────────────────
 * Wraps both the populated layout (section label + cards + small add btn)
 * and the empty hero. mode="out-in" on the parent <Transition> sequences
 * the swap: populated fades out fully BEFORE empty fades in, so removing
 * the last module never causes the leaving card to stack visually with
 * the appearing hero. */
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
  width: 38px; height: 38px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, var(--wp-kind-wildcard), var(--wp-accent) 60%, transparent 75%);
  opacity: 0.5;
  filter: blur(0.5px);
  position: relative;
}
.wp-empty-hero-glyph::after {
  content: "✦";
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 18px; opacity: 0.85;
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
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
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

/* Card-border tint by state. Rules are ordered low-to-high precedence
 * — equal-specificity selectors lose the cascade race to whichever
 * appears LAST, so the order below reflects severity:
 *   info (conflict)  → indigo  — lowest
 *   modified         → orange  — user override
 *   warning (conflict) → amber  — duplicate / shadow
 *   drift            → amber   — library has newer payload
 *   missing          → red     — uuid gone from library
 *   error (conflict) → red     — broken graph — highest
 * Adding a new tier means slotting it into the right place in this
 * cascade chain, NOT just appending. */
.wp-module.wp-conflict-info     { border-color: var(--wp-accent); }
.wp-module.wp-state-modified    { border-color: var(--wp-status-modified); }
.wp-module.wp-conflict-warning  { border-color: var(--wp-amber); }
.wp-module.wp-state-drift       { border-color: var(--wp-warn); }
.wp-module.wp-state-missing     { border-color: var(--wp-danger); }
.wp-module.wp-conflict-error    { border-color: var(--wp-red); }
.wp-module.wp-drop-target {
  border-color: var(--wp-accent);
  box-shadow: inset 0 2px 0 var(--wp-accent);
}

/* Status-state full-border + bg tint (Task 8).
 * Applied in ADDITION to the existing legacy state classes so the
 * kind border-left is preserved while the full border reflects status.
 * Lower specificity than wp-drop-target so drop feedback wins. */
.wp-module.wp-mod--mod   { border-color: var(--wp-status-modified); background: color-mix(in srgb, var(--wp-status-modified) 8%, var(--wp-bg3)); }
.wp-module.wp-mod--drift { border-color: var(--wp-warn);            background: color-mix(in srgb, var(--wp-warn) 8%, var(--wp-bg3)); }
.wp-module.wp-mod--err   { border-color: var(--wp-danger);          background: color-mix(in srgb, var(--wp-danger) 8%, var(--wp-bg3)); }

.wp-module-header { display: flex; align-items: center; gap: 6px; }

.wp-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  color: var(--wp-text3);
  font-size: 11px;
  line-height: 1;
  user-select: none;
  width: 14px;
  flex-shrink: 0;
  /* Stay subtle on idle cards; reveal on hover/focus so the chrome isn't
   * noisy in lists with many modules. */
  opacity: 0.35;
  transition: opacity 0.15s, color 0.15s, transform 0.15s;
}
.wp-module:hover .wp-drag-handle,
.wp-module:focus-within .wp-drag-handle {
  opacity: 1;
}
.wp-drag-handle:hover {
  color: var(--wp-text);
  transform: translateX(-1px);
}
.wp-drag-handle:active { cursor: grabbing; }

.wp-collapse-btn {
  background: none;
  border: none;
  color: var(--wp-text3);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
}
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
  transition: all 0.15s;
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
  font-size: 12px;
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

/* Cluster wrapper — keeps every status dot (modified, missing,
 * conflict) on one inline run so they never get separated by
 * interactive controls. Empty cluster collapses (no children → no
 * gap), so cards without indicators look unchanged. */
.wp-mod-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 3px 5px;
  border-radius: 2px;
}
.wp-mod-badge--sibling {
  background: color-mix(in srgb, var(--wp-text-dim, var(--wp-text3)) 22%, transparent);
  color: var(--wp-text-muted, var(--wp-text3));
  font-family: var(--wp-font-mono);
  text-transform: none;
  flex-shrink: 0;
}

/* ── Inline action cluster (lock + internal + remove) ───────────────────
 * Fades in on row hover; uses PrimeIcons via `pi` class (Task 9).
 * Replaces the old wp-card-toggle + wp-icon-btn / wp-delete pattern. */
.wp-mod-actions {
  display: flex;
  gap: 1px;
  opacity: 0;
  transition: opacity .12s ease;
  flex-shrink: 0;
}
.wp-module:hover .wp-mod-actions { opacity: 1; }
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
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

/* Conflict dot pulse on first appear */
.wp-conflict-dot {
  animation: wp-pulse 0.8s ease-out;
}
@keyframes wp-pulse {
  0%   { transform: scale(0.4); opacity: 0; }
  40%  { transform: scale(1.4); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

</style>
