import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { BundleInstance, ModuleEntry, ContextWidgetValue } from "../../../widgets/_shared";
import type { DragPayload } from "../drag-store";
import { resolveDropZone } from "./drop-zone";

// ─────────────────────────────────────────────────────────────────────
// Helpers: build a controllable DOM scene that mirrors the live
// ContextWidget rendering — `.wp-modules` top-level container with rows
// + `.wp-bundle` wrappers; each bundle has a `.wp-bundle-children` body
// holding its rows + any nested bundle frames. Stubbed rects give the
// resolver deterministic Y-midpoint math.

interface RowSpec {
  idx: number;
  top: number;
  bottom: number;
}
interface BundleSpec {
  uid: string;
  parentUid?: string | null;
  top: number;
  bottom: number;
  header: { top: number; bottom: number };
  childrenTop?: number;
  childrenBottom?: number;
  rows: RowSpec[];
  nested?: BundleSpec[];
}

function stubRect(el: HTMLElement, r: { top: number; bottom: number; left?: number; right?: number }) {
  const left = r.left ?? 0;
  const right = r.right ?? 600;
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      top: r.top, bottom: r.bottom, left, right,
      width: right - left, height: r.bottom - r.top,
      x: left, y: r.top, toJSON() {},
    } as DOMRect),
  });
}

function makeBundleEl(spec: BundleSpec): HTMLElement {
  const el = document.createElement("div");
  el.className = spec.parentUid ? "wp-bundle wp-bundle--nested" : "wp-bundle";
  el.dataset.bundleUid = spec.uid;
  stubRect(el, { top: spec.top, bottom: spec.bottom });

  const header = document.createElement("div");
  header.className = "wp-bundle-header";
  header.dataset.bundleHeader = "";
  stubRect(header, spec.header);
  el.appendChild(header);

  const children = document.createElement("div");
  children.className = "wp-bundle-children";
  stubRect(children, {
    top: spec.childrenTop ?? spec.header.bottom,
    bottom: spec.childrenBottom ?? spec.bottom,
  });
  el.appendChild(children);

  for (const r of spec.rows) {
    const row = document.createElement("div");
    row.className = "wp-module";
    row.dataset.moduleIdx = String(r.idx);
    stubRect(row, { top: r.top, bottom: r.bottom });
    children.appendChild(row);
  }
  for (const inner of spec.nested ?? []) {
    children.appendChild(makeBundleEl(inner));
  }
  return el;
}

function buildScene(opts: {
  containerTop?: number;
  containerBottom?: number;
  topRows?: RowSpec[];
  bundles?: BundleSpec[];
}): HTMLElement {
  // Real ContextWidget DOM: modulesContainer (`.wp-modules-frame`)
  // wraps the slot container `.wp-modules`. Tests mount both so the
  // resolver's fallback path (`:scope > .wp-modules`) is exercised.
  const frame = document.createElement("div");
  frame.className = "wp-modules-frame";
  stubRect(frame, {
    top: opts.containerTop ?? 0,
    bottom: opts.containerBottom ?? 1000,
  });
  const container = document.createElement("div");
  container.className = "wp-modules";
  stubRect(container, {
    top: opts.containerTop ?? 0,
    bottom: opts.containerBottom ?? 1000,
  });
  frame.appendChild(container);
  for (const r of opts.topRows ?? []) {
    const row = document.createElement("div");
    row.className = "wp-module";
    row.dataset.moduleIdx = String(r.idx);
    stubRect(row, { top: r.top, bottom: r.bottom });
    container.appendChild(row);
  }
  for (const b of opts.bundles ?? []) {
    container.appendChild(makeBundleEl(b));
  }
  document.body.appendChild(frame);
  return frame;
}

function dragEvent(x: number, y: number): DragEvent {
  return { clientX: x, clientY: y } as unknown as DragEvent;
}

function moduleDrag(idx = 0): DragPayload {
  return {
    kind: "module",
    sourceNodeId: 1,
    module: { id: "m" } as ModuleEntry,
    sourceIdx: idx,
    sourceBundleUid: null,
  };
}

function bundleDrag(uid: string, startIdx = 0, endIdx = 0): DragPayload {
  return {
    kind: "bundle",
    sourceNodeId: 1,
    bundleUid: uid,
    sourceStartIdx: startIdx,
    sourceEndIdx: endIdx,
    libraryId: "lib",
    bundleName: "drag",
    bundleColor: null,
    bundleCollapsed: false,
    bundleEnabled: true,
    children: [],
    innerInstances: [],
  };
}

function makeBundleInstance(
  uid: string,
  parent_uid: string | null = null,
  start_idx = 0,
  end_idx = 0,
): BundleInstance {
  return {
    _uid: uid, library_id: "lib", start_idx, end_idx,
    enabled: true, collapsed: false, inserted_at_hash: "h",
    name: "B", color: null, parent_uid,
  };
}

let originalEFP: typeof document.elementFromPoint | undefined;
beforeEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  originalEFP = document.elementFromPoint;
});
afterEach(() => {
  if (originalEFP === undefined) {
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  } else {
    (document as unknown as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint = originalEFP;
  }
});

function setPointerHit(el: HTMLElement | null) {
  (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => el;
}

// ─────────────────────────────────────────────────────────────────────

describe("resolveDropZone — top-level", () => {
  it("empty container + pointer anywhere → slot at top-level idx 0", () => {
    const frame = buildScene({});
    setPointerHit(null);
    const ev = dragEvent(-10, -10);
    const value: ContextWidgetValue = { version: 1, modules: [], bundles: [] };
    expect(resolveDropZone(ev, frame, value, null)).toEqual({
      kind: "slot", containerUid: null, insertIdx: 0,
    });
  });

  it("falls back to top-level Y-walk when elementFromPoint returns null", () => {
    const frame = buildScene({
      topRows: [{ idx: 0, top: 100, bottom: 140 }],
    });
    setPointerHit(null);
    const ev = dragEvent(50, 110);
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry], bundles: [],
    };
    // Pointer in top-half of row 0 → slot before row 0.
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: null, insertIdx: 0,
    });
  });

  it("pointer in top-half of a top-level row → slot at that row's idx", () => {
    const frame = buildScene({
      topRows: [{ idx: 0, top: 100, bottom: 140 }],
    });
    const row = frame.querySelector(".wp-module")!;
    setPointerHit(row as HTMLElement);
    const ev = dragEvent(50, 110);
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry], bundles: [],
    };
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: null, insertIdx: 0,
    });
  });

  it("pointer in bottom-half of the LAST top-level row → slot at end", () => {
    const frame = buildScene({
      topRows: [{ idx: 0, top: 100, bottom: 140 }],
    });
    const row = frame.querySelector(".wp-module")!;
    setPointerHit(row as HTMLElement);
    const ev = dragEvent(50, 135);
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry], bundles: [],
    };
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: null, insertIdx: 1,
    });
  });

  it("pointer in bottom-half of a non-last row → slot at next row's idx", () => {
    const frame = buildScene({
      topRows: [
        { idx: 0, top: 100, bottom: 140 },
        { idx: 1, top: 140, bottom: 180 },
      ],
    });
    const firstRow = frame.querySelector(".wp-module")!;
    setPointerHit(firstRow as HTMLElement);
    const ev = dragEvent(50, 135); // bottom-half of row 0
    const value: ContextWidgetValue = {
      version: 1,
      modules: [{ id: "a" } as ModuleEntry, { id: "b" } as ModuleEntry],
      bundles: [],
    };
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: null, insertIdx: 1,
    });
  });

  it("pointer past every top-level candidate → slot at modules.length", () => {
    const frame = buildScene({
      topRows: [{ idx: 0, top: 100, bottom: 140 }],
    });
    setPointerHit(frame);
    const ev = dragEvent(50, 500);
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry], bundles: [],
    };
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: null, insertIdx: 1,
    });
  });
});

describe("resolveDropZone — inside a bundle", () => {
  it("pointer over child row in a bundle → slot in bundle scope", () => {
    const frame = buildScene({
      bundles: [{
        uid: "B1", top: 100, bottom: 300,
        header: { top: 100, bottom: 140 },
        rows: [{ idx: 5, top: 150, bottom: 200 }],
      }],
    });
    const row = frame.querySelector(".wp-bundle .wp-module")!;
    setPointerHit(row as HTMLElement);
    const ev = dragEvent(50, 160);
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [makeBundleInstance("B1", null, 5, 5)],
    };
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: "B1", insertIdx: 5,
    });
  });

  it("pointer in bottom-half of bundle's last row → slot after last (end of bundle)", () => {
    const frame = buildScene({
      bundles: [{
        uid: "B1", top: 100, bottom: 300,
        header: { top: 100, bottom: 140 },
        rows: [{ idx: 5, top: 150, bottom: 200 }],
      }],
    });
    const row = frame.querySelector(".wp-bundle .wp-module")!;
    setPointerHit(row as HTMLElement);
    const ev = dragEvent(50, 190); // bottom-half of [150..200]
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [makeBundleInstance("B1", null, 5, 5)],
    };
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: "B1", insertIdx: 6,
    });
  });

  it("nested bundle: pointer in inner's row → slot in inner scope (innermost wins)", () => {
    const frame = buildScene({
      bundles: [{
        uid: "outer", top: 50, bottom: 500,
        header: { top: 50, bottom: 90 },
        childrenTop: 90, childrenBottom: 500,
        rows: [],
        nested: [{
          uid: "inner", parentUid: "outer",
          top: 100, bottom: 400,
          header: { top: 100, bottom: 140 },
          childrenTop: 140, childrenBottom: 400,
          rows: [{ idx: 2, top: 150, bottom: 200 }],
        }],
      }],
    });
    const innerRow = frame.querySelector(".wp-bundle--nested .wp-module")!;
    setPointerHit(innerRow as HTMLElement);
    const ev = dragEvent(50, 160);
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [
        makeBundleInstance("outer", null, 2, 2),
        makeBundleInstance("inner", "outer", 2, 2),
      ],
    };
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: "inner", insertIdx: 2,
    });
  });
});

describe("resolveDropZone — tier-2 cap", () => {
  it("bundle drag over a NESTED bundle's body → resolves at outer scope (no tier-3)", () => {
    // Outer wraps inner; pointer drops inside inner's body. Bundle drag
    // should bubble up past inner and land at outer scope.
    const frame = buildScene({
      bundles: [{
        uid: "outer", top: 50, bottom: 500,
        header: { top: 50, bottom: 90 },
        childrenTop: 90, childrenBottom: 500,
        rows: [],
        nested: [{
          uid: "inner", parentUid: "outer",
          top: 100, bottom: 400,
          header: { top: 100, bottom: 140 },
          childrenTop: 140, childrenBottom: 400,
          rows: [{ idx: 2, top: 150, bottom: 200 }],
        }],
      }],
    });
    const innerRow = frame.querySelector(".wp-bundle--nested .wp-module")!;
    setPointerHit(innerRow as HTMLElement);
    const ev = dragEvent(50, 160);
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [
        makeBundleInstance("outer", null, 2, 2),
        makeBundleInstance("inner", "outer", 2, 2),
      ],
    };
    // Dragged bundle "Loose" is at top-level; tier-2 cap rejects drop
    // into inner's body and walks up to outer's body → slot in outer
    // before the inner bundle's start_idx (2).
    expect(resolveDropZone(ev, frame, value, bundleDrag("Loose", 9, 9))).toEqual({
      kind: "slot", containerUid: "outer", insertIdx: 2,
    });
  });

  it("module drag over a nested bundle's body → still resolves inside inner (no tier-2 cap for module drags)", () => {
    const frame = buildScene({
      bundles: [{
        uid: "outer", top: 50, bottom: 500,
        header: { top: 50, bottom: 90 },
        childrenTop: 90, childrenBottom: 500,
        rows: [],
        nested: [{
          uid: "inner", parentUid: "outer",
          top: 100, bottom: 400,
          header: { top: 100, bottom: 140 },
          childrenTop: 140, childrenBottom: 400,
          rows: [{ idx: 2, top: 150, bottom: 200 }],
        }],
      }],
    });
    const innerRow = frame.querySelector(".wp-bundle--nested .wp-module")!;
    setPointerHit(innerRow as HTMLElement);
    const ev = dragEvent(50, 160);
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [
        makeBundleInstance("outer", null, 2, 2),
        makeBundleInstance("inner", "outer", 2, 2),
      ],
    };
    expect(resolveDropZone(ev, frame, value, moduleDrag())).toEqual({
      kind: "slot", containerUid: "inner", insertIdx: 2,
    });
  });
});

describe("resolveDropZone — self-hover", () => {
  it("bundle drag over its own body → walk-up skips own frame + body, resolves at parent scope", () => {
    // Dragged bundle has its own row inside its body. Pointer hovers
    // that row. Walk-up skips own body (moving range), continues up.
    // Since this bundle is top-level, fallback resolves at top-level.
    const frame = buildScene({
      bundles: [{
        uid: "self", top: 100, bottom: 200,
        header: { top: 100, bottom: 140 },
        rows: [{ idx: 0, top: 150, bottom: 190 }],
      }],
    });
    const ownRow = frame.querySelector(".wp-bundle .wp-module")!;
    setPointerHit(ownRow as HTMLElement);
    const ev = dragEvent(50, 160);
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry],
      bundles: [makeBundleInstance("self", null, 0, 0)],
    };
    // The walk-up skips self's body, falls back to top-level. Pointer Y
    // is inside the bundle frame's rect → top-level Y walk finds the
    // bundle and applies midpoint logic. The bundle's rect midpoint at
    // (200+100)/2 = 150 → y=160 is past midpoint → slot AFTER the bundle.
    const zone = resolveDropZone(ev, frame, value, bundleDrag("self", 0, 0));
    expect(zone).toEqual({ kind: "slot", containerUid: null, insertIdx: 1 });
  });
});
