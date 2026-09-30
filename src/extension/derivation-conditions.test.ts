import { describe, it, expect } from "vitest";
import {
  conditionLeaves,
  conditionOverrideKey,
  evalConditionTree,
  flipConnector,
  isConditionGroup,
  matchWord,
  simplifyCondition,
  type ConditionGroup,
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

  it("merges a nested group that shares its parent's connector", () => {
    const n: ConditionNode = {
      match: "all",
      conditions: [t("a"), { match: "all", conditions: [t("b"), t("c")] }],
    };
    expect(simplifyCondition(n)).toEqual({ match: "all", conditions: [t("a"), t("b"), t("c")] });
  });

  describe("flipConnector", () => {
    const all3: ConditionGroup = { match: "all", conditions: [t("a"), t("b"), t("c")] };
    const any3: ConditionGroup = { match: "any", conditions: [t("a"), t("b"), t("c")] };

    it("flips a two-test group outright", () => {
      expect(flipConnector({ match: "all", conditions: [t("a"), t("b")] }, 1))
        .toEqual({ match: "any", conditions: [t("a"), t("b")] });
    });

    it("AND → OR splits the AND run at that connector", () => {
      expect(flipConnector(all3, 2)).toEqual({
        match: "any",
        conditions: [{ match: "all", conditions: [t("a"), t("b")] }, t("c")],
      });
      expect(flipConnector(all3, 1)).toEqual({
        match: "any",
        conditions: [t("a"), { match: "all", conditions: [t("b"), t("c")] }],
      });
    });

    it("OR → AND binds just the two sides of that connector", () => {
      expect(flipConnector(any3, 2)).toEqual({
        match: "any",
        conditions: [t("a"), { match: "all", conditions: [t("b"), t("c")] }],
      });
    });

    it("flipping the same connector back restores the group", () => {
      const once = flipConnector(any3, 2) as ConditionGroup;
      const inner = once.conditions[1] as ConditionGroup;
      const back = simplifyCondition({ ...once, conditions: [once.conditions[0], flipConnector(inner, 1)] });
      expect(back).toEqual(any3);
      const split = flipConnector(all3, 2) as ConditionGroup;
      expect(flipConnector(split, 1)).toEqual(all3);
    });

    it("keeps test order and ignores a position with no connector", () => {
      expect(conditionLeaves(flipConnector(all3, 2))).toEqual([t("a"), t("b"), t("c")]);
      expect(flipConnector(all3, 0)).toBe(all3);
      expect(flipConnector(all3, 3)).toBe(all3);
    });
  });

  it("names the connector", () => {
    expect(matchWord("all")).toBe("AND");
    expect(matchWord("any")).toBe("OR");
  });
});
