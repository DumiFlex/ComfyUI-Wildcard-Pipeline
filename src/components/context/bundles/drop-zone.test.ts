import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { BundleInstance, ModuleEntry, ContextWidgetValue } from "../../../widgets/_shared";
import type { DragPayload } from "../drag-store";
import { resolveDropZone } from "./drop-zone";

// ─────────────────────────────────────────────────────────────────────
// Helpers: build a controllable DOM scene that mirrors the live
// ContextWidget rendering — top-level container with rows + bundles,
// nested children with their own rows. Each element gets a stubbed
// getBoundingClientRect so the resolver's geometry math is deterministic.

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
  nested?: BundleSpec[]; // tier-2 only
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
  const container = document.createElement("div");
  container.className = "wp-list";
  stubRect(container, {
    top: opts.containerTop ?? 0,
    bottom: opts.containerBottom ?? 1000,
  });
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
  document.body.appendChild(container);
  return container;
}

function dragEvent(x: number, y: number): DragEvent {
  // jsdom doesn't expose DragEvent. Fake the minimal shape the resolver
  // reads (clientX, clientY) — cast to DragEvent for the signature.
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

function bundleDrag(uid: string): DragPayload {
  return {
    kind: "bundle",
    sourceNodeId: 1,
    bundleUid: uid,
    sourceStartIdx: 0,
    sourceEndIdx: 0,
    libraryId: "lib",
    bundleName: "drag",
    bundleColor: null,
    bundleCollapsed: false,
    bundleEnabled: true,
    children: [],
  };
}

function makeBundleInstance(uid: string, parent_uid: string | null = null): BundleInstance {
  return {
    _uid: uid, library_id: "lib", start_idx: 0, end_idx: 0,
    enabled: true, collapsed: false, inserted_at_hash: "h",
    name: "B", color: null, parent_uid,
  };
}

// jsdom doesn't implement elementFromPoint — patch directly via the
// prototype's descriptor. Restore after each test so suites stay isolated.
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
  it("returns null when pointer is outside the modules container", () => {
    const container = buildScene({});
    const ev = dragEvent(-10, -10);
    const value: ContextWidgetValue = { version: 1, modules: [], bundles: [] };
    expect(resolveDropZone(ev, container, value, null)).toBeNull();
  });

  it("returns null when elementFromPoint returns nothing", () => {
    const container = buildScene({});
    setPointerHit(null);
    const ev = dragEvent(50, 50);
    const value: ContextWidgetValue = { version: 1, modules: [], bundles: [] };
    expect(resolveDropZone(ev, container, value, null)).toBeNull();
  });

  it("pointer in top-half of a top-level row → row, pos:'before'", () => {
    const container = buildScene({
      topRows: [{ idx: 0, top: 100, bottom: 140 }],
    });
    const row = container.querySelector(".wp-module")!;
    setPointerHit(row as HTMLElement);
    const ev = dragEvent(50, 110); // top half of [100..140]
    const value: ContextWidgetValue = {
      version: 1,
      modules: [{ id: "a" } as ModuleEntry],
      bundles: [],
    };
    expect(resolveDropZone(ev, container, value, moduleDrag())).toEqual({
      kind: "row", containerUid: null, insertIdx: 0, pos: "before",
    });
  });

  it("pointer in bottom-half of a top-level row → row, pos:'after'", () => {
    const container = buildScene({
      topRows: [{ idx: 0, top: 100, bottom: 140 }],
    });
    const row = container.querySelector(".wp-module")!;
    setPointerHit(row as HTMLElement);
    const ev = dragEvent(50, 135);
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry], bundles: [],
    };
    expect(resolveDropZone(ev, container, value, moduleDrag())).toEqual({
      kind: "row", containerUid: null, insertIdx: 0, pos: "after",
    });
  });

  it("pointer past every top-level candidate → end", () => {
    const container = buildScene({
      topRows: [{ idx: 0, top: 100, bottom: 140 }],
    });
    setPointerHit(container);
    const ev = dragEvent(50, 500); // way past row 0
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry], bundles: [],
    };
    expect(resolveDropZone(ev, container, value, moduleDrag())).toEqual({ kind: "end" });
  });

  it("empty top-level container → end", () => {
    const container = buildScene({});
    setPointerHit(container);
    const ev = dragEvent(50, 50);
    const value: ContextWidgetValue = { version: 1, modules: [], bundles: [] };
    expect(resolveDropZone(ev, container, value, null)).toEqual({ kind: "end" });
  });
});

describe("resolveDropZone — inside a bundle", () => {
  it("pointer over bundle header top-half → header.before", () => {
    const container = buildScene({
      bundles: [{
        uid: "B1", top: 100, bottom: 300,
        header: { top: 100, bottom: 140 },
        rows: [{ idx: 0, top: 140, bottom: 200 }],
      }],
    });
    const header = container.querySelector("[data-bundle-header]")!;
    setPointerHit(header as HTMLElement);
    const ev = dragEvent(50, 110); // top half of [100..140]
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry],
      bundles: [makeBundleInstance("B1")],
    };
    expect(resolveDropZone(ev, container, value, moduleDrag())).toEqual({
      kind: "header", uid: "B1", pos: "before",
    });
  });

  it("pointer over bundle header bottom-half → header.after", () => {
    const container = buildScene({
      bundles: [{
        uid: "B1", top: 100, bottom: 300,
        header: { top: 100, bottom: 140 },
        rows: [{ idx: 0, top: 140, bottom: 200 }],
      }],
    });
    const header = container.querySelector("[data-bundle-header]")!;
    setPointerHit(header as HTMLElement);
    const ev = dragEvent(50, 135);
    const value: ContextWidgetValue = {
      version: 1, modules: [{ id: "a" } as ModuleEntry],
      bundles: [makeBundleInstance("B1")],
    };
    expect(resolveDropZone(ev, container, value, moduleDrag())).toEqual({
      kind: "header", uid: "B1", pos: "after",
    });
  });

  it("pointer over a child row in a bundle → row, containerUid:bundleUid", () => {
    const container = buildScene({
      bundles: [{
        uid: "B1", top: 100, bottom: 300,
        header: { top: 100, bottom: 140 },
        rows: [{ idx: 5, top: 150, bottom: 200 }],
      }],
    });
    const row = container.querySelector(".wp-bundle .wp-module")!;
    setPointerHit(row as HTMLElement);
    const ev = dragEvent(50, 160); // top half of [150..200]
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [makeBundleInstance("B1")],
    };
    expect(resolveDropZone(ev, container, value, moduleDrag())).toEqual({
      kind: "row", containerUid: "B1", insertIdx: 5, pos: "before",
    });
  });

  it("pointer in empty bundle body → empty zone", () => {
    const container = buildScene({
      bundles: [{
        uid: "B1", top: 100, bottom: 300,
        header: { top: 100, bottom: 140 },
        childrenTop: 140, childrenBottom: 300,
        rows: [],
      }],
    });
    const childrenEl = container.querySelector(".wp-bundle-children")!;
    setPointerHit(childrenEl as HTMLElement);
    const ev = dragEvent(50, 200);
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [makeBundleInstance("B1")],
    };
    expect(resolveDropZone(ev, container, value, moduleDrag())).toEqual({
      kind: "empty", uid: "B1",
    });
  });

  it("nested bundle inside outer: pointer in inner's row → containerUid:inner.uid (innermost wins)", () => {
    const container = buildScene({
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
    const innerRow = container.querySelector(".wp-bundle--nested .wp-module")!;
    setPointerHit(innerRow as HTMLElement);
    const ev = dragEvent(50, 160);
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [
        makeBundleInstance("outer"),
        makeBundleInstance("inner", "outer"),
      ],
    };
    expect(resolveDropZone(ev, container, value, moduleDrag())).toEqual({
      kind: "row", containerUid: "inner", insertIdx: 2, pos: "before",
    });
  });
});

describe("resolveDropZone — tier-2 cap", () => {
  it("bundle drag whose dragged bundle has nested children, over another bundle's row → coerces to header.after of container", () => {
    const container = buildScene({
      bundles: [{
        uid: "Target", top: 100, bottom: 300,
        header: { top: 100, bottom: 140 },
        rows: [{ idx: 7, top: 150, bottom: 200 }],
      }],
    });
    const row = container.querySelector(".wp-bundle .wp-module")!;
    setPointerHit(row as HTMLElement);
    const ev = dragEvent(50, 160);
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [
        makeBundleInstance("Target"),
        // Dragged "WithNested" has an inner child — tier-2 cap triggers.
        makeBundleInstance("WithNested"),
        makeBundleInstance("WithNestedInner", "WithNested"),
      ],
    };
    expect(resolveDropZone(ev, container, value, bundleDrag("WithNested"))).toEqual({
      kind: "header", uid: "Target", pos: "after",
    });
  });

  it("bundle drag (no nested children) over another bundle's empty body → empty zone allowed", () => {
    const container = buildScene({
      bundles: [{
        uid: "Target", top: 100, bottom: 300,
        header: { top: 100, bottom: 140 },
        childrenTop: 140, childrenBottom: 300,
        rows: [],
      }],
    });
    const childrenEl = container.querySelector(".wp-bundle-children")!;
    setPointerHit(childrenEl as HTMLElement);
    const ev = dragEvent(50, 200);
    const value: ContextWidgetValue = {
      version: 1, modules: [],
      bundles: [
        makeBundleInstance("Target"),
        // Dragged "Leaf" has no nested children — allowed to land inside Target.
        makeBundleInstance("Leaf"),
      ],
    };
    expect(resolveDropZone(ev, container, value, bundleDrag("Leaf"))).toEqual({
      kind: "empty", uid: "Target",
    });
  });
});

describe("resolveDropZone — self-hover", () => {
  it("bundle drag over its own header → null (no-op)", () => {
    const container = buildScene({
      bundles: [{
        uid: "self", top: 100, bottom: 200,
        header: { top: 100, bottom: 140 },
        rows: [],
      }],
    });
    const header = container.querySelector("[data-bundle-header]")!;
    setPointerHit(header as HTMLElement);
    const ev = dragEvent(50, 110);
    const value: ContextWidgetValue = {
      version: 1, modules: [], bundles: [makeBundleInstance("self")],
    };
    expect(resolveDropZone(ev, container, value, bundleDrag("self"))).toBeNull();
  });
});
