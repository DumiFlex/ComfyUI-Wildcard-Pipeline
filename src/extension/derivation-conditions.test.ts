import { describe, it, expect } from "vitest";
import {
  conditionLeaves,
  conditionOverrideKey,
  evalConditionTree,
  isConditionGroup,
  matchWord,
  simplifyCondition,
  type ConditionNode,
} from "./derivation-conditions";

const t = (v: string, value = "") => ({ var: v, op: "equals", value });

describe("derivation condition trees", () => {
  it("tells a group from a test", () => {
    expect(isConditionGroup({ match: "all", conditions: [] })).toBe(true);
    expect(isConditionGroup(t("a"))).toBe(false);
    expect(isConditionGroup(null)).toBe(false);
  });

  it("lists tests depth-first, matching the engine's override order", () => {
    const cond = { match: "all", conditions: [t("a"), { match: "any", conditions: [t("b"), t("c")] }, t("d")] };
    expect(conditionLeaves<{ var: string }>(cond).map((l) => l.var)).toEqual(["a", "b", "c", "d"]);
    expect(conditionLeaves<{ var: string }>(t("x")).map((l) => l.var)).toEqual(["x"]);
    expect(conditionLeaves(undefined)).toEqual([]);
  });

  it("keeps the bare branch index for the first test's override key", () => {
    expect(conditionOverrideKey(2, 0)).toBe("2");
    expect(conditionOverrideKey(2, 3)).toBe("2.3");
  });

  it("evaluates AND / OR with nesting", () => {
    const ctx: Record<string, string> = { a: "1", b: "x" };
    const match = (l: { var: string; value: string }) => ctx[l.var] === l.value;
    const and = { match: "all", conditions: [t("a", "1"), t("b", "2")] };
    const or = { match: "any", conditions: [t("a", "1"), t("b", "2")] };
    expect(evalConditionTree(and, match)).toBe(false);
    expect(evalConditionTree(or, match)).toBe(true);
    expect(evalConditionTree({ match: "all", conditions: [t("a", "1"), or] }, match)).toBe(true);
    expect(evalConditionTree(t("b", "x"), match)).toBe(true);
    expect(evalConditionTree(undefined, match)).toBe(false);
  });

  it("simplifies a group of one and drops empty groups", () => {
    expect(simplifyCondition({ match: "all", conditions: [t("a")] })).toEqual(t("a"));
    const nested: ConditionNode = {
      match: "all",
      conditions: [t("a"), { match: "any", conditions: [] }, { match: "any", conditions: [t("b")] }],
    };
    expect(simplifyCondition(nested)).toEqual({ match: "all", conditions: [t("a"), t("b")] });
    expect(simplifyCondition(t("a"))).toEqual(t("a"));
  });

  it("names the connector", () => {
    expect(matchWord("all")).toBe("AND");
    expect(matchWord("any")).toBe("OR");
  });
});
