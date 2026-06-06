import { describe, it, expect } from "vitest";

import { removeSubcatFromExpr, renameSubcatInExpr } from "../subcatExprCascade";

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
