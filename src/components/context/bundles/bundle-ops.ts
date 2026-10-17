import { nextTick, ref } from "vue";
import { ApiError, api } from "../../../manager/api/client";
import {
  emptyBundleInstance, newRowUid,
  type BundleInstance, type ModuleEntry,
} from "../../../widgets/_shared";
import { getBundleCollapsedByDefault, getConfirmDestructiveBundle } from "../../../extension/settings";
import { pushToast } from "../../shared/toast-store";
import { buildBundleInsertion, type BundleLibraryEntry } from "./insert";
import { toChildSnapshot } from "./save";
import { snapBundleFingerprints } from "./bundle-fingerprint";
import {
  animateEnterBatch,
  captureFlipSnapshot,
  flashRows,
  playFlipSnapshot,
  withLeaveAnimation,
} from "./flip";
import type { WidgetState } from "../widget-state";
import type { BundleFrameCtx } from "./bundle-frame-ctx";

/**
 * Whole-bundle operations on a Context canvas: insert from the library,
 * collapse / enable, remove / detach / duplicate (each with a composable
 * delta-Undo toast), reset to the library snapshot (whole bundle or one
 * child), wrap a row into a new library bundle — plus the themed confirm
 * gate the destructive ones go through (`pendingConfirm` drives the
 * widget's ConfirmDialog).
 *
 * `holdSuppressMove` comes from the drag composable: it snaps the list's
 * FLIP/leave transitions off while a bundle frame vanishes.
 */
export function createBundleOps(state: WidgetState, holdSuppressMove: () => void) {
  const { value, commitModules, modulesContainer } = state;

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

  return {
    pendingConfirm,
    onPickBundle,
    toggleBundleCollapsed,
    toggleBundleEnabled,
    removeBundle,
    detachBundle,
    duplicateBundle,
    resetBundleToLibrary,
    resetChildToBundleSnapshot,
    wrapIntoNewBundle,
    /** Bundle-op members of the BundleFrame provide context. */
    frameCtx: {
      toggleBundleCollapsed, toggleBundleEnabled, removeBundle,
    } satisfies Partial<BundleFrameCtx>,
  };
}
