import { describe, expect, it } from "vitest";
import {
  appendNegative,
  isBlankNegative,
  libraryVarNegatives,
  pruneBlankNegatives,
  setNegative,
} from "./negatives";

describe("setNegative / pruneBlankNegatives", () => {
  it("stores a non-blank negative and deletes the key for a blank one", () => {
    const o: { negative?: string } = {};
    setNegative(o, "fruit");
    expect(o).toEqual({ negative: "fruit" });
    setNegative(o, "   ");
    expect("negative" in o).toBe(false);
    setNegative(o, "x");
    setNegative(o, undefined);
    expect("negative" in o).toBe(false);
  });

  it("prune drops blank keys and keeps real ones", () => {
    const rows = [{ id: "a", negative: "" }, { id: "b", negative: "hat" }, { id: "c" }];
    expect(pruneBlankNegatives(rows)).toEqual([{ id: "a" }, { id: "b", negative: "hat" }, { id: "c" }]);
  });

  it("isBlankNegative", () => {
    expect(isBlankNegative(undefined)).toBe(true);
    expect(isBlankNegative(" \n")).toBe(true);
    expect(isBlankNegative("a")).toBe(false);
  });
});

describe("appendNegative", () => {
  it("joins with a comma, without doubling one", () => {
    expect(appendNegative("strawberry", "fruit")).toBe("strawberry, fruit");
    expect(appendNegative("strawberry, ", " fruit ")).toBe("strawberry, fruit");
    expect(appendNegative(undefined, "fruit")).toBe("fruit");
    expect(appendNegative("hat", "  ")).toBe("hat");
  });
});

describe("libraryVarNegatives", () => {
  const catalog = [
    {
      id: "aaaaaaaa", name: "Hair", type: "wildcard",
      payload: {
        var_binding: "hair",
        options: [
          { id: "o1", value: "strawberry blonde", negative: "strawberry, fruit" },
          { id: "o2", value: "platinum bob" },
          { id: "o3", value: "ginger", negative: "orange fruit" },
        ],
      },
    },
    { id: "bbbbbbbb", name: "Outfit", type: "wildcard", payload: { options: [{ id: "o", value: "torn", negative: "torn clothes" }] } },
    { id: "cccccccc", name: "Style", type: "fixed_values", payload: { values: [{ id: "v", name: "style", value: "oil", negative: "photo" }] } },
    { id: "dddddddd", name: "Scene", type: "combine", payload: { output_var: "scene", template: "$hair", negative: "cropped" } },
    {
      id: "eeeeeeee", name: "Mood", type: "derivation",
      payload: { rules: [{ branches: [{ action: { target_var: "mood", mode: "negative", value: "smiling" } }] }] },
    },
  ];

  it("summarises a wildcard's option negatives with counts", () => {
    expect(libraryVarNegatives(catalog, "$hair")).toEqual([{
      moduleId: "aaaaaaaa", moduleName: "Hair", kind: "wildcard",
      texts: ["strawberry, fruit", "orange fruit"], optionCount: 3, optionsWithNegative: 2,
    }]);
  });

  it("falls back to the slugged name when a wildcard has no var_binding", () => {
    expect(libraryVarNegatives(catalog, "outfit")[0]?.texts).toEqual(["torn clothes"]);
  });

  it("reads fixed values, combines and derivation negative actions", () => {
    expect(libraryVarNegatives(catalog, "style")[0]?.texts).toEqual(["photo"]);
    expect(libraryVarNegatives(catalog, "scene")[0]?.texts).toEqual(["cropped"]);
    expect(libraryVarNegatives(catalog, "mood")[0]?.texts).toEqual(["smiling"]);
  });

  it("skips the excluded module and vars nobody negates", () => {
    expect(libraryVarNegatives(catalog, "scene", "dddddddd")).toEqual([]);
    expect(libraryVarNegatives(catalog, "nothing")).toEqual([]);
  });
});
