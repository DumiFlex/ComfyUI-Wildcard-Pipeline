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

describe("applyDrop — module drops", () => {
  it("module drop into top-level row.after — clears bundle_origin", () => {
    const v = value(
      [mod("a", { bundle_origin: "B1" }), mod("b")],
      [bundle("B1", "L1", 0, 0)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-a" };
    const zone: DropZone = { kind: "row", containerUid: null, insertIdx: 1, pos: "after" };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["b", "a"]);
    expect((next.modules[1] as { bundle_origin?: string }).bundle_origin).toBeUndefined();
  });

  it("module drop into bundle row.before — stamps bundle_origin", () => {
    const v = value(
      [mod("a"), mod("b", { bundle_origin: "B1" }), mod("c", { bundle_origin: "B1" })],
      [bundle("B1", "L1", 1, 2)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-a" };
    const zone: DropZone = { kind: "row", containerUid: "B1", insertIdx: 2, pos: "before" };
    const next = applyDrop(zone, drag, v);
    // a now sits before c, inside bundle. Modules: [b, a, c]
    expect(next.modules.map((m) => m.id)).toEqual(["b", "a", "c"]);
    expect((next.modules[1] as { bundle_origin?: string }).bundle_origin).toBe("B1");
    // Bundle range envelopes all three rows now.
    expect(next.bundles?.[0].start_idx).toBe(0);
    expect(next.bundles?.[0].end_idx).toBe(2);
  });

  it("module drop into empty bundle body — stamps bundle_origin + lands at start_idx", () => {
    // B1 is empty (end<start) — start_idx points where its first child would go.
    const v = value(
      [mod("a"), mod("b")],
      [bundle("B1", "L1", 2, 1)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-a" };
    const zone: DropZone = { kind: "empty", uid: "B1" };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["b", "a"]);
    expect((next.modules[1] as { bundle_origin?: string }).bundle_origin).toBe("B1");
  });

  it("module drop on header.before of a top-level bundle — module becomes top-level sibling above bundle", () => {
    const v = value(
      [mod("inB", { bundle_origin: "B1" }), mod("after")],
      [bundle("B1", "L1", 0, 0)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 1, sourceUid: "u-after" };
    const zone: DropZone = { kind: "header", uid: "B1", pos: "before" };
    const next = applyDrop(zone, drag, v);
    // "after" should now sit before B1's only leaf "inB".
    expect(next.modules.map((m) => m.id)).toEqual(["after", "inB"]);
    expect((next.modules[0] as { bundle_origin?: string }).bundle_origin).toBeUndefined();
  });

  it("module drop on header.before of a nested inner bundle — module stays inside outer scope", () => {
    // Outer B1 at [0..3], inner B2 (parent_uid: B1) at [1..2].
    const v = value(
      [
        mod("d1", { bundle_origin: "B1" }),
        mod("i1", { bundle_origin: "B2" }),
        mod("i2", { bundle_origin: "B2" }),
        mod("d2", { bundle_origin: "B1" }),
        mod("ext"),
      ],
      [bundle("B1", "L1", 0, 3), bundle("B2", "L2", 1, 2, "B1")],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 4, sourceUid: "u-ext" };
    // Drop above the inner B2's header — should land in outer scope.
    const zone: DropZone = { kind: "header", uid: "B2", pos: "before" };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["d1", "ext", "i1", "i2", "d2"]);
    // ext gets B1's bundle_origin (sibling drop = inner's parent scope).
    expect((next.modules[1] as { bundle_origin?: string }).bundle_origin).toBe("B1");
  });

  it("module drop at kind:'end' — clears bundle_origin + lands at end of list", () => {
    const v = value(
      [mod("in", { bundle_origin: "B1" }), mod("b")],
      [bundle("B1", "L1", 0, 0)],
    );
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-in" };
    const zone: DropZone = { kind: "end" };
    const next = applyDrop(zone, drag, v);
    expect(next.modules.map((m) => m.id)).toEqual(["b", "in"]);
    expect((next.modules[1] as { bundle_origin?: string }).bundle_origin).toBeUndefined();
  });
});

describe("applyDrop — bundle drops", () => {
  it("bundle drop into top-level row.before — clears parent_uid", () => {
    // B1 outer at [0..2] with inner B2 (parent B1) at [1..1].
    // Drag B2 out, drop at top-level above B1.
    const v = value(
      [mod("d1", { bundle_origin: "B1" }), mod("i1", { bundle_origin: "B2" }), mod("d2", { bundle_origin: "B1" })],
      [bundle("B1", "L1", 0, 2), bundle("B2", "L2", 1, 1, "B1")],
    );
    const drag: DropPayload = { kind: "bundle", bundleUid: "B2", sourceStartIdx: 1, sourceEndIdx: 1 };
    const zone: DropZone = { kind: "row", containerUid: null, insertIdx: 0, pos: "before" };
    const next = applyDrop(zone, drag, v);
    // i1 (B2's row) moves to position 0; d1 + d2 stay.
    expect(next.modules.map((m) => m.id)).toEqual(["i1", "d1", "d2"]);
    // B2 detached: parent_uid is null.
    const b2 = next.bundles!.find((b) => b._uid === "B2")!;
    expect(b2.parent_uid).toBeNull();
    expect(b2.start_idx).toBe(0);
    expect(b2.end_idx).toBe(0);
  });

  it("bundle drop into another bundle's empty body — sets parent_uid to that bundle", () => {
    // B1 outer (no children yet, end<start). B2 standalone with leaves.
    // Drag B2 into B1's empty body.
    const v = value(
      [mod("x", { bundle_origin: "B2" }), mod("y", { bundle_origin: "B2" })],
      [bundle("B1", "L1", 2, 1), bundle("B2", "L2", 0, 1)],
    );
    const drag: DropPayload = { kind: "bundle", bundleUid: "B2", sourceStartIdx: 0, sourceEndIdx: 1 };
    const zone: DropZone = { kind: "empty", uid: "B1" };
    const next = applyDrop(zone, drag, v);
    const b2 = next.bundles!.find((b) => b._uid === "B2")!;
    expect(b2.parent_uid).toBe("B1");
  });

  it("bundle drop on header.after of another top-level bundle — sibling drop, parent_uid stays null", () => {
    const v = value(
      [mod("a", { bundle_origin: "B1" }), mod("b", { bundle_origin: "B2" })],
      [bundle("B1", "L1", 0, 0), bundle("B2", "L2", 1, 1)],
    );
    const drag: DropPayload = { kind: "bundle", bundleUid: "B2", sourceStartIdx: 1, sourceEndIdx: 1 };
    // Drop B2 right after B1's header.
    const zone: DropZone = { kind: "header", uid: "B1", pos: "after" };
    const next = applyDrop(zone, drag, v);
    const b2 = next.bundles!.find((b) => b._uid === "B2")!;
    // Sibling drop — B1's parent_uid is null, so B2 stays top-level.
    expect(b2.parent_uid).toBeNull();
  });

  it("self-drop on own header — no-op (returns input unchanged)", () => {
    const v = value([mod("a", { bundle_origin: "B1" })], [bundle("B1", "L1", 0, 0)]);
    const drag: DropPayload = { kind: "bundle", bundleUid: "B1", sourceStartIdx: 0, sourceEndIdx: 0 };
    const zone: DropZone = { kind: "header", uid: "B1", pos: "before" };
    const next = applyDrop(zone, drag, v);
    // Modules + bundles unchanged.
    expect(next.modules).toEqual(v.modules);
    expect(next.bundles).toEqual(v.bundles);
  });

  it("null zone → returns input unchanged", () => {
    const v = value([mod("a")], []);
    const drag: DropPayload = { kind: "module", sourceIdx: 0, sourceUid: "u-a" };
    const next = applyDrop(null, drag, v);
    expect(next).toBe(v);
  });
});
