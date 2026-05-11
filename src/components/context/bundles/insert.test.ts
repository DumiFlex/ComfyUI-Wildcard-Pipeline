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
});
