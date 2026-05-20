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

import type { ContextWidgetValue, ModuleEntry } from "../../../widgets/_shared";
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
  // No explicit container bounds check — the dragover listener already
  // gates by container, and in jsdom the container's getBoundingClientRect
  // defaults to zeros which would always reject the pointer.
  // jsdom + some headless environments don't implement
  // document.elementFromPoint — guard so the resolver gracefully falls
  // back to the top-level Y-walk instead of throwing.
  const efp = typeof document.elementFromPoint === "function"
    ? document.elementFromPoint.bind(document)
    : null;
  const hit = (efp ? efp(x, y) : null) as HTMLElement | null;
  const dragHasNested = computeDragHasNested(drag, value);

  // When `hit` resolves to a bundle ancestor, classify within it.
  // When `hit` is null or doesn't sit inside any bundle (e.g. jsdom
  // doesn't implement elementFromPoint reliably, or the pointer is on
  // an overlay), fall back to top-level Y-walk against the modules
  // container — that handles the loose-row case correctly and degrades
  // gracefully for nested cases (the body of a nested bundle still
  // contains rows whose data-module-idx the top-level walk can match
  // by Y).
  const bundleEl = hit?.closest?.(".wp-bundle") as HTMLElement | null;
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

  // 1) Header strip:
  //    - top half → sibling drop above the bundle (header.before)
  //    - bottom half (collapsed or empty bundle) → drop INTO the bundle
  //      (empty zone)
  //    - bottom half (open bundle with children) → drop INTO first slot
  //      (row.before of first child)
  const headerEl = bundleEl.querySelector<HTMLElement>("[data-bundle-header]");
  if (headerEl) {
    const hr = headerEl.getBoundingClientRect();
    if (y >= hr.top && y <= hr.bottom) {
      if (y < hr.top + hr.height / 2) {
        return { kind: "header", uid, pos: "before" };
      }
      // Bottom half: check whether the bundle has rendered children.
      const childrenContainer = bundleEl.querySelector<HTMLElement>(".wp-bundle-children");
      const firstRow = childrenContainer?.querySelector<HTMLElement>(
        ":scope > .wp-module[data-module-idx], :scope > .wp-bundle",
      );
      if (!firstRow) {
        if (dragHasNested) return { kind: "header", uid, pos: "after" };
        return { kind: "empty", uid };
      }
      // Open bundle: drop into first slot.
      if (firstRow.classList.contains("wp-bundle")) {
        const nestedUid = firstRow.dataset.bundleUid;
        if (nestedUid) {
          if (dragHasNested) return { kind: "header", uid, pos: "after" };
          return { kind: "header", uid: nestedUid, pos: "before" };
        }
      }
      const idxRaw = firstRow.dataset.moduleIdx;
      if (idxRaw !== undefined) {
        if (dragHasNested) return { kind: "header", uid, pos: "after" };
        return { kind: "row", containerUid: uid, insertIdx: Number(idxRaw), pos: "before" };
      }
      return { kind: "empty", uid };
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
  //
  // Skip the dragged bundle's frame from candidates — when the user
  // drags an inner bundle around inside its parent's body, the inner
  // shouldn't appear as a drop target (self-drop is a no-op + paints a
  // misleading indicator on the source row).
  const draggedBundleUid = drag?.kind === "bundle" ? drag.bundleUid : null;
  const directRows = Array.from(
    childrenEl.querySelectorAll<HTMLElement>(":scope > .wp-module[data-module-idx], :scope > .wp-bundle"),
  ).filter((el) => {
    if (!draggedBundleUid) return true;
    if (!el.classList.contains("wp-bundle")) return true;
    return el.dataset.bundleUid !== draggedBundleUid;
  });
  if (directRows.length === 0) {
    // Empty body OR only the dragged bundle lived here — treat as
    // empty target. Self-drop guard in applyDrop prevents the actual
    // no-op when the user lands; the indicator paints sensibly during
    // hover.
    if (dragHasNested) return { kind: "header", uid, pos: "after" };
    return { kind: "empty", uid };
  }

  // Find the row whose vertical midpoint is closest to y, picking
  // before/after by which half the pointer sits in. Bottom-half drops
  // canonicalize to "before next" so we paint a single gap line per
  // visual gap rather than two overlapping ones.
  for (let k = 0; k < directRows.length; k++) {
    const rowEl = directRows[k];
    const rr = rowEl.getBoundingClientRect();
    if (y < rr.top) {
      return classifyRowSlot(rowEl, uid, "before", dragHasNested);
    }
    if (y >= rr.top && y <= rr.bottom) {
      if (y < rr.top + rr.height / 2) {
        return classifyRowSlot(rowEl, uid, "before", dragHasNested);
      }
      const next = directRows[k + 1];
      if (next) return classifyRowSlot(next, uid, "before", dragHasNested);
      // Bottom-half of last row → drop after the last (no canonical
      // next slot inside this bundle).
      return classifyRowSlot(rowEl, uid, "after", dragHasNested);
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
  // Walk every module row + top-level bundle frame anywhere inside
  // the modules container. We can't restrict to "direct children of
  // .wp-modules" because in real DOM the bundle frame contains its
  // own children whose rects might overlap the pointer (bundle frames'
  // rects span the union of their header + body). Treating every row
  // as a candidate + reading its bundle ancestor for scope keeps the
  // walker robust in both real DOM and test-stubbed jsdom (where the
  // bundle frame's own rect may be unstubbed).
  const effective = Array.from(
    modulesContainer.querySelectorAll<HTMLElement>(
      ".wp-module[data-module-idx], .wp-bundle:not(.wp-bundle--nested)",
    ),
  );
  if (effective.length === 0) {
    // Defensive: in test envs where .wp-modules may not exist (e.g.
    // resolver called against a custom stub), fall back to broad
    // descendant search so geometry-based tests still resolve.
    const fallback = Array.from(
      modulesContainer.querySelectorAll<HTMLElement>(
        ".wp-module[data-module-idx], .wp-bundle:not(.wp-bundle--nested)",
      ),
    );
    if (fallback.length === 0) return { kind: "end" };
    return classifyAgainst(fallback, y, value, drag);
  }
  return classifyAgainst(effective, y, value, drag);
}

/** Inner walker used by `classifyTopLevel` — receives the candidate
 *  list pre-filtered to the current scope and matches the pointer Y
 *  against each candidate in DOM order. Factored out so the test
 *  fallback path can reuse identical zoning logic. */
function classifyAgainst(
  candidates: HTMLElement[],
  y: number,
  value: ContextWidgetValue,
  drag: DragPayload | null,
): DropZone {
  // Skip the dragged bundle's frame entirely (and any rows owned by
  // it — they move with it). isSelfHover catches the "drag bundle
  // onto its own frame" case; the broader skip prevents the resolver
  // from landing on the bundle's children when the bundle itself is
  // being dragged (those rows are about to disappear from this scope).
  const draggedBundleUid = drag?.kind === "bundle" ? drag.bundleUid : null;
  const filtered = candidates.filter((el) => {
    if (el.classList.contains("wp-bundle")) {
      const uid = el.dataset.bundleUid ?? "";
      if (isSelfHover(uid, drag)) return false;
      if (draggedBundleUid && uid === draggedBundleUid) return false;
      return true;
    }
    // Skip module rows whose bundle_origin matches the dragged bundle —
    // those rows belong to the bundle being dragged and disappear with
    // it after drop. Top-level rows (no bundle_origin) always pass.
    if (draggedBundleUid) {
      const idxRaw = el.dataset.moduleIdx;
      if (idxRaw !== undefined) {
        const m = value.modules[Number(idxRaw)] as ModuleEntry & { bundle_origin?: string } | undefined;
        if (m?.bundle_origin === draggedBundleUid) return false;
      }
    }
    return true;
  });
  if (filtered.length === 0) return { kind: "end" };

  for (let k = 0; k < filtered.length; k++) {
    const el = filtered[k];
    // For bundle frames, use the union of header + visible child rects
    // as the effective bounds — covers the case where the frame's own
    // rect is unstubbed in tests OR the frame's CSS box doesn't fully
    // wrap its layout (e.g. negative margins). For module rows, use
    // the row's own rect.
    const r = el.classList.contains("wp-bundle")
      ? effectiveBundleRect(el)
      : el.getBoundingClientRect();
    if (y < r.top) {
      return topLevelSlot(el, "before", value);
    }
    if (y >= r.top && y <= r.bottom) {
      // Bundle frame as a candidate — drill into it via
      // classifyWithinBundle so header/body/nested resolution stays in
      // a single place (also gives the jsdom fallback path the same
      // behavior the elementFromPoint path would produce).
      if (el.classList.contains("wp-bundle")) {
        const uid = el.dataset.bundleUid;
        if (uid) {
          const dragHasNested = computeDragHasNested(drag, value);
          return classifyWithinBundle(uid, el, y, value, drag, dragHasNested);
        }
      }
      // Regular module row: canonicalize bottom-half drops to "before
      // next" — keeps a single gap line per visual gap.
      if (y < r.top + r.height / 2) {
        return topLevelSlot(el, "before", value);
      }
      const next = filtered[k + 1];
      if (next) return topLevelSlot(next, "before", value);
      return { kind: "end" };
    }
  }
  // Past every candidate → end-of-list.
  return { kind: "end" };
}

/** Compute a bundle frame's effective bounding box as the union of its
 *  header + any visible child rows. The frame's own
 *  getBoundingClientRect may underreport (collapsed bundles, jsdom
 *  test stubs, CSS layout quirks) so a manual union is more reliable. */
function effectiveBundleRect(bundleEl: HTMLElement): { top: number; bottom: number; height: number } {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const headerEl = bundleEl.querySelector<HTMLElement>("[data-bundle-header]");
  if (headerEl) {
    const hr = headerEl.getBoundingClientRect();
    if (hr.height > 0 || hr.bottom !== hr.top) {
      top = Math.min(top, hr.top);
      bottom = Math.max(bottom, hr.bottom);
    }
  }
  const childRows = bundleEl.querySelectorAll<HTMLElement>(".wp-module[data-module-idx]");
  for (const row of childRows) {
    const rr = row.getBoundingClientRect();
    if (rr.height > 0 || rr.bottom !== rr.top) {
      top = Math.min(top, rr.top);
      bottom = Math.max(bottom, rr.bottom);
    }
  }
  if (!isFinite(top) || !isFinite(bottom)) {
    const r = bundleEl.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  }
  return { top, bottom, height: bottom - top };
}

/** Build a top-level zone for a candidate row or bundle frame.
 *
 *  When the candidate is a `.wp-module` row, also check if it sits
 *  inside a `.wp-bundle` ancestor — the fallback path (jsdom + broad
 *  selector) walks ALL rows regardless of nesting, so the row's true
 *  container has to be inferred from its DOM parent. Without this,
 *  modules inside a bundle would get `containerUid: null` (treated
 *  as top-level), losing the bundle stamp on drop.
 */
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
  // Detect bundle ancestry — row inside a bundle inherits its scope.
  const bundleAncestor = el.parentElement?.closest?.(".wp-bundle") as HTMLElement | null;
  const containerUid = bundleAncestor?.dataset.bundleUid ?? null;
  void value;
  return { kind: "row", containerUid, insertIdx, pos };
}
