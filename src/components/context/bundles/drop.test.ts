import { describe, it, expect } from "vitest";
import type { BundleInstance, ContextWidgetValue, ModuleEntry } from "../../../widgets/_shared";
import { applyDrop, type DropPayload } from "./drop";
import type { DropZone } from "./drop-zone";

function mod(id: string, opts: { bundle_origin?: string } = {}): ModuleEntry & { _uid: string; bundle_origin?: string } {
  return {
    id, _uid: `u-${id}`, type: "wildcard",
    enabled: true, collapsed: false,
    meta: { name: id }, entries: [], payload: {}, instance: {}, payload_hash: `h-${id}`,
    ...(opts.bundle_origin ? { bundle_origin: opts.bundle_origin } : {}),
  } as ModuleEntry & { _uid: string; bundle_origin?: string };
}

function bundle(
  uid: string, library_id: string, start: number, end: number,
  parent_uid: string | null = null,
): BundleInstance {
  return {
    _uid: uid, library_id, start_idx: start, end_idx: end,
    enabled: true, collapsed: false, inserted_at_hash: `h-${library_id}`,
    name: library_id, color: null, parent_uid,
  };
}

function value(modules: ModuleEntry[], bundles: BundleInstance[]): ContextWidgetValue {
  return { version: 1, modules, bundles };
}

describe("applyDrop — module drops (slot zone)", () => {
  it("module drop into top-level slot at end clears bundle_origin", () => {
    const v = value(
      [mod("a", { bundle_origin: "B1" }), mod("b")],
      [bundle("B1", "L1", 0, 0)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-a" };
    const zone: DropZone = { kind: "slot", containerUid: null, insertIdx: 2 };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["b", "a"]);
    expect((next.modules[1] as { bundle_origin?: string }).bundle_origin).toBeUndefined();
  });

  it("module drop into bundle slot stamps bundle_origin", () => {
    const v = value(
      [mod("a"), mod("b", { bundle_origin: "B1" }), mod("c", { bundle_origin: "B1" })],
      [bundle("B1", "L1", 1, 2)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-a" };
    const zone: DropZone = { kind: "slot", containerUid: "B1", insertIdx: 2 };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["b", "a", "c"]);
    expect((next.modules[1] as { bundle_origin?: string }).bundle_origin).toBe("B1");
    expect(next.bundles?.[0].start_idx).toBe(0);
    expect(next.bundles?.[0].end_idx).toBe(2);
  });

  it("module drop into top-level slot above a bundle clears bundle_origin", () => {
    // ext is at idx 1 (top-level), bundle B1 owns row idx 0. Drop ext
    // at top-level slot insertIdx=0 (above B1) → ext becomes idx 0.
    const v = value(
      [mod("inB", { bundle_origin: "B1" }), mod("after")],
      [bundle("B1", "L1", 0, 0)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 1, sourceUid: "u-after" };
    const zone: DropZone = { kind: "slot", containerUid: null, insertIdx: 0 };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["after", "inB"]);
    expect((next.modules[0] as { bundle_origin?: string }).bundle_origin).toBeUndefined();
  });

  it("module drop at top-level end stamps no bundle_origin", () => {
    const v = value(
      [mod("in", { bundle_origin: "B1" }), mod("b")],
      [bundle("B1", "L1", 0, 0)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-in" };
    const zone: DropZone = { kind: "slot", containerUid: null, insertIdx: 2 };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["b", "in"]);
    expect((next.modules[1] as { bundle_origin?: string }).bundle_origin).toBeUndefined();
  });
});

describe("applyDrop — bundle drops (slot zone)", () => {
  it("bundle drop at top-level slot clears parent_uid", () => {
    // Outer B1 [0..2] with inner B2 [1..1]. Drag B2 to top-level slot 0.
    const v = value(
      [mod("d1", { bundle_origin: "B1" }), mod("i1", { bundle_origin: "B2" }), mod("d2", { bundle_origin: "B1" })],
      [bundle("B1", "L1", 0, 2), bundle("B2", "L2", 1, 1, "B1")],
    );
    const drag: DropPayload = { kind: "bundle", bundleUid: "B2", sourceStartIdx: 1, sourceEndIdx: 1 };
    const zone: DropZone = { kind: "slot", containerUid: null, insertIdx: 0 };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["i1", "d1", "d2"]);
    const b2 = next.bundles!.find((b) => b._uid === "B2")!;
    expect(b2.parent_uid).toBeNull();
    expect(b2.start_idx).toBe(0);
    expect(b2.end_idx).toBe(0);
  });

  it("bundle drop into another bundle's slot sets parent_uid to that bundle", () => {
    // B1 + B2 are siblings. Drag B2 into B1 by hovering B1's only
    // row's bottom-half → slot at insertIdx=1 (end of B1's range).
    const v = value(
      [mod("a", { bundle_origin: "B1" }), mod("x", { bundle_origin: "B2" }), mod("y", { bundle_origin: "B2" })],
      [bundle("B1", "L1", 0, 0), bundle("B2", "L2", 1, 2)],
    );
    const drag: DropPayload = { kind: "bundle", bundleUid: "B2", sourceStartIdx: 1, sourceEndIdx: 2 };
    const zone: DropZone = { kind: "slot", containerUid: "B1", insertIdx: 1 };
    const next = applyDrop(zone, drag, v);
    const b2 = next.bundles!.find((b) => b._uid === "B2")!;
    expect(b2.parent_uid).toBe("B1");
  });

  it("self-drop on own current parent + insertIdx inside own range → no-op", () => {
    // Bundle at [0..1] with parent_uid=null. Slot at containerUid=null
    // insertIdx=0 → inside own range → no-op.
    const v = value(
      [mod("a", { bundle_origin: "B1" }), mod("b", { bundle_origin: "B1" })],
      [bundle("B1", "L1", 0, 1)],
    );
    const drag: DropPayload = { kind: "bundle", bundleUid: "B1", sourceStartIdx: 0, sourceEndIdx: 1 };
    const zone: DropZone = { kind: "slot", containerUid: null, insertIdx: 0 };
    const next = applyDrop(zone, drag, v);
    expect(next).toBe(v);
  });

  it("bundle drop at slot just past own range (same parent) → no-op", () => {
    // insertIdx === sourceEndIdx + 1 → still own slot → no-op.
    const v = value(
      [mod("a", { bundle_origin: "B1" })],
      [bundle("B1", "L1", 0, 0)],
    );
    const drag: DropPayload = { kind: "bundle", bundleUid: "B1", sourceStartIdx: 0, sourceEndIdx: 0 };
    const zone: DropZone = { kind: "slot", containerUid: null, insertIdx: 1 };
    const next = applyDrop(zone, drag, v);
    expect(next).toBe(v);
  });

  it("null zone → returns input unchanged", () => {
    const v = value([mod("a")], []);
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-a" };
    const next = applyDrop(null, drag, v);
    expect(next).toBe(v);
  });
});
