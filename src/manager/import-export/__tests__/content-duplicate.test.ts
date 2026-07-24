import { describe, it, expect } from "vitest";
import { findContentDuplicates, findLinkableDuplicates } from "../content-duplicate";
import { moduleFingerprint } from "../fingerprint";

const rowA = {
  id: "incoming1", type: "wildcard", name: "hair", description: "",
  tags: ["a"], payload_hash: "PH_A",
};
const rowB = {
  id: "incoming2", type: "wildcard", name: "eyes", description: "",
  tags: [], payload_hash: "PH_B",
};

const fpA = moduleFingerprint(rowA);
const fpB = moduleFingerprint(rowB);

describe("findContentDuplicates", () => {
  it("maps an incoming entity to an existing library row with identical content", () => {
    const got = findContentDuplicates([rowA], [
      { id: "lib0001", type: "wildcard", fingerprint: fpA },
    ]);
    expect(got).toEqual({ incoming1: "lib0001" });
  });

  it("ignores a library row whose content differs", () => {
    const got = findContentDuplicates([rowA], [
      { id: "lib0001", type: "wildcard", fingerprint: fpB },
    ]);
    expect(got).toEqual({});
  });

  it("never maps an entity onto its OWN id (same uuid is a normal collision)", () => {
    const got = findContentDuplicates([rowA], [
      { id: "incoming1", type: "wildcard", fingerprint: fpA },
    ]);
    expect(got).toEqual({});
  });

  it("skips cross-kind matches even when the fingerprint collides", () => {
    const got = findContentDuplicates([rowA], [
      { id: "lib0001", type: "combine", fingerprint: fpA },
    ]);
    expect(got).toEqual({});
  });

  it("omits ambiguous matches (two library rows share the content)", () => {
    const got = findContentDuplicates([rowA], [
      { id: "lib0001", type: "wildcard", fingerprint: fpA },
      { id: "lib0002", type: "wildcard", fingerprint: fpA },
    ]);
    expect(got).toEqual({});
  });

  it("handles several incoming entities independently", () => {
    const got = findContentDuplicates([rowA, rowB], [
      { id: "lib0001", type: "wildcard", fingerprint: fpA },
      { id: "lib0002", type: "wildcard", fingerprint: fpB },
    ]);
    expect(got).toEqual({ incoming1: "lib0001", incoming2: "lib0002" });
  });
});

describe("findLinkableDuplicates", () => {
  const library = [{ id: "lib0001", type: "wildcard", fingerprint: fpA }];

  it("offers a link when the incoming id does NOT already exist in the library", () => {
    const got = findLinkableDuplicates([rowA], library, new Set(["lib0001"]));
    expect(got).toEqual({ incoming1: "lib0001" });
  });

  it("stays silent when the incoming id IS a uuid collision (batch-conflict path owns it)", () => {
    // incoming1 already exists in the library → that's a normal collision,
    // resolved as skip/replace/rename, not a content-duplicate link.
    const got = findLinkableDuplicates([rowA], library, new Set(["lib0001", "incoming1"]));
    expect(got).toEqual({});
  });
});
