/**
 * Cascade restore — heal missing children before pushing a bundle.
 *
 * Triggered from PushBundleToLibraryModal when the outer being saved
 * contains children whose source library entries have been deleted
 * upstream (`_missing_ref` for inner-bundle refs, or workflow rows
 * whose uuids no longer match a library row for module children).
 *
 * Bottom-up traversal — a parent can only reference live ids, so the
 * order is forced:
 *   1. POST a fresh library entry for every missing MODULE child in
 *      the outer's range (uses the local payload as the seed; the new
 *      uuid replaces the dead one).
 *   2. POST a fresh library entry for every missing INNER BUNDLE
 *      (parent_uid === outer._uid). Its children list is built from the
 *      live workflow state, then rewritten so any module id from step 1
 *      maps to its new uuid before the POST goes out.
 *   3. Build the OUTER's children list and rewrite both module ids
 *      (step 1 map) and inner-bundle ref ids (step 2 map). The caller
 *      uses this rewritten array as the `children` payload for the
 *      outer's own POST/PUT.
 *
 * All-or-nothing: any POST failure throws — the caller aborts the
 * outer save and surfaces which restoration failed. We don't roll back
 * already-created library entries (no DELETE chain) because the user
 * can manually delete them or re-try cascade and the duplicates will
 * just sit alongside as orphans rather than corrupt anything.
 *
 * Workflow rebinding: returns `newModules` + `newBundles` arrays with
 * the dead uuids swapped for the fresh ones. Caller commits these to
 * `value.value` so the workflow stops rendering MISSING badges for
 * the restored entries. Mirrors the "reattach" mode of the single-
 * row push flow.
 *
 * Pure helper — no Vue / no DOM. Tested via the modal's integration
 * tests; standalone unit coverage can land in a follow-up.
 */
import { api } from "../../../manager/api/client";
import {
  buildLibraryChildrenWithIntegrity,
  toChildSnapshot,
} from "./save";
import { computeBundleFingerprint } from "./bundle-fingerprint";
import { walkRemap } from "./uuid-remap";
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";

export interface CascadeRestoreInputs {
  outer: BundleInstance;
  modules: ModuleEntry[];
  bundles: BundleInstance[];
  /** True when the module row's id no longer matches a live library
   *  entry. Caller wires this to its drift-store predicate. */
  isModuleMissing: (m: ModuleEntry) => boolean;
  /** True when the inner BundleInstance's library_id no longer matches
   *  a live bundle library entry. Caller wires this to its drift-store
   *  predicate. */
  isBundleMissing: (b: BundleInstance) => boolean;
}

export interface CascadeRestoreResult {
  /** Rewritten outer children — ready to use as the `children` field
   *  on the outer's POST/PUT body. */
  rewrittenChildren: Record<string, unknown>[];
  /** Workflow modules with dead uuids swapped for restored ones. */
  newModules: ModuleEntry[];
  /** Workflow bundles with inner library_ids rebound to restored ones. */
  newBundles: BundleInstance[];
  /** Count of modules POSTed as fresh library entries. */
  restoredModuleCount: number;
  /** Count of inner bundles POSTed as fresh library entries. */
  restoredBundleCount: number;
}

/** Strip the meta fields the library entry's name slot should carry —
 *  module rows already use `meta.name`, but the POST body shape expects
 *  a top-level `name` field. Pulling it out separately keeps the body
 *  shape minimal. */
function pickModuleName(m: ModuleEntry): string {
  const metaName = m.meta?.name;
  if (typeof metaName === "string" && metaName.trim().length > 0) {
    return metaName.trim();
  }
  return m.type;
}

export async function cascadeRestoreForBundle(
  inputs: CascadeRestoreInputs,
): Promise<CascadeRestoreResult> {
  const { outer, modules, bundles, isModuleMissing, isBundleMissing } = inputs;

  // ── Phase 1: restore missing modules in the outer's range ───────────
  // Iterates the full range (including rows owned by inner bundles)
  // because inner-bundle children are still inside the outer's range —
  // they need their uuids in the moduleMap before Phase 2 rebuilds the
  // inner's children list.
  //
  // Two passes:
  //   Pass 1 — POST each missing module RAW to MINT a fresh id. The raw
  //     payload is just a seed; it may carry refs to SIBLING restored
  //     modules that haven't minted their new ids yet (forward refs),
  //     so the standalone library entry can ship dangling source/target
  //     / `@{}` refs at this point.
  //   Pass 2 — runs AFTER the loop, when `moduleMap` is COMPLETE. For
  //     each restored module it walkRemaps the payload against the full
  //     map; if any ref actually changed, it corrects the freshly-created
  //     library entry via `api.modules.update`. This is the same rewrite
  //     Phase 3 (pushed children) and Phase 4 (workflow rebind) apply —
  //     the standalone library entries are the third output that needs it.
  //     Ref-free modules (most wildcards) don't differ → no update.
  const moduleMap = new Map<string, string>();
  // Library payload_hash per restored module (keyed by OLD id). Phase 4 stamps
  // it on the workflow row so the canvas doesn't flash DRIFT against the
  // freshly-created/corrected library entry — mirror of the bundle
  // inserted_at_hash sync below. A corrected constraint is the case that bites:
  // its stale frozen-snapshot hash != the new entry's hash (its payload moved).
  const moduleHashMap = new Map<string, string>();
  const restored: { newId: string; module: ModuleEntry }[] = [];
  for (let i = outer.start_idx; i <= outer.end_idx; i++) {
    const m = modules[i];
    if (!m) continue;
    if (!isModuleMissing(m)) continue;
    const baseName = pickModuleName(m);
    const res = await fetch("/wp/api/modules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: m.type,
        name: baseName,
        payload: m.payload ?? {},
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Module restore failed for "${baseName}": HTTP ${res.status} ${text}`);
    }
    const body = (await res.json()) as { id?: string; payload_hash?: string };
    if (!body.id) throw new Error(`Module restore for "${baseName}" returned no id`);
    moduleMap.set(m.id, body.id);
    if (body.payload_hash) moduleHashMap.set(m.id, body.payload_hash);
    restored.push({ newId: body.id, module: m });
  }

  // Pass 2: correct standalone library entries whose payload referenced a
  // sibling restored module. `moduleMap` is complete now, so forward refs
  // (a constraint POSTed before its target wildcard minted its id) resolve.
  const restoreTable: Record<string, string> = {};
  for (const [k, v] of moduleMap) restoreTable[k] = v;
  if (Object.keys(restoreTable).length > 0) {
    for (const { newId, module: m } of restored) {
      const original = m.payload ?? {};
      const rewrittenPayload = walkRemap(original, restoreTable) as Record<string, unknown>;
      // Only PUT when a ref actually moved — ref-free modules are unchanged.
      if (JSON.stringify(rewrittenPayload) === JSON.stringify(original)) continue;
      const updated = await api.modules.update(newId, {
        name: pickModuleName(m),
        payload: rewrittenPayload,
      });
      // The corrected payload changes the hash — capture it so Phase 4 stamps
      // the workflow row with the LIVE library hash (overrides the POST hash).
      moduleHashMap.set(m.id, updated.payload_hash);
    }
  }

  // ── Phase 2: restore missing inner bundles ──────────────────────────
  // Each inner's children list is built from the LIVE workflow state.
  // Module-id rewrites from Phase 1 are applied before the POST so the
  // restored inner bundle references live module uuids.
  // The created bundle's payload_hash is captured so Phase 4 can stamp
  // `inserted_at_hash` on the workflow inner — without that, the workflow
  // row reads "LIBRARY UPDATED" (drift) immediately after cascade
  // because its stale-from-when-it-was-MISSING inserted_at_hash never
  // matches the freshly-POSTed entry's hash.
  const innerBundleMap = new Map<string, string>();
  const innerHashMap = new Map<string, string>();
  for (const inner of bundles) {
    if (inner.parent_uid !== outer._uid) continue;
    if (!isBundleMissing(inner)) continue;
    const integrity = buildLibraryChildrenWithIntegrity(inner, modules, bundles);
    const rewritten = integrity.children.map((c) =>
      rewriteChildId(c, moduleMap, innerBundleMap, moduleHashMap),
    );
    const created = await api.bundles.create({
      name: inner.name || "bundle",
      color: inner.color ?? null,
      children: rewritten,
    });
    innerBundleMap.set(inner.library_id, created.id);
    innerHashMap.set(inner.library_id, created.payload_hash);
  }

  // ── Phase 3: build the outer's children with both rewrites applied ──
  const outerIntegrity = buildLibraryChildrenWithIntegrity(outer, modules, bundles);
  const rewrittenChildren = outerIntegrity.children.map((c) =>
    rewriteChildId(c, moduleMap, innerBundleMap, moduleHashMap),
  );

  // ── Phase 4: rebind workflow state so MISSING badges clear ──────────
  // Bundles also need `inserted_at_hash` swapped to the freshly-POSTed
  // hash; without that the workflow row's stale hash (captured from the
  // since-deleted library entry at insert time) wouldn't match the new
  // entry's hash and the BundleHeader would render LIBRARY UPDATED
  // until the user manually reset.
  // Rewrite table shared with Phase 3's child rewrite. The workflow modules
  // need their INTERNAL refs repointed too — a restored constraint's
  // source/target + any embedded `@{}` ref — not just their own `id`.
  // Without this, after a cascade restore the canvas keeps a SRC/TGT-MISSING
  // constraint even though the pushed library entry (rewrittenChildren) is
  // correct: Phase 4 swapped ids but left payloads pointing at the dead uuids.
  const refTable: Record<string, string> = {};
  for (const [k, v] of moduleMap) refTable[k] = v;
  for (const [k, v] of innerBundleMap) refTable[k] = v;
  const hasRefs = Object.keys(refTable).length > 0;
  const newModules = modules.map((m) => {
    let next = moduleMap.has(m.id) ? { ...m, id: moduleMap.get(m.id)! } : m;
    if (hasRefs) {
      if (next.payload && typeof next.payload === "object") {
        next = { ...next, payload: walkRemap(next.payload, refTable) as ModuleEntry["payload"] };
      }
      if (next.instance && typeof next.instance === "object") {
        next = { ...next, instance: walkRemap(next.instance, refTable) as ModuleEntry["instance"] };
      }
    }
    // Sync payload_hash to the restored library entry so the canvas doesn't
    // flash DRIFT against it (mirror of newBundles' inserted_at_hash below).
    // moduleHashMap only holds restored modules, so a non-restored row keeps
    // its own hash.
    const newHash = moduleHashMap.get(m.id);
    if (newHash) next = { ...next, payload_hash: newHash };
    return next;
  });
  const newBundles = bundles.map((b) => {
    const next = innerBundleMap.get(b.library_id);
    if (!next) return b;
    const hash = innerHashMap.get(b.library_id);
    const rebound: BundleInstance = {
      ...b,
      library_id: next,
      ...(hash ? { inserted_at_hash: hash } : {}),
    };
    // Reconcile the restored inner's snapshot_fingerprint to its freshly-
    // restored content. Without this the rebound instance keeps the STALE
    // fingerprint captured before the restore, so `bundleSnapshotModified`
    // (live vs stored) flips true and the canvas flashes a false MODIFIED
    // badge on a bundle that was just re-created to match the library.
    // Mirror of the inserted_at_hash sync above. ONLY restored inners are
    // reconciled (this branch) — a non-restored bundle returns early and
    // keeps its own fingerprint, so genuine drift still surfaces.
    return {
      ...rebound,
      snapshot_fingerprint: computeBundleFingerprint(rebound, newModules),
    };
  });

  return {
    rewrittenChildren,
    newModules,
    newBundles,
    restoredModuleCount: moduleMap.size,
    restoredBundleCount: innerBundleMap.size,
  };
}

/** Apply id rewrites to a single child entry. Two layers:
 *
 *   1. The child's OWN top-level `id` — bundle-typed children look up in
 *      `innerBundleMap`; module-typed children in `moduleMap`.
 *   2. References INSIDE the child's `payload` + `instance` that point at
 *      any restored module/inner-bundle — a constraint's
 *      `source_wildcard_id` / `target_wildcard_id`, or an `@{uuid}` ref in
 *      a wildcard/derivation value. Without (2), restoring a missing
 *      wildcard re-pointed its own child id but left a sibling
 *      constraint pointing at the dead uuid → the pushed bundle shipped a
 *      broken source/target (#2). The deep rewrite reuses `walkRemap`.
 *
 *  Returns a NEW object only when a rewrite fires; otherwise reuses the
 *  original reference to avoid churn for downstream diff consumers. */
function rewriteChildId(
  c: Record<string, unknown>,
  moduleMap: Map<string, string>,
  innerBundleMap: Map<string, string>,
  moduleHashMap?: ReadonlyMap<string, string>,
): Record<string, unknown> {
  let next: Record<string, unknown> = c;

  // (1) Own id.
  const id = typeof c.id === "string" ? c.id : "";
  if (id) {
    const newId = c.type === "bundle" ? innerBundleMap.get(id) : moduleMap.get(id);
    if (newId) next = { ...next, id: newId };

    // (1b) Sync the child snapshot's `payload_hash` to the restored library
    // entry's LIVE hash. `toChildSnapshot` froze the stale pre-cascade hash;
    // for a restored module whose refs were corrected (Phase 1 Pass-2) the
    // payload moved but the frozen hash didn't, so the pushed bundle would
    // ship a child whose payload ≠ its payload_hash → RE-INSERTING the bundle
    // shows spurious DRIFT against the live library entry. `moduleHashMap` is
    // keyed by OLD id and holds only restored modules (POST hash, overridden
    // by the corrective-update hash), so non-restored + bundle children are
    // left untouched.
    const freshHash = moduleHashMap?.get(id);
    if (freshHash) next = { ...next, payload_hash: freshHash };
  }

  // (2) Inner references (constraint source/target, @{} refs) → restored ids.
  const table: Record<string, string> = {};
  for (const [k, v] of moduleMap) table[k] = v;
  for (const [k, v] of innerBundleMap) table[k] = v;
  if (Object.keys(table).length > 0) {
    if (next.payload && typeof next.payload === "object") {
      next = { ...next, payload: walkRemap(next.payload, table) as Record<string, unknown> };
    }
    if (next.instance && typeof next.instance === "object") {
      next = { ...next, instance: walkRemap(next.instance, table) as Record<string, unknown> };
    }
  }

  return next;
}

/** Pre-scan to count what cascade would heal — used by the modal to
 *  decide whether to surface the "Restore N missing references" UI
 *  and to display the count breakdown. Same predicates + same range
 *  walk as `cascadeRestoreForBundle`'s Phase 1+2, no network calls. */
export interface CascadeRestoreScan {
  missingModuleCount: number;
  missingBundleCount: number;
  /** Names lifted from the missing items for UI listing — modules use
   *  `meta.name || type`, bundles use `name || "bundle"`. */
  missingModuleNames: string[];
  missingBundleNames: string[];
}

export function scanCascadeRestore(inputs: CascadeRestoreInputs): CascadeRestoreScan {
  const { outer, modules, bundles, isModuleMissing, isBundleMissing } = inputs;
  const moduleNames: string[] = [];
  for (let i = outer.start_idx; i <= outer.end_idx; i++) {
    const m = modules[i];
    if (!m || !isModuleMissing(m)) continue;
    moduleNames.push(pickModuleName(m));
  }
  const bundleNames: string[] = [];
  for (const inner of bundles) {
    if (inner.parent_uid !== outer._uid) continue;
    if (!isBundleMissing(inner)) continue;
    bundleNames.push(inner.name || "bundle");
  }
  return {
    missingModuleCount: moduleNames.length,
    missingBundleCount: bundleNames.length,
    missingModuleNames: moduleNames,
    missingBundleNames: bundleNames,
  };
}

/** Currently unused but kept exported for symmetry — callers that
 *  already have a child entry pre-built can reuse the rewrite helper
 *  for ad-hoc id swaps (e.g. import/export pipelines that need the
 *  same module-id and inner-bundle-id remapping). */
export { rewriteChildId, toChildSnapshot };
