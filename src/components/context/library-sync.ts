import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { applyRelink } from "../../manager/import-export/relink-apply";
import type { BundleInstance, ModuleEntry } from "../../widgets/_shared";
import { pushToast } from "../shared/toast-store";
import {
  forceRefresh as forceRefreshHashes,
  refreshMany,
  refreshModule,
  setLibraryHash,
  subscribe as subscribeDrift,
  unsubscribe as unsubscribeDrift,
} from "./drift-store";
import { buildLibraryChildrenWithIntegrity } from "./bundles/save";
import {
  cascadeRestoreForBundle,
  scanCascadeRestore,
  type CascadeRestoreScan,
} from "./bundles/cascade-restore";
import { computeBundleFingerprint } from "./bundles/bundle-fingerprint";
import { flashRows } from "./bundles/flip";
import { isBundleMissingFromLibrary, isDrifted, isMissingFromLibrary } from "./library-status";
import type { WidgetState } from "./widget-state";

/**
 * The canvas's link to the module/bundle library: the drift-store
 * subscription (mount/unmount), "Push to library…" for a row or a bundle
 * (modal state, cascade restore, and syncing rows to the saved entry),
 * and Refresh-from-library for one drifted row or all of them.
 */
export function useLibrarySync(state: WidgetState) {
  const { value, commitModules, modulesContainer } = state;

  onMounted(() => {
    // Subscribe to the shared drift-store — it manages the 5s poll of the
    // /wp/api/modules/hashes endpoint and exposes the live-hash map that
    // drives both the missing-dot and the drift-dot.
    subscribeDrift();
  });
  onBeforeUnmount(() => {
    unsubscribeDrift();
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

  return {
    driftedCount,
    refreshOne,
    refreshAllDrifted,
    pushDraft,
    pushOpen,
    openPushToLibrary,
    onPushSaved,
    onPushClosed,
    pushBundleDraft,
    pushBundleChildrenForLibrary,
    pushBundleChildrenPreview,
    pushBundleOpen,
    pushBundleCascadeScan,
    openPushBundleToLibrary,
    pushBundleCascadeRestore,
    onBundlePushSaved,
    onBundlePushClosed,
  };
}
