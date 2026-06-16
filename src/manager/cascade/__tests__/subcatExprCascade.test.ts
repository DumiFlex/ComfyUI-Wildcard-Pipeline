import { describe, it, expect } from "vitest";

import {
  collectTags,
  removeSubcatFromExpr,
  renameSubcatInExpr,
} from "../subcatExprCascade";

describe("subcat expr cascade", () => {
  it("rename rewrites the token, preserving structure", () => {
    expect(renameSubcatInExpr("(red or pink) and not cold", "cold", "chilly"))
      .toBe("(red or pink) and not chilly");
    expect(renameSubcatInExpr("warm", "warm", "hot")).toBe("hot");
  });

  it("rename leaves non-matching tags alone", () => {
    expect(renameSubcatInExpr("warm or cold", "blue", "azure")).toBe("warm or cold");
  });

  it("remove collapses the operator", () => {
    expect(removeSubcatFromExpr("warm or cold", "cold")).toBe("warm");
    expect(removeSubcatFromExpr("warm and cold", "warm")).toBe("cold");
    expect(removeSubcatFromExpr("warm", "warm")).toBe(""); // empty => no filter
  });

  it("remove drops a whole not-group and collapses parents", () => {
    expect(removeSubcatFromExpr("(red or pink) and not cold", "cold"))
      .toBe("red or pink");
    expect(removeSubcatFromExpr("not cold", "cold")).toBe("");
  });

  it("empty expression is a no-op", () => {
    expect(renameSubcatInExpr("", "a", "b")).toBe("");
    expect(removeSubcatFromExpr("", "a")).toBe("");
  });
});

describe("collectTags", () => {
  it("collects every distinct tag across operators", () => {
    expect(collectTags("warm or intense").sort()).toEqual(["intense", "warm"]);
    expect(collectTags("(red or pink) and not cold").sort())
      .toEqual(["cold", "pink", "red"]);
  });

  it("collects the tag inside a negation", () => {
    expect(collectTags("not warm")).toEqual(["warm"]);
  });

  it("dedupes repeated tags", () => {
    expect(collectTags("warm or warm")).toEqual(["warm"]);
  });

  it("returns no tags for an empty or malformed expression", () => {
    expect(collectTags("")).toEqual([]);
    expect(collectTags("warm and")).toEqual([]); // parse error → no tags
  });
});
