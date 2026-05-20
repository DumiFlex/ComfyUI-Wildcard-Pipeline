/**
 * Container-scoped drop zones for the nested-aware drag system.
 *
 * Replaces the flat-list `bundle-slot` shape from drag.ts. Every zone
 * resolves a *target container* (top-level = null, or a bundle uid)
 * plus a position within that container. The container is the unit
 * that owns the drop:
 *
 *   - For module drops, `containerUid` becomes the new `bundle_origin`
 *     (or undefined when top-level).
 *   - For bundle drops, `containerUid` becomes the new `parent_uid`
 *     (or null when top-level).
 *
 * Pointer-to-zone resolution lives in `resolveDropZone()`.
 */

import type { ContextWidgetValue } from "../../../widgets/_shared";
import type { DragPayload } from "../drag-store";

/**
 * Discriminated union over the four drop kinds:
 *
 *   - `row`     — drop next to a sibling row inside `containerUid`'s
 *                 scope. `insertIdx` is the row's absolute index in
 *                 `modules[]`; `pos` picks above/below it.
 *   - `header`  — drop above (`pos:"before"`) or below (`pos:"after"`)
 *                 a bundle frame as a sibling at the bundle's parent
 *                 scope. Used when the pointer is over the bundle's
 *                 header strip (no children targeted).
 *   - `empty`   — drop into an empty bundle body. First child of that
 *                 bundle after the drop.
 *   - `end`     — drop at the very end of the top-level list. Only
 *                 fires when the pointer is past every top-level row.
 *
 * `null` means "no valid drop target right now" — used when the
 * pointer is outside the modules container entirely.
 */
export type DropZone =
  | { kind: "row"; containerUid: string | null; insertIdx: number; pos: "before" | "after" }
  | { kind: "header"; uid: string; pos: "before" | "after" }
  | { kind: "empty"; uid: string }
  | { kind: "end" }
  | null;

/** Resolves a pointer position to a drop zone, container-scoped.
 *
 *  Algorithm (top-down):
 *    1. Pointer outside the modules container → null.
 *    2. `document.elementFromPoint(x, y)` → starting element.
 *    3. Walk ancestors looking for the *innermost* `.wp-bundle`. If
 *       found, that bundle is the target container; classify within
 *       it. If none, fall through to top-level classification.
 *
 *  Tier-2 cap: when the drag is a bundle and the dragged bundle has
 *  nested children of its own, never resolve to `empty` or `row`
 *  inside another bundle — coerce to `{kind:"header", uid: containerUid,
 *  pos:"after"}` so the user gets a sibling drop instead of an illegal
 *  tier-3 nested drop. Indicator still paints; only the semantic
 *  changes.
 */
export function resolveDropZone(
  ev: DragEvent,
  modulesContainer: HTMLElement,
  value: ContextWidgetValue,
  drag: DragPayload | null,
): DropZone {
  const x = ev.clientX;
  const y = ev.clientY;
  const cr = modulesContainer.getBoundingClientRect();
  if (x < cr.left || x > cr.right || y < cr.top || y > cr.bottom) {
    return null;
  }
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!hit) return null;

  const bundleEl = hit.closest?.(".wp-bundle") as HTMLElement | null;
  const dragHasNested = computeDragHasNested(drag, value);

  if (bundleEl) {
    const uid = bundleEl.dataset.bundleUid;
    if (!uid) return null;
    return classifyWithinBundle(uid, bundleEl, y, value, drag, dragHasNested);
  }
  return classifyTopLevel(modulesContainer, y, value, drag);
}

/** Pre-checks whether the active drag is a nested-bearing bundle. Used
 *  by the tier-2 cap: only such a drag has its zones coerced to header
 *  drops when over another bundle. */
function computeDragHasNested(
  drag: DragPayload | null,
  value: ContextWidgetValue,
): boolean {
  if (!drag || drag.kind !== "bundle") return false;
  const bundles = value.bundles ?? [];
  return bundles.some((b) => b.parent_uid === drag.bundleUid);
}

/** Identifies whether the dragged bundle is the one we're hovering —
 *  the resolver should treat self-hover as "no-op", but we still want
 *  a zone shape so the indicator can stay parked sensibly. */
function isSelfHover(uid: string, drag: DragPayload | null): boolean {
  return drag?.kind === "bundle" && drag.bundleUid === uid;
}

/** Classify pointer position when inside a bundle frame. */
function classifyWithinBundle(
  uid: string,
  bundleEl: HTMLElement,
  y: number,
  value: ContextWidgetValue,
  drag: DragPayload | null,
  dragHasNested: boolean,
): DropZone {
  // Self-hover: no-op zone — bundle being dragged onto its own header.
  if (isSelfHover(uid, drag)) {
    return null;
  }

  // 1) Header strip — drop above/below the bundle as a sibling.
  const headerEl = bundleEl.querySelector<HTMLElement>("[data-bundle-header]");
  if (headerEl) {
    const hr = headerEl.getBoundingClientRect();
    if (y >= hr.top && y <= hr.bottom) {
      const pos: "before" | "after" = y < hr.top + hr.height / 2 ? "before" : "after";
      return { kind: "header", uid, pos };
    }
  }

  // 2) Children container — figure out which row or whitespace slot.
  const childrenEl = bundleEl.querySelector<HTMLElement>(".wp-bundle-children");
  const bundle = (value.bundles ?? []).find((b) => b._uid === uid);

  // No children rendered (collapsed bundle, empty bundle, or missing
  // children container) → fall back to header.after as a sensible
  // sibling slot.
  if (!childrenEl || !bundle) {
    return { kind: "header", uid, pos: "after" };
  }

  // Collect the direct child rows + nested bundle elements (whose
  // headers will be classified by the recursive call in normal
  // operation — but if the pointer is over the children container
  // background, we walk these to find the nearest slot). Only direct
  // children matter (the resolver already drilled into a nested bundle
  // by closest('.wp-bundle') returning the innermost ancestor).
  const directRows = Array.from(
    childrenEl.querySelectorAll<HTMLElement>(":scope > .wp-module[data-module-idx], :scope > .wp-bundle"),
  );
  if (directRows.length === 0) {
    // Empty body — drop becomes the first child.
    if (dragHasNested) return { kind: "header", uid, pos: "after" };
    return { kind: "empty", uid };
  }

  // Find the row whose vertical midpoint is closest to y, picking
  // before/after by which half the pointer sits in. Walking in order
  // is enough — children render top-to-bottom.
  for (const rowEl of directRows) {
    const rr = rowEl.getBoundingClientRect();
    if (y < rr.top) {
      // Above this row → drop before it.
      return classifyRowSlot(rowEl, uid, "before", dragHasNested);
    }
    if (y >= rr.top && y <= rr.bottom) {
      const pos: "before" | "after" = y < rr.top + rr.height / 2 ? "before" : "after";
      return classifyRowSlot(rowEl, uid, pos, dragHasNested);
    }
  }
  // Past every row → drop after the last.
  const last = directRows[directRows.length - 1];
  return classifyRowSlot(last, uid, "after", dragHasNested);
}

/** Builds a zone for a specific row inside a bundle's children. Handles
 *  the case where the row is itself a nested bundle (the slot is at the
 *  nested bundle's start_idx or end_idx in the parent's range). */
function classifyRowSlot(
  rowEl: HTMLElement,
  containerUid: string,
  pos: "before" | "after",
  dragHasNested: boolean,
): DropZone {
  // Tier-2 cap: nested-bearing bundle dragged into another bundle →
  // coerce to sibling drop on the parent (i.e. force the drop to land
  // adjacent to the container itself, not inside it).
  if (dragHasNested) {
    return { kind: "header", uid: containerUid, pos: "after" };
  }
  if (rowEl.classList.contains("wp-bundle")) {
    // A nested bundle row in the parent's scope — pointer just above/
    // below the nested frame. Use header.before/after on the nested
    // uid, so applyDrop puts the dragged thing adjacent to it in the
    // SAME container scope.
    const nestedUid = rowEl.dataset.bundleUid;
    if (nestedUid) {
      return { kind: "header", uid: nestedUid, pos };
    }
  }
  const idxRaw = rowEl.dataset.moduleIdx;
  if (idxRaw === undefined) {
    // Defensive: missing data attr — fall back to header.after of the
    // container so we don't drop at index 0 by accident.
    return { kind: "header", uid: containerUid, pos: "after" };
  }
  const insertIdx = Number(idxRaw);
  return { kind: "row", containerUid, insertIdx, pos };
}

/** Classify pointer position at top-level (no bundle ancestor). */
function classifyTopLevel(
  modulesContainer: HTMLElement,
  y: number,
  value: ContextWidgetValue,
  drag: DragPayload | null,
): DropZone {
  // Walk every direct row + every top-level bundle frame in document
  // order. Each candidate is either a `.wp-module[data-module-idx]`
  // (top-level loose module) OR a `.wp-bundle` whose parent_uid is
  // null (top-level bundle). Top-level bundles render as a single row
  // here — the resolver doesn't drill into them because the caller
  // already established we're at top level (closest .wp-bundle was
  // null from the element under the pointer).
  const candidates = Array.from(
    modulesContainer.querySelectorAll<HTMLElement>(
      ":scope > .wp-module[data-module-idx], :scope .wp-bundle:not(.wp-bundle--nested)",
    ),
  );
  // Some renderings wrap rows in additional wrappers (FLIP, lists,
  // etc.) — broaden the search to any descendant matching the
  // candidate selectors when the direct-child scope returns empty.
  const effective = candidates.length > 0
    ? candidates
    : Array.from(modulesContainer.querySelectorAll<HTMLElement>(
        ".wp-module[data-module-idx], .wp-bundle:not(.wp-bundle--nested)",
      ));
  if (effective.length === 0) return { kind: "end" };
  // Self-hover skip for bundle drags — drop on the bundle being dragged
  // would be a no-op; let the resolver still return a zone for the
  // nearest non-self candidate.
  const filtered = effective.filter((el) => {
    if (!el.classList.contains("wp-bundle")) return true;
    return !isSelfHover(el.dataset.bundleUid ?? "", drag);
  });
  if (filtered.length === 0) return { kind: "end" };

  for (const el of filtered) {
    const r = el.getBoundingClientRect();
    if (y < r.top) {
      return topLevelSlot(el, "before", value);
    }
    if (y >= r.top && y <= r.bottom) {
      const pos: "before" | "after" = y < r.top + r.height / 2 ? "before" : "after";
      return topLevelSlot(el, pos, value);
    }
  }
  // Past every candidate → end-of-list.
  return { kind: "end" };
}

/** Build a top-level zone for a candidate row or bundle frame. */
function topLevelSlot(
  el: HTMLElement,
  pos: "before" | "after",
  value: ContextWidgetValue,
): DropZone {
  if (el.classList.contains("wp-bundle")) {
    const uid = el.dataset.bundleUid;
    if (!uid) return { kind: "end" };
    return { kind: "header", uid, pos };
  }
  const idxRaw = el.dataset.moduleIdx;
  if (idxRaw === undefined) return { kind: "end" };
  const insertIdx = Number(idxRaw);
  // Top-level rows: containerUid is null.
  void value; // reserved for future use (e.g., filter by bundle_origin)
  return { kind: "row", containerUid: null, insertIdx, pos };
}
