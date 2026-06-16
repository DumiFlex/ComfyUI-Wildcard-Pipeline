import { describe, it, expect } from "vitest";
import { relinkChildren, computeHasDangling } from "../views/BundleEditor.vue";

/**
 * Locks the two pure helpers BundleEditor uses to heal a bundle after
 * "extract to library":
 *
 *  - `relinkChildren` rewrites each frozen child's whole-string `id` (and
 *    any intra-bundle ref, e.g. a constraint's `source_wildcard_id`) from
 *    the OLD library uuid to the freshly-installed uuid, using the remap
 *    table `extractBundleChildren` returns. This is what clears the
 *    "Child N: target module missing" error after extract.
 *  - `computeHasDangling` reports whether ANY child no longer resolves to
 *    a row in its kind's id-set (modules for leaves, bundles for
 *    `type:"bundle"`). It gates the extract button — extract is a heal
 *    action, so it's only offered when something actually dangles.
 *
 * Both are pure (no Vue mount), mirroring buildExtractEnvelope's test.
 */
describe("relinkChildren", () => {
  it("rewrites a child's whole-string id from old to new", () => {
    const children = [
      { id: "aaaa1111", type: "wildcard", payload: { options: [] } },
      { id: "bbbb2222", type: "wildcard", payload: { options: [] } },
    ];
    const remap = { aaaa1111: "new1", bbbb2222: "new2" };
    const out = relinkChildren(children, remap);
    expect(out.map((c) => c.id)).toEqual(["new1", "new2"]);
  });

  it("rewrites an intra-bundle constraint ref pointing at a sibling", () => {
    const children = [
      { id: "aaaa1111", type: "wildcard", payload: { options: [] } },
      {
        id: "cccc3333",
        type: "constraint",
        payload: {
          source_wildcard_id: "aaaa1111",
          target_wildcard_id: "bbbb2222",
          matrix: {},
          exceptions: [],
        },
      },
    ];
    const remap = { aaaa1111: "new1", bbbb2222: "new2", cccc3333: "new3" };
    const out = relinkChildren(children, remap);
    const con = out.find((c) => c.type === "constraint")!;
    expect(con.id).toBe("new3");
    const p = con.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("new1");
    expect(p.target_wildcard_id).toBe("new2");
  });

  it("leaves ids absent from the remap table verbatim", () => {
    const children = [{ id: "keepme00", type: "wildcard", payload: {} }];
    const out = relinkChildren(children, { other000: "new1" });
    expect(out[0].id).toBe("keepme00");
  });
});

describe("computeHasDangling", () => {
  const modIds = new Set(["m1", "m2"]);
  const bunIds = new Set(["b1"]);

  it("is true when a leaf child id is absent from the module id-set", () => {
    const children = [{ id: "missing", type: "wildcard" }];
    expect(computeHasDangling(children, modIds, bunIds)).toBe(true);
  });

  it("is false when every child resolves to its kind's id-set", () => {
    const children = [
      { id: "m1", type: "wildcard" },
      { id: "b1", type: "bundle" },
    ];
    expect(computeHasDangling(children, modIds, bunIds)).toBe(false);
  });

  it("checks a bundle-typed child against the bundle id-set, not modules", () => {
    // `b1` exists as a bundle but NOT as a module — it must resolve.
    const children = [{ id: "b1", type: "bundle" }];
    expect(computeHasDangling(children, modIds, bunIds)).toBe(false);
    // A bundle id that is only present in the module set still dangles.
    const children2 = [{ id: "m1", type: "bundle" }];
    expect(computeHasDangling(children2, modIds, bunIds)).toBe(true);
  });

  it("is false for an empty children list (nothing to dangle)", () => {
    expect(computeHasDangling([], modIds, bunIds)).toBe(false);
  });
});
