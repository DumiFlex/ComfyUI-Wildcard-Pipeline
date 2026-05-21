/**
 * Unified 1-zone drop resolver for the nested-aware drag system.
 *
 * Every drop resolves to a single shape: a `slot` between siblings in
 * a target container. The container is identified by its uid (top-level
 * = null, or a bundle uid); the slot is identified by `insertIdx` — the
 * absolute index in `modules[]` where the dropped item would land.
 *
 * No `header`, `empty`, `row` or `end` discriminants — those were
 * collapsed into the single slot model. The single algorithm is:
 *
 *   1. Walk up from `document.elementFromPoint(x, y)`.
 *   2. Skip the dragged bundle's own frame + body and every bundle in
 *      its moving range (parent_uid descendants).
 *   3. Tier-2 cap: when dragging a BUNDLE, also skip any nested bundle's
 *      body (bundles whose parent_uid != null) — dropping a bundle into
 *      a nested body would create tier-3 nesting. The walk continues
 *      until a top-level container or non-nested bundle body is reached.
 *   4. First non-skipped container found → classify a slot inside it via
 *      Y-midpoint walk over its direct children.
 *
 * The dropped row/bundle keeps its existing identity; only its position
 * (and bundle_origin / parent_uid stamp) change at drop time. See
 * `drop.ts:applyDrop` for the mutation.
 */

import type { ContextWidgetValue, ModuleEntry } from "../../../widgets/_shared";
import type { DragPayload } from "../drag-store";

/**
 * Single zone shape: a slot at `insertIdx` inside container scope.
 *
 *   - `containerUid: null` → top-level list (the `.wp-modules` container).
 *   - `containerUid: <uid>` → that bundle's `.wp-bundle-children` body.
 *
 * `insertIdx` is the absolute module index where the drop would land
 * (consistent with the resolver's `value.modules` reference frame).
 */
export type DropZone =
  | { kind: "slot"; containerUid: string | null; insertIdx: number }
  | null;

/** Bundle uids that move with the dragged bundle (self + descendants
 *  via parent_uid). The walk-up skips frames/bodies for these so a
 *  bundle drag never lands "inside itself" or one of its children. */
function collectMovingBundleUids(
  draggedUid: string,
  bundles: ReadonlyArray<{ _uid: string; parent_uid?: string | null }>,
): Set<string> {
  const out = new Set<string>([draggedUid]);
  for (let i = 0; i < 8; i++) {
    let grew = false;
    for (const b of bundles) {
      if (!out.has(b._uid) && b.parent_uid && out.has(b.parent_uid)) {
        out.add(b._uid);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return out;
}

/** Resolves a pointer position to a drop zone.
 *
 *  jsdom + headless environments don't implement elementFromPoint —
 *  the fallback resolves against the modulesContainer's top-level
 *  scope using a Y-walk so tests + degraded environments still produce
 *  a sensible slot (the dragover listener already gates by container).
 */
export function resolveDropZone(
  ev: DragEvent,
  modulesContainer: HTMLElement,
  value: ContextWidgetValue,
  drag: DragPayload | null,
): DropZone {
  const x = ev.clientX;
  const y = ev.clientY;
  const efp =
    typeof document.elementFromPoint === "function"
      ? document.elementFromPoint.bind(document)
      : null;
  const hit = (efp ? efp(x, y) : null) as HTMLElement | null;
  const moving =
    drag?.kind === "bundle"
      ? collectMovingBundleUids(drag.bundleUid, value.bundles ?? [])
      : new Set<string>();

  // Walk up from the pointer hit. Skip frames + bodies of bundles in
  // the moving range, and (for bundle drags) skip nested-bundle bodies
  // to enforce the tier-2 cap.
  let el: HTMLElement | null = hit;
  while (el && el !== document.body) {
    if (
      el.classList?.contains("wp-bundle") &&
      el.dataset.bundleUid &&
      moving.has(el.dataset.bundleUid)
    ) {
      el = el.parentElement;
      continue;
    }
    if (el.classList?.contains("wp-bundle-children")) {
      const parentBundle = el.parentElement;
      const pbUid = parentBundle?.dataset?.bundleUid ?? null;
      // Skip the dragged bundle's own body (moving range).
      if (
        parentBundle?.classList.contains("wp-bundle") &&
        pbUid &&
        moving.has(pbUid)
      ) {
        el = parentBundle.parentElement;
        continue;
      }
      // Tier-2 cap: dragging a bundle into a nested bundle's body
      // would create tier-3 nesting. Skip — resolve at the outer scope.
      if (drag?.kind === "bundle" && parentBundle?.classList.contains("wp-bundle")) {
        const pb = (value.bundles ?? []).find((b) => b._uid === pbUid);
        if (pb && typeof pb.parent_uid === "string" && pb.parent_uid) {
          el = parentBundle.parentElement;
          continue;
        }
      }
      return resolveWithin(el, y, pbUid, value, drag, moving);
    }
    if (el.classList?.contains("wp-modules")) {
      return resolveWithin(el, y, null, value, drag, moving);
    }
    el = el.parentElement;
  }

  // Fallback: walk-up didn't find a container (jsdom, EFP returns
  // overlay, etc.). Use modulesContainer's top-level scope so tests +
  // degraded environments still produce a slot.
  const top =
    modulesContainer.querySelector<HTMLElement>(":scope > .wp-modules") ??
    modulesContainer.querySelector<HTMLElement>(".wp-modules") ??
    modulesContainer;
  return resolveWithin(top, y, null, value, drag, moving);
}

/** Walks a container's direct children by Y midpoint and returns a
 *  slot zone. Keeps the dragged bundle in the candidate list so the
 *  indicator follows the pointer naturally near its current position —
 *  the walk-up already escalated past the dragged frame when the pointer
 *  was INSIDE it.
 *
 *  Drill-in: when a candidate is a bundle frame and the pointer Y lies
 *  inside the frame's rect, descend into the bundle's body and resolve
 *  there. This covers two cases:
 *    - jsdom / fallback path where EFP didn't walk us into the body
 *    - degenerate hit-test where EFP landed on the bundle frame itself
 *  Subject to the moving-set + tier-2 cap so the drill matches the
 *  semantics of the EFP-driven walk-up.
 */
function resolveWithin(
  container: HTMLElement,
  y: number,
  containerUid: string | null,
  value: ContextWidgetValue,
  drag: DragPayload | null,
  moving: Set<string>,
): DropZone {
  const kids = Array.from(
    container.querySelectorAll<HTMLElement>(
      ":scope > .wp-module[data-module-idx], :scope > .wp-bundle",
    ),
  );
  if (kids.length === 0) {
    return { kind: "slot", containerUid, insertIdx: 0 };
  }
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    const r = k.getBoundingClientRect();
    // Drill into bundles whose rect contains the pointer Y.
    if (k.classList.contains("wp-bundle") && y >= r.top && y <= r.bottom && r.height > 0) {
      const uid = k.dataset.bundleUid;
      if (uid && !moving.has(uid)) {
        const b = (value.bundles ?? []).find((bb) => bb._uid === uid);
        const tierCap =
          drag?.kind === "bundle" && b && typeof b.parent_uid === "string" && b.parent_uid;
        if (!tierCap) {
          const body = k.querySelector<HTMLElement>(":scope > .wp-bundle-children");
          if (body) return resolveWithin(body, y, uid, value, drag, moving);
        }
      }
    }
    const mid = r.top + r.height / 2;
    if (y < mid) {
      return { kind: "slot", containerUid, insertIdx: startIdxOf(k, value) };
    }
  }
  const last = kids[kids.length - 1];
  return { kind: "slot", containerUid, insertIdx: endIdxOf(last, value) + 1 };
}

/** Lowest module idx anchored by an element. For module rows → its own
 *  `data-module-idx`. For bundle frames → the bundle's `start_idx` (read
 *  from value.bundles via the dataset uid). DOM-derived because the
 *  resolver runs in pure walk-up + Y-midpoint mode and shouldn't carry
 *  index math through callers. */
function startIdxOf(el: HTMLElement, value: ContextWidgetValue): number {
  if (el.classList.contains("wp-module")) {
    const idxRaw = el.dataset.moduleIdx;
    return idxRaw === undefined ? -1 : Number(idxRaw);
  }
  if (el.classList.contains("wp-bundle")) {
    const uid = el.dataset.bundleUid;
    const b = (value.bundles ?? []).find((bb) => bb._uid === uid);
    return b ? b.start_idx : -1;
  }
  return -1;
}

/** Highest module idx anchored by an element. */
function endIdxOf(el: HTMLElement, value: ContextWidgetValue): number {
  if (el.classList.contains("wp-module")) {
    const idxRaw = el.dataset.moduleIdx;
    return idxRaw === undefined ? -1 : Number(idxRaw);
  }
  if (el.classList.contains("wp-bundle")) {
    const uid = el.dataset.bundleUid;
    const b = (value.bundles ?? []).find((bb) => bb._uid === uid);
    return b ? b.end_idx : -1;
  }
  return -1;
}

// Re-exported so call sites importing this type from drag.ts still
// resolve correctly during the migration.
export type { ModuleEntry };
