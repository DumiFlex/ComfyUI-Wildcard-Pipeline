import { describe, it, expect } from "vitest";
import { pruneStaleInstanceRefs } from "./prune";

describe("pruneStaleInstanceRefs — wildcard", () => {
  const newPayload = {
    options: [{ id: "a", value: "x" }, { id: "b", value: "y" }],
    sub_categories: ["cat1", "cat2"],
  };

  it("drops stale enabled_options ids, keeps valid ones, emits warnings", () => {
    const inst = { enabled_options: ["a", "ghost1", "ghost2"] };
    const result = pruneStaleInstanceRefs(inst, newPayload, "wildcard");
    expect(result.instance?.enabled_options).toEqual(["a"]);
    expect(result.warnings.length).toBe(2);
  });

  it("drops stale option_weights keys", () => {
    const inst = { option_weights: { a: 2, ghost: 5 } };
    const result = pruneStaleInstanceRefs(inst, newPayload, "wildcard");
    expect(result.instance?.option_weights).toEqual({ a: 2 });
    expect(result.warnings.length).toBe(1);
  });

  it("clears pinned_option_id + resets mode to random when stale", () => {
    const inst = { pinned_option_id: "ghost", mode: "pinned" as const };
    const result = pruneStaleInstanceRefs(inst, newPayload, "wildcard");
    expect(result.instance?.pinned_option_id).toBeNull();
    expect(result.instance?.mode).toBe("random");
    expect(result.warnings.length).toBe(1);
  });

  it("drops stale category_filter values", () => {
    const inst = { category_filter: ["cat1", "ghost"] };
    const result = pruneStaleInstanceRefs(inst, newPayload, "wildcard");
    expect(result.instance?.category_filter).toEqual(["cat1"]);
    expect(result.warnings.length).toBe(1);
  });

  it("preserves _ui content untouched", () => {
    const inst = { _ui: { last_locked_seed: 99 }, enabled_options: ["ghost"] };
    const result = pruneStaleInstanceRefs(inst, newPayload, "wildcard");
    expect(result.instance?._ui?.last_locked_seed).toBe(99);
  });

  it("returns empty warnings when no refs are stale", () => {
    const inst = { enabled_options: ["a", "b"], option_weights: { a: 2 } };
    const result = pruneStaleInstanceRefs(inst, newPayload, "wildcard");
    expect(result.warnings).toEqual([]);
  });
});

describe("pruneStaleInstanceRefs — derivation", () => {
  it("drops stale disabled_rule_ids", () => {
    const inst = { disabled_rule_ids: ["r1", "ghost"] };
    const newPayload = { rules: [{ id: "r1" }, { id: "r2" }] };
    const result = pruneStaleInstanceRefs(inst, newPayload, "derivation");
    expect(result.instance?.disabled_rule_ids).toEqual(["r1"]);
    expect(result.warnings.length).toBe(1);
  });
});

describe("pruneStaleInstanceRefs — constraint", () => {
  const newPayload = {
    matrix: { s1: { t1: { mode: "allow", factor: 1 } } },
    exceptions: [{ source_value: "red", target_value: "blue" }],
  };

  it("drops stale matrix cell keys", () => {
    const inst = {
      disabled_matrix_cells: ['["s1","t1"]', '["ghost","ghost"]'],
    };
    const result = pruneStaleInstanceRefs(inst, newPayload, "constraint");
    expect(result.instance?.disabled_matrix_cells).toEqual(['["s1","t1"]']);
    expect(result.warnings.length).toBe(1);
  });

  it("drops stale exception keys", () => {
    const inst = {
      disabled_exception_keys: ['["red","blue"]', '["x","y"]'],
    };
    const result = pruneStaleInstanceRefs(inst, newPayload, "constraint");
    expect(result.instance?.disabled_exception_keys).toEqual(['["red","blue"]']);
    expect(result.warnings.length).toBe(1);
  });
});

describe("pruneStaleInstanceRefs — constraint tier-D overrides", () => {
  const newPayload = {
    matrix: {
      s1: { t1: { mode: "allow", factor: 1 }, t2: { mode: "boost", factor: 2 } },
    },
    exceptions: [
      { source_value: "red", target_value: "blue", mode: "allow", factor: 1 },
    ],
  };

  it("drops stale cell_mode_overrides keys", () => {
    const inst = {
      cell_mode_overrides: {
        '["s1","t1"]': "exclude" as const,
        '["ghost","ghost"]': "boost" as const,
      },
    };
    const result = pruneStaleInstanceRefs(inst, newPayload, "constraint");
    expect(result.instance?.cell_mode_overrides).toEqual({ '["s1","t1"]': "exclude" });
    expect(result.warnings.length).toBe(1);
  });

  it("drops stale cell_factor_overrides keys", () => {
    const inst = {
      cell_factor_overrides: { '["s1","t1"]': 3, '["ghost","ghost"]': 5 },
    };
    const result = pruneStaleInstanceRefs(inst, newPayload, "constraint");
    expect(result.instance?.cell_factor_overrides).toEqual({ '["s1","t1"]': 3 });
    expect(result.warnings.length).toBe(1);
  });

  it("drops stale exception_mode_overrides keys", () => {
    const inst = {
      exception_mode_overrides: {
        '["red","blue"]': "boost" as const,
        '["x","y"]': "allow" as const,
      },
    };
    const result = pruneStaleInstanceRefs(inst, newPayload, "constraint");
    expect(result.instance?.exception_mode_overrides).toEqual({ '["red","blue"]': "boost" });
    expect(result.warnings.length).toBe(1);
  });

  it("drops stale exception_factor_overrides keys", () => {
    const inst = {
      exception_factor_overrides: { '["red","blue"]': 2, '["x","y"]': 4 },
    };
    const result = pruneStaleInstanceRefs(inst, newPayload, "constraint");
    expect(result.instance?.exception_factor_overrides).toEqual({ '["red","blue"]': 2 });
    expect(result.warnings.length).toBe(1);
  });

  it("never prunes extra_exceptions (instance-owned by definition)", () => {
    const inst = {
      extra_exceptions: [
        { source_value: "fake", target_value: "phantom", mode: "exclude" as const, factor: 1 },
      ],
    };
    const result = pruneStaleInstanceRefs(inst, newPayload, "constraint");
    expect(result.instance?.extra_exceptions).toHaveLength(1);
    expect(result.warnings.length).toBe(0);
  });

  it("collapses fully-stale override maps to null", () => {
    const inst = {
      cell_mode_overrides: { '["ghost","ghost"]': "exclude" as const },
    };
    const result = pruneStaleInstanceRefs(inst, newPayload, "constraint");
    expect(result.instance?.cell_mode_overrides).toBeNull();
  });
});
