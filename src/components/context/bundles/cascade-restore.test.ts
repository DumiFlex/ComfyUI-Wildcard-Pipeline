import { describe, it, expect } from "vitest";
import { rewriteChildId } from "./cascade-restore";

/**
 * #2 regression: cascade-restore must remap references INSIDE a child's
 * payload (constraint source/target, @{} refs), not just the child's own id.
 * When Phase 1 re-creates a missing module under a fresh uuid, a sibling
 * constraint that points at the old uuid must be re-pointed too, or the
 * pushed bundle ships a dead source/target.
 */
describe("cascade-restore rewriteChildId — payload ref remap (#2)", () => {
  it("remaps a constraint child's source/target uuids to the restored module ids", () => {
    const moduleMap = new Map([
      ["aaaaaaaa", "bbbbbbbb"],
      ["cccccccc", "dddddddd"],
    ]);
    const child = {
      id: "cn000001",
      type: "constraint",
      payload: { source_wildcard_id: "aaaaaaaa", target_wildcard_id: "cccccccc", matrix: {} },
    };
    const out = rewriteChildId(child, moduleMap, new Map());
    const p = out.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("bbbbbbbb");
    expect(p.target_wildcard_id).toBe("dddddddd");
  });

  it("remaps embedded @{uuid} refs in a child's payload (preserving #name)", () => {
    const moduleMap = new Map([["aabbccdd", "11223344"]]);
    const child = {
      id: "wc000001",
      type: "wildcard",
      payload: { options: [{ id: "o1", value: "see @{aabbccdd#color} here" }] },
    };
    const out = rewriteChildId(child, moduleMap, new Map());
    expect(JSON.stringify(out.payload)).toContain("@{11223344#color}");
  });

  it("remaps refs found in a child's instance overrides too", () => {
    const moduleMap = new Map([["aaaaaaaa", "bbbbbbbb"]]);
    const child = {
      id: "cn000002",
      type: "constraint",
      payload: { source_wildcard_id: "aaaaaaaa" },
      instance: { target_select: { picks: [{ carrier_uid: "aaaaaaaa", option_id: "r1:0" }] } },
    };
    const out = rewriteChildId(child, moduleMap, new Map());
    expect(JSON.stringify(out.instance)).toContain("bbbbbbbb");
    expect(JSON.stringify(out.instance)).not.toContain("aaaaaaaa");
  });

  it("leaves refs to non-restored (external) uuids untouched", () => {
    const child = {
      id: "cn000003",
      type: "constraint",
      payload: { source_wildcard_id: "eeeeeeee", target_wildcard_id: "ffffffff" },
    };
    const out = rewriteChildId(child, new Map([["aaaaaaaa", "bbbbbbbb"]]), new Map());
    const p = out.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("eeeeeeee");
    expect(p.target_wildcard_id).toBe("ffffffff");
  });

  it("still rewrites the child's own top-level id (module + bundle)", () => {
    const moduleMap = new Map([["aaaaaaaa", "bbbbbbbb"]]);
    const innerBundleMap = new Map([["bndl1111", "bndl2222"]]);
    const mod = rewriteChildId({ id: "aaaaaaaa", type: "wildcard", payload: {} }, moduleMap, innerBundleMap);
    expect(mod.id).toBe("bbbbbbbb");
    const bun = rewriteChildId({ id: "bndl1111", type: "bundle" }, moduleMap, innerBundleMap);
    expect(bun.id).toBe("bndl2222");
  });
});
