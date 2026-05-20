import { describe, it, expect } from "vitest";
import { buildBundleInsertion, type BundleLibraryEntry } from "./insert";

describe("buildBundleInsertion", () => {
  const bundle: BundleLibraryEntry = {
    id: "lib-coral",
    name: "subject_phrase",
    color: "#FB7185",
    children: [
      {
        id: "aabbcc11",
        type: "wildcard",
        payload: { var_binding: "color" },
        instance: {},
        payload_hash: "child-hash-w",
      },
      {
        id: "ddeeff22",
        type: "combine",
        payload: { template: "see @{aabbcc11}" },
        instance: {},
        payload_hash: "child-hash-c",
      },
    ],
    payload_hash: "hash-abc",
  };

  it("produces N spliced modules — one per bundle child", () => {
    const result = buildBundleInsertion(bundle, 5);
    expect(result.modulesToSplice).toHaveLength(2);
  });

  it("stamps bundle_origin pointing to the new bundle instance _uid", () => {
    const result = buildBundleInsertion(bundle, 0);
    const uid = result.bundleInstance._uid;
    expect(uid).toMatch(/^[0-9a-f]{12}$/);
    for (const m of result.modulesToSplice) {
      expect(m.bundle_origin).toBe(uid);
    }
  });

  it("preserves child library ids so per-kind drift detection works", () => {
    // Bundles keep ORIGINAL library uuids on insert. Regenerating
    // would break the `isMissingFromLibrary` lookup and surface every
    // child as missing. Multi-instance disambiguation lives in
    // `_uid` (fresh per row) not `id`.
    const result = buildBundleInsertion(bundle, 0);
    const [w, c] = result.modulesToSplice;
    expect(w.id).toBe("aabbcc11");
    expect(c.id).toBe("ddeeff22");
    // In-bundle @{uuid} refs likewise stay verbatim — they still
    // resolve correctly since the referenced child also kept its id.
    const tpl = (c.payload as Record<string, string>).template;
    expect(tpl).toBe("see @{aabbcc11}");
  });

  it("sets BundleInstance fields from the library entry + insert position", () => {
    const result = buildBundleInsertion(bundle, 5);
    expect(result.bundleInstance.library_id).toBe("lib-coral");
    expect(result.bundleInstance.start_idx).toBe(5);
    expect(result.bundleInstance.end_idx).toBe(6);  // 5 + (2 children - 1)
    expect(result.bundleInstance.enabled).toBe(true);
    expect(result.bundleInstance.collapsed).toBe(false);
    expect(result.bundleInstance.inserted_at_hash).toBe("hash-abc");
  });

  it("handles empty bundle (no children) — end_idx clamps", () => {
    const empty: BundleLibraryEntry = {
      id: "lib-empty",
      name: "empty",
      children: [],
      payload_hash: "h",
    };
    const result = buildBundleInsertion(empty, 3);
    expect(result.modulesToSplice).toHaveLength(0);
    expect(result.bundleInstance.start_idx).toBe(3);
    expect(result.bundleInstance.end_idx).toBe(2);  // start - 1 = invalid range
  });

  it("each spliced module has a fresh _uid for Vue v-for keys", () => {
    const result = buildBundleInsertion(bundle, 0);
    const uids = result.modulesToSplice.map((m: { _uid: string }) => m._uid);
    expect(new Set(uids).size).toBe(uids.length);  // all unique
    for (const u of uids) {
      expect(u).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it("preserves payload_hash on each child for per-kind drift detection", () => {
    // Each child's library_id + payload_hash drive the existing
    // isDrifted / isMissingFromLibrary logic on top-level modules.
    // Bundle children get the same treatment.
    const result = buildBundleInsertion(bundle, 0);
    for (const m of result.modulesToSplice) {
      expect(typeof m.payload_hash).toBe("string");
    }
  });

  // ── Tier-2 nesting pre-flatten (reference model) ──────────────────────
  // GET /bundles/{id} server-resolves any bundle-typed children inline
  // by attaching the referenced bundle's current children under the
  // bundle entry's `children` key. buildBundleInsertion expands those
  // grandchildren into the outer canvas module list so the BundleInstance
  // covers a flat span. The inner-bundle's name/color is dropped at
  // insert — once on canvas the leaves belong to the outer bundle frame.

  it("pre-flattens an expanded inner-bundle reference into the outer module list", () => {
    const nested: BundleLibraryEntry = {
      id: "lib-outer",
      name: "outer",
      children: [
        {
          id: "ll000001",
          type: "wildcard",
          payload: { var_binding: "leading" },
          instance: {},
          payload_hash: "h-leading",
        },
        {
          // Bundle reference entry as returned by the API expander:
          // server-attached `children` reflects the live referenced
          // bundle's contents.
          id: "bb000001",
          type: "bundle",
          name: "inner",
          color: "#abcdef",
          _resolved_from: "bb000001",
          children: [
            {
              id: "ii000001",
              type: "wildcard",
              payload: { var_binding: "inner_a" },
              instance: {},
              payload_hash: "h-inner-a",
            },
            {
              id: "ii000002",
              type: "fixed_values",
              payload: { values: [] },
              instance: {},
              payload_hash: "h-inner-b",
            },
          ],
        } as unknown as BundleLibraryEntry["children"][number],
        {
          id: "tt000001",
          type: "combine",
          payload: { template: "$inner_a" },
          instance: {},
          payload_hash: "h-trailing",
        },
      ],
      payload_hash: "outer-hash",
    };
    const result = buildBundleInsertion(nested, 0);
    expect(result.modulesToSplice).toHaveLength(4);
    expect(result.modulesToSplice.map((m) => m.id))
      .toEqual(["ll000001", "ii000001", "ii000002", "tt000001"]);
    for (const m of result.modulesToSplice) {
      expect(m.type).not.toBe("bundle");
    }
  });

  it("BundleInstance range covers the post-flatten length", () => {
    const nested: BundleLibraryEntry = {
      id: "lib-outer",
      name: "outer",
      children: [
        {
          id: "bb000001",
          type: "bundle",
          name: "inner",
          children: [
            { id: "i1", type: "wildcard", payload: {}, instance: {}, payload_hash: "h1" },
            { id: "i2", type: "wildcard", payload: {}, instance: {}, payload_hash: "h2" },
            { id: "i3", type: "wildcard", payload: {}, instance: {}, payload_hash: "h3" },
          ],
        } as unknown as BundleLibraryEntry["children"][number],
      ],
      payload_hash: "h",
    };
    const result = buildBundleInsertion(nested, 10);
    expect(result.bundleInstance.start_idx).toBe(10);
    expect(result.bundleInstance.end_idx).toBe(12);
  });

  it("expanded inner-bundle leaves inherit the OUTER bundle_origin", () => {
    const nested: BundleLibraryEntry = {
      id: "lib-outer",
      name: "outer",
      children: [
        {
          id: "bb000001",
          type: "bundle",
          name: "inner",
          children: [
            { id: "i1", type: "wildcard", payload: {}, instance: {}, payload_hash: "h" },
          ],
        } as unknown as BundleLibraryEntry["children"][number],
      ],
      payload_hash: "h",
    };
    const result = buildBundleInsertion(nested, 0);
    expect(result.modulesToSplice[0].bundle_origin).toBe(result.bundleInstance._uid);
  });

  it("drops a missing-reference bundle entry from the splice", () => {
    // The API marks an unresolvable reference with _missing_ref and no
    // children array. Pre-flatten skips the entry entirely so the
    // canvas doesn't end up with a dangling placeholder row.
    const broken: BundleLibraryEntry = {
      id: "lib-outer",
      name: "outer",
      children: [
        {
          id: "bb000001",
          type: "bundle",
          name: "ghost",
          _missing_ref: true,
        } as unknown as BundleLibraryEntry["children"][number],
        { id: "ok000001", type: "wildcard", payload: {}, instance: {}, payload_hash: "h" },
      ],
      payload_hash: "h",
    };
    const result = buildBundleInsertion(broken, 0);
    expect(result.modulesToSplice).toHaveLength(1);
    expect(result.modulesToSplice[0].id).toBe("ok000001");
  });
});
