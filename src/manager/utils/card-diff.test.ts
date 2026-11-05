import { describe, expect, it } from "vitest";
import { diffList, diffTags, diffWords, readVars, shares, tagsChanged } from "./card-diff";

const id = (o: { id: string }) => o.id;

describe("diffList", () => {
  it("marks added, removed, changed and same parts in the new order", () => {
    const before = [{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
    const after = [{ id: "a", v: 1 }, { id: "c", v: 2 }, { id: "d", v: 1 }];
    const rows = diffList(before, after, id);
    expect(rows.map((r) => [r.now.id, r.change])).toEqual([
      ["a", "same"], ["b", "removed"], ["c", "changed"], ["d", "added"],
    ]);
    expect(rows[2].was).toEqual({ id: "c", v: 1 });
    expect(rows[3].was).toBeNull();
  });

  it("puts a removed first part back at the top", () => {
    const rows = diffList([{ id: "a" }, { id: "b" }], [{ id: "b" }], id);
    expect(rows.map((r) => [r.now.id, r.change])).toEqual([["a", "removed"], ["b", "same"]]);
  });
});

describe("diffTags", () => {
  it("keeps the old order, marks dropped ones and appends new ones", () => {
    const d = diffTags(["warm", "cold"], ["cold", "wet"]);
    expect(d).toEqual([
      { tag: "warm", change: "removed" }, { tag: "cold", change: "same" }, { tag: "wet", change: "added" },
    ]);
    expect(tagsChanged(d)).toBe(true);
    expect(tagsChanged(diffTags(["a"], ["a"]))).toBe(false);
  });
});

describe("shares", () => {
  it("gives each weight its share of the total, like the editor", () => {
    expect(shares([1, 3])).toEqual([25, 75]);
    expect(shares([0, 0])).toEqual([0, 0]);
    expect(shares([2, -1, Number.NaN])).toEqual([100, 0, 0]);
  });
});

describe("diffWords", () => {
  it("marks whole words kept, taken out and put in", () => {
    expect(diffWords("$quality, 1girl, $outfit, rainy street", "$quality, 1girl, $outfit, $mood, night street")).toEqual([
      { text: "$quality, 1girl, $outfit, ", change: "same" },
      { text: "rainy", change: "removed" },
      { text: "$mood, night ", change: "added" },
      { text: "street", change: "same" },
    ]);
    expect(diffWords("a big red b", "a b")).toEqual([
      { text: "a ", change: "same" }, { text: "big red ", change: "removed" }, { text: "b", change: "same" },
    ]);
    expect(diffWords("", "new")).toEqual([{ text: "new", change: "added" }]);
    expect(diffWords("same", "same")).toEqual([{ text: "same", change: "same" }]);
  });

  it("gives up word by word on very long texts", () => {
    const a = Array.from({ length: 600 }, (_, i) => `a${i}`).join(" ");
    const b = Array.from({ length: 600 }, (_, i) => `b${i}`).join(" ");
    expect(diffWords(a, b)).toEqual([{ text: a, change: "removed" }, { text: b, change: "added" }]);
  });
});

describe("readVars", () => {
  it("lists the variables a text reads once each", () => {
    expect(readVars("$a, $b.0 and $a.neg, $$ cost")).toEqual(["a", "b"]);
  });
});
