import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  emptyBundleInstance, newModuleId, newRowUid,
  type BundleInstance, type ContextWidgetValue, type ModuleEntry,
} from "../../widgets/_shared";
import { pushToast } from "../shared/toast-store";
import { dragState, queueHandoff, pendingHandoffs, takeHandoffsFor } from "./drag-store";
import { resolveDropZone, type DropZone } from "./bundles/drop-zone";
import { applyDrop, type DropPayload } from "./bundles/drop";
import { buildCrossNodeBundleInsertion } from "./bundles/cross-node-nested";
import { snapBundleFingerprints } from "./bundles/bundle-fingerprint";
import {
  animateEnterBatch,
  captureFlipSnapshot,
  excludeFromFlipSnapshot,
  playFlipSnapshot,
  MOTION_FLIP_MS,
} from "./bundles/flip";
import type { WidgetState } from "./widget-state";

/**
 * ContextWidget drag-and-drop: hover/zone state, the drop indicator bar,
 * drop pulses, the same-node + cross-node drop paths and the source-side
 * cleanup (dragend + the handoff queue in `drag-store`).
 *
 * Call once from the widget's setup — it registers its own mount/unmount
 * listeners (window `dragend`, timer teardown, releasing a drag this node
 * started) and its watchers.
 */
export function useContextDrag(state: WidgetState, props: { readonly nodeId: number }) {
  const { value, commitModules, modulesContainer } = state;

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

  function clearDragHover() {
    if (dragOver.value === null) return;
    dragOver.value = null;
  }

  onMounted(() => {
    window.addEventListener("dragend", clearDragHover);
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
    const flipSnap = captureFlipSnapshot(modulesContainer.value);

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

  return {
    draggingModuleUid,
    recentDropUids,
    suppressMove,
    holdSuppressMove,
    isDropEndZone,
    rowGap,
    bundleHeaderGap,
    isBundleDropTarget,
    dropBarFor,
    pulseDelayFor,
    onDragStart,
    onBundleDragStart,
    onDragEnd,
    onListDragOver,
    onEmptyHeroDragOver,
    onEndDragOver,
    onContainerLeave,
    onDrop,
  };
}
