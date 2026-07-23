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

  it("a draft with no payload_hash yields no content-identical candidates", () => {
    const got = findRelinkCandidates({ ...draft, payload_hash: undefined }, live, nameLookup);
    expect(got.every((c) => !c.contentIdentical)).toBe(true);
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
