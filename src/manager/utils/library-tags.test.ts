import { describe, expect, it } from "vitest";
import { libraryTagCounts, matchesTags } from "./library-tags";

describe("libraryTagCounts", () => {
  it("counts per kind, most used first, ties by name", () => {
    const out = libraryTagCounts(
      [{ tags: ["outfit", "nsfw"] }, { tags: ["outfit"] }, { tags: [] }],
      [{ tags: ["scene", "outfit"] }],
      [{ tags: ["nsfw"] }, { tags: null }],
    );
    expect(out).toEqual([
      { tag: "outfit", modules: 2, bundles: 1, templates: 0, total: 3 },
      { tag: "nsfw", modules: 1, bundles: 0, templates: 1, total: 2 },
      { tag: "scene", modules: 0, bundles: 1, templates: 0, total: 1 },
    ]);
  });

  it("counts a duplicated tag on one row once", () => {
    expect(libraryTagCounts([{ tags: ["a", "a"] }], [], [])[0].total).toBe(1);
  });
});

describe("matchesTags", () => {
  it("any: one shared tag is enough", () => {
    expect(matchesTags(["a", "b"], ["b", "c"], "any")).toBe(true);
    expect(matchesTags(["a"], ["b", "c"], "any")).toBe(false);
  });
  it("all: every wanted tag must be present", () => {
    expect(matchesTags(["a", "b", "c"], ["b", "c"], "all")).toBe(true);
    expect(matchesTags(["a", "b"], ["b", "c"], "all")).toBe(false);
  });
  it("no wanted tags passes everything", () => {
    expect(matchesTags(undefined, [], "all")).toBe(true);
  });
});
