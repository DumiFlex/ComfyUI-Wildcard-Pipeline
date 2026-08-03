import { describe, it, expect } from "vitest";
import {
  filterIsActive,
  moveSelected,
  nudge,
  optionMatches,
  visibleTagsFor,
  type OptionLike,
} from "../option-list-ops";

const opt = (id: string, value: string, tags: string[] = []): OptionLike =>
  ({ id, value, sub_categories: tags });

describe("optionMatches", () => {
  const o = opt("a", "crimson red", ["red", "warm", "vivid"]);

  it("matches the value case-insensitively", () => {
    expect(optionMatches(o, { query: "RED", tags: [] })).toBe(true);
    expect(optionMatches(o, { query: "blue", tags: [] })).toBe(false);
  });

  it("ANDs multiple tags — a second filter narrows, it does not widen", () => {
    expect(optionMatches(o, { query: "", tags: ["red", "warm"] })).toBe(true);
    expect(optionMatches(o, { query: "", tags: ["red", "cool"] })).toBe(false);
  });

  it("ANDs text with tags", () => {
    expect(optionMatches(o, { query: "crimson", tags: ["warm"] })).toBe(true);
    expect(optionMatches(o, { query: "azure", tags: ["warm"] })).toBe(false);
  });

  it("keeps everything when nothing is filtered", () => {
    expect(optionMatches(opt("x", ""), { query: "", tags: [] })).toBe(true);
    expect(filterIsActive({ query: "  ", tags: [] })).toBe(false);
    expect(filterIsActive({ query: "", tags: ["red"] })).toBe(true);
  });

  it("excludes the null option from any active filter — it can match nothing", () => {
    const nul: OptionLike = { id: "n", is_null: true };
    expect(optionMatches(nul, { query: "red", tags: [] })).toBe(false);
  });
});

describe("visibleTagsFor", () => {
  const all = ["red", "warm", "medium", "vivid", "glossy", "skin-tone"];

  it("folds the overflow when nothing is matched", () => {
    const v = visibleTagsFor(all, new Set(), 4, false);
    expect(v.visible).toEqual(["red", "warm", "medium", "vivid"]);
    expect(v.hiddenCount).toBe(2);
    expect(v.hiddenHasMatch).toBe(false);
  });

  it("promotes a matched tag out of the folded remainder", () => {
    // The whole point: filtering by `skin-tone` used to show a row whose
    // visible chips contained no `skin-tone`, with the evidence hidden behind
    // the very `+2` pill that says there is more.
    const v = visibleTagsFor(all, new Set(["skin-tone"]), 4, false);
    expect(v.visible[0]).toBe("skin-tone");
    expect(v.visible).toHaveLength(4);
    expect(v.hiddenHasMatch).toBe(false);
  });

  it("keeps the unmatched tags in their original relative order", () => {
    const v = visibleTagsFor(all, new Set(["vivid"]), 4, false);
    expect(v.visible).toEqual(["vivid", "red", "warm", "medium"]);
  });

  it("flags the pill when matches are STILL folded", () => {
    // Five matches, room for four — the pill has to admit there are more.
    const v = visibleTagsFor(all, new Set(["red", "warm", "medium", "vivid", "glossy"]), 4, false);
    expect(v.hiddenHasMatch).toBe(true);
  });

  it("shows everything when the row is expanded", () => {
    const v = visibleTagsFor(all, new Set(["red"]), 4, true);
    expect(v.visible).toEqual(all);
    expect(v.hiddenCount).toBe(0);
  });

  it("does not fold a row that fits", () => {
    const v = visibleTagsFor(["red", "warm"], new Set(), 4, false);
    expect(v.hiddenCount).toBe(0);
  });
});

describe("moveSelected", () => {
  const list = [opt("a", "A"), opt("b", "B"), opt("c", "C"), opt("d", "D")];
  const ids = (l: readonly OptionLike[]) => l.map((o) => o.id).join("");

  it("collapses a scattered selection into one block, order preserved", () => {
    expect(ids(moveSelected(list, new Set(["a", "c"]), { to: "bottom" }))).toBe("bdac");
  });

  it("moves to the top", () => {
    expect(ids(moveSelected(list, new Set(["c", "d"]), { to: "top" }))).toBe("cdab");
  });

  it("lands the block before a chosen row", () => {
    expect(ids(moveSelected(list, new Set(["a"]), { to: "before", id: "d" }))).toBe("bcad");
  });

  it("does nothing when the landing row is itself selected", () => {
    // The request has no meaning; guessing would move rows the user did not
    // ask about.
    expect(ids(moveSelected(list, new Set(["a", "d"]), { to: "before", id: "d" }))).toBe("abcd");
  });

  it("does nothing for an empty selection", () => {
    expect(ids(moveSelected(list, new Set(), { to: "top" }))).toBe("abcd");
  });

  it("moves the null option like any other row", () => {
    // It used to be pinned to index 0. The engine locates it by the `is_null`
    // flag and never by position, so the pin only cost the user a row they
    // could not sort.
    const withNull = [{ id: "n", is_null: true } as OptionLike, ...list];
    expect(ids(moveSelected(withNull, new Set(["n"]), { to: "bottom" }))).toBe("abcdn");
    expect(ids(moveSelected(withNull, new Set(["c"]), { to: "top" }))).toBe("cnabd");
  });

  it("returns a new array and leaves the input alone", () => {
    const out = moveSelected(list, new Set(["a"]), { to: "bottom" });
    expect(out).not.toBe(list);
    expect(ids(list)).toBe("abcd");
  });
});

describe("nudge", () => {
  const list = [opt("a", "A"), opt("b", "B"), opt("c", "C")];
  const ids = (l: readonly OptionLike[]) => l.map((o) => o.id).join("");

  it("moves one step up and down", () => {
    expect(ids(nudge(list, "b", -1))).toBe("bac");
    expect(ids(nudge(list, "b", 1))).toBe("acb");
  });

  it("stops at the ends instead of wrapping", () => {
    expect(ids(nudge(list, "a", -1))).toBe("abc");
    expect(ids(nudge(list, "c", 1))).toBe("abc");
  });

  it("swaps with the null option like any other neighbour", () => {
    const withNull = [{ id: "n", is_null: true } as OptionLike, ...list];
    expect(ids(nudge(withNull, "a", -1))).toBe("anbc");
    expect(ids(nudge(withNull, "n", 1))).toBe("anbc");
  });
});
