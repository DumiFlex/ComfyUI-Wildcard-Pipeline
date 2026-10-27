import { describe, expect, it } from "vitest";
import { diffList, diffTags, shares, tagsChanged } from "./card-diff";

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
