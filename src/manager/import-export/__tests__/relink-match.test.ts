import { describe, it, expect } from "vitest";
import { findRelinkCandidates, autoRelinkTarget } from "../relink-match";

const draft = { id: "dead0001", type: "wildcard", payload_hash: "HASH_A", name: "hair" };
const nameLookup = (u: string) =>
  ({
    live0001: { name: "hair", type: "wildcard" }, // identical content, renamed uuid
    live0002: { name: "hair", type: "wildcard" }, // same name, different content
    live0003: { name: "eyes", type: "wildcard" }, // unrelated
    live0004: { name: "hair", type: "combine" }, // name match but wrong kind
  })[u];
const live = {
  live0001: { type: "wildcard", payload_hash: "HASH_A" },
  live0002: { type: "wildcard", payload_hash: "HASH_B" },
  live0003: { type: "wildcard", payload_hash: "HASH_C" },
  live0004: { type: "combine", payload_hash: "HASH_D" },
  dead0001: { type: "wildcard", payload_hash: "HASH_A" }, // the draft's own id — excluded
};

describe("findRelinkCandidates", () => {
  it("returns identical-content candidate first, then name matches; excludes self + wrong kind", () => {
    const got = findRelinkCandidates(draft, live, nameLookup);
    expect(got.map((c) => c.uuid)).toEqual(["live0001", "live0002"]);
    expect(got[0]).toMatchObject({ uuid: "live0001", contentIdentical: true });
    expect(got[1]).toMatchObject({ uuid: "live0002", contentIdentical: false, nameMatch: true });
    // self excluded, unrelated name excluded, cross-kind name-match excluded
    expect(got.some((c) => c.uuid === "dead0001")).toBe(false);
    expect(got.some((c) => c.uuid === "live0003")).toBe(false);
    expect(got.some((c) => c.uuid === "live0004")).toBe(false);
  });

  it("carries the library payloadHash for each candidate", () => {
    const got = findRelinkCandidates(draft, live, nameLookup);
    expect(got.find((c) => c.uuid === "live0002")?.payloadHash).toBe("HASH_B");
  });

  it("a hash-less draft with no contentKey still yields no content-identical candidates", () => {
    // Nothing to compare on — name matches only.
    const got = findRelinkCandidates({ ...draft, payload_hash: undefined }, live, nameLookup);
    expect(got.every((c) => !c.contentIdentical)).toBe(true);
  });

  // --- Hash-less rows: match on locally computed payload content ----------
  // A shared workflow or a row whose stored hash was lost still corresponds to
  // a library entry. Previously it was treated as "never tracked, nothing to
  // re-link", which is only true for a module authored in the widget.

  it("matches a hash-less draft against a library row by payload content", () => {
    const liveWithKeys = {
      ...live,
      live0001: { type: "wildcard", payload_hash: "HASH_A", contentKey: "CK_1" },
      live0002: { type: "wildcard", payload_hash: "HASH_B", contentKey: "CK_2" },
    };
    const got = findRelinkCandidates(
      { ...draft, payload_hash: undefined, contentKey: "CK_1" },
      liveWithKeys,
      nameLookup,
    );
    const hit = got.find((c) => c.uuid === "live0001");
    expect(hit?.contentIdentical).toBe(true);
    // Flagged so the UI can say the match came from content, not the server hash.
    expect(hit?.matchedByContent).toBe(true);
  });

  it("auto-links a hash-less draft when exactly one content match exists", () => {
    const liveWithKeys = {
      live0001: { type: "wildcard", payload_hash: "HASH_A", contentKey: "CK_1" },
      live0003: { type: "wildcard", payload_hash: "HASH_C", contentKey: "CK_9" },
    };
    const got = findRelinkCandidates(
      { ...draft, payload_hash: undefined, contentKey: "CK_1" },
      liveWithKeys,
      nameLookup,
    );
    expect(autoRelinkTarget(got)?.uuid).toBe("live0001");
  });

  it("a PRESENT-but-different hash still reads as 'content differs'", () => {
    // The server hash is authoritative when both sides have one — a stale
    // contentKey must not upgrade a genuine difference to 'identical'.
    const liveWithKeys = {
      live0002: { type: "wildcard", payload_hash: "HASH_B", contentKey: "CK_1" },
    };
    const got = findRelinkCandidates(
      { ...draft, payload_hash: "HASH_A", contentKey: "CK_1" },
      liveWithKeys,
      nameLookup,
    );
    expect(got[0]).toMatchObject({ contentIdentical: false, nameMatch: true });
    expect(got[0].matchedByContent).toBeUndefined();
  });

  it("keeps the cross-kind gate for content matches", () => {
    // Same payload shape across kinds must never link a wildcard to a combine.
    const liveWithKeys = {
      live0004: { type: "combine", payload_hash: "HASH_D", contentKey: "CK_1" },
    };
    const got = findRelinkCandidates(
      { ...draft, payload_hash: undefined, contentKey: "CK_1" },
      liveWithKeys,
      nameLookup,
    );
    expect(got).toEqual([]);
  });
});

describe("autoRelinkTarget", () => {
  it("returns the sole identical candidate", () => {
    expect(autoRelinkTarget(findRelinkCandidates(draft, live, nameLookup))?.uuid).toBe("live0001");
  });
  it("returns null when two identical candidates exist (ambiguous)", () => {
    const live2 = { ...live, live0005: { type: "wildcard", payload_hash: "HASH_A" } };
    const nl2 = (u: string) => (u === "live0005" ? { name: "hair2", type: "wildcard" } : nameLookup(u));
    expect(autoRelinkTarget(findRelinkCandidates(draft, live2, nl2))).toBeNull();
  });
  it("returns null when zero identical candidates exist", () => {
    expect(
      autoRelinkTarget([{ uuid: "x", name: "n", payloadHash: "h", contentIdentical: false, nameMatch: true }]),
    ).toBeNull();
  });
});
