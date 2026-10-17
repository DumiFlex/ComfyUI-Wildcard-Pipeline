import { nextTick, type Ref } from "vue";
import { applyRelink } from "../../manager/import-export/relink-apply";
import { newRowUid, type ModuleEntry } from "../../widgets/_shared";
import { getCollapseMode, getCollapsedByDefault, getNewModuleDisabled } from "../../extension/settings";
import { currentFrame } from "../context-loop/frame-cursor";
import { pushToast } from "../shared/toast-store";
import { FRAME_OVERRIDABLE_FIELDS } from "./editors/_shell";
import { nextBindingSuffix } from "./duplicates/binding-suffix";
import {
  applyFrameEdit,
  clearFrameOverride,
  dropRedundantFrameLockNulls,
  toggleFrameEnabled,
  toggleFrameLock,
} from "./frame-overrides";
import {
  animateEnterBatch,
  captureFlipSnapshot,
  playFlipSnapshot,
  withEnterAnimation,
  withLeaveAnimation,
} from "./bundles/flip";
import { collectInContextBindings, extractPrimaryBinding, isHoldable } from "./module-state";
import type { WidgetState } from "./widget-state";
import type { ModuleRowCtx } from "./module-row-ctx";

/** Props the row operations read (seed readers for the lock fallback). */
export interface ModuleOpsProps {
  readonly lastUsedSeedReader?: (moduleId?: string) => number | null;
  readonly frameSeedReader?: (frame: number) => number | null;
}

/**
 * Per-row module operations for the Context canvas: library embed (picker
 * add), remove / duplicate / move with Undo toasts, enable / collapse /
 * hold / lock / internal toggles (frame-aware where the row is), the
 * toolbar bulk actions, keyboard shortcuts and the edit-modal save path.
 *
 * `showPicker` / `editingIdx` stay owned by the widget (its template
 * writes them); the ops close the picker and target the edited row.
 */
export function createModuleOps(
  state: WidgetState,
  props: ModuleOpsProps,
  showPicker: Ref<boolean>,
  editingIdx: Ref<number | null>,
) {
  const { value, commitModules, modulesContainer } = state;

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
    const k = currentFrame.value;
    if (k != null) {
      // Prefer the seed THIS module actually rolls at frame #k (computed from the
      // upstream Loop), so the lock pins the frame's real seed — not the single
      // representative seed a run surfaced. Falls back to last-used / stored when
      // no Loop drives the node.
      const frameSeed = props.frameSeedReader?.(k);
      const lastUsed = props.lastUsedSeedReader?.(m._uid ?? m.id);
      const fallback = typeof frameSeed === "number" ? frameSeed
        : typeof lastUsed === "number" ? lastUsed
        : (typeof m.instance?._ui?.last_locked_seed === "number" ? m.instance._ui.last_locked_seed : 0);
      const list = [...value.value.modules];
      list[idx] = toggleFrameLock(m, k, fallback);
      commitModules(list);
      return;
    }
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
    // Unlocking base makes any frame `locked_seed: null` override redundant —
    // sweep it so the row stops showing a stale "override #k". No-op on lock.
    list[idx] = dropRedundantFrameLockNulls({ ...m, instance: nextInst });
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
    const flipSnap = captureFlipSnapshot(modulesContainer.value);
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
    const flipSnap = captureFlipSnapshot(modulesContainer.value);
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
    const k = currentFrame.value;
    if (k != null) {
      // Frame-active: flip the module's per-frame enable override (symmetric —
      // base-off turns ON for this frame, base-on turns OFF). Pure logic lives in
      // frame-overrides.toggleFrameEnabled; base `enabled` is never touched here.
      const m = value.value.modules[idx];
      if (!m) return;
      const list = [...value.value.modules];
      list[idx] = toggleFrameEnabled(m, k);
      commitModules(list);
      return;
    }
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

  // Quick "Hold across run" toggle from the row context menu — flips base
  // `instance.seed_scope` between hold/vary without opening the editor
  // (the 4-click → 2-click ask). Base-level only: when a loop edit-frame
  // is active, hold applies to every frame, so we no-op here exactly as
  // the RuntimeSection disables its toggle. Caller gates on isHoldable;
  // re-checked here so a stray call can't stamp seed_scope on a kind
  // (constraint/derivation) whose handler ignores it.
  function toggleHold(idx: number): void {
    if (currentFrame.value != null) return;
    const target = value.value.modules[idx];
    if (!target || !isHoldable(target)) return;
    const held = target.instance?.seed_scope === "hold";
    // Annotate so the literal doesn't widen to `string` in the object
    // literal — instance.seed_scope is the "vary" | "hold" union.
    const next: "vary" | "hold" = held ? "vary" : "hold";
    const list = value.value.modules.map((m, i) =>
      i === idx
        ? { ...m, instance: { ...(m.instance ?? {}), seed_scope: next } }
        : m,
    );
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

  function saveEditedModule(updated: ModuleEntry & { _originalId?: string; _relinkFrom?: string }) {
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
    // `_relinkFrom` (the OLD id) is set only on the re-link path — after the
    // row is committed with its new id, walk the whole list so sibling @{}
    // refs + constraint source/target follow. Captured before we strip markers.
    const relinkFrom = updated._relinkFrom;
    const cleaned: ModuleEntry = { ...updated };
    delete (cleaned as { _originalId?: string })._originalId;
    delete (cleaned as { _relinkFrom?: string })._relinkFrom;
    const list = [...value.value.modules];
    const k = currentFrame.value;
    if (k == null) {
      list[targetIdx] = cleaned;                                   // base edit — unchanged behavior
    } else {
      const baseModule = value.value.modules[targetIdx];           // base: payload + base instance intact
      // base payload + base instance preserved; the frame's override = the instance delta (replace, not merge)
      list[targetIdx] = applyFrameEdit(
        baseModule, cleaned, k, FRAME_OVERRIDABLE_FIELDS[baseModule.type] ?? [],
      );
    }
    // A base-unlock (here via the modal, or via the row toggle) makes any frame
    // `locked_seed: null` override redundant — sweep it so the row stops showing
    // a stale "override #k". No-op while the base stays locked.
    list[targetIdx] = dropRedundantFrameLockNulls(list[targetIdx]);
    commitModules(list);
    if (relinkFrom && relinkFrom !== updated.id) {
      // The re-linked row already carries its new id (list[targetIdx]); walk
      // EVERY module so sibling nested @{} refs + constraint source/target that
      // pointed at the old uuid follow to the library uuid. applyRelink leaves
      // the already-swapped row's id alone (its id !== relinkFrom).
      const remapped = applyRelink(
        value.value.modules as unknown as Record<string, unknown>[],
        { oldId: relinkFrom, newId: updated.id, newPayloadHash: updated.payload_hash ?? "" },
      ) as unknown as ModuleEntry[];
      commitModules(remapped);
    }
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

  /** Revert the currently-edited module's frame-#k override back to the
   *  base instance (i.e. remove the iteration_overrides[k] entry entirely).
   *  Called from the frame banner's "Revert to base" button in ModuleEditModal. */
  function revertEditingFrame(): void {
    const idx = editingIdx.value;
    const k = currentFrame.value;
    if (idx == null || k == null) return;
    const list = [...value.value.modules];
    list[idx] = clearFrameOverride(value.value.modules[idx], k);
    commitModules(list);
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

  return {
    onPickerAdd,
    removeModule,
    duplicateModule,
    moveToEdge,
    toggleEnabled,
    toggleCollapsed,
    toggleHold,
    collapseAll,
    expandAll,
    toggleAllEnabled,
    openEditModal,
    saveEditedModule,
    revertEditingFrame,
    /** Row-level members of the ModuleRow provide context. */
    rowCtx: {
      toggleCollapsed, toggleEnabled, removeModule,
      toggleLockOnCard, toggleInternalOnCard, onCardKeydown,
    } satisfies Partial<ModuleRowCtx>,
  };
}
