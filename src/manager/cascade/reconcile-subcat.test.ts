import { describe, expect, it } from "vitest";
import { reconcileSubcatExpr } from "./reconcile-subcat";

describe("reconcileSubcatExpr", () => {
  it("keeps tokens present in the picked wildcard's sub_categories", () => {
    const r = reconcileSubcatExpr("warm or cold", ["warm", "cold", "vivid"]);
    expect(r.survivingExpr).toBe("warm or cold");
    expect(r.dropped).toEqual([]);
  });

  it("drops unknown tokens and lists them", () => {
    const r = reconcileSubcatExpr("warm or neon", ["warm", "cold"]);
    expect(r.dropped).toEqual(["neon"]);
    // surviving expr keeps the valid token; the dangling operator is pruned
    expect(r.survivingExpr).toBe("warm");
  });

  it("preserves operators and parens around surviving tokens", () => {
    const r = reconcileSubcatExpr("warm and (cold or vivid)", ["warm", "cold", "vivid"]);
    expect(r.dropped).toEqual([]);
    expect(r.survivingExpr).toBe("warm and (cold or vivid)");
  });

  it("drops ALL tokens when the wildcard declares none (empty allowed set)", () => {
    const r = reconcileSubcatExpr("warm or cold", []);
    expect(r.dropped).toEqual(["warm", "cold"]);
    expect(r.survivingExpr).toBe("");
  });

  it("treats reserved 'null' as universal — never dropped", () => {
    const r = reconcileSubcatExpr("null", ["warm"]);
    expect(r.dropped).toEqual([]);
    expect(r.survivingExpr).toBe("null");
  });

  it("returns empty for an empty expression", () => {
    expect(reconcileSubcatExpr("", ["warm"])).toEqual({ survivingExpr: "", dropped: [] });
  });
});
