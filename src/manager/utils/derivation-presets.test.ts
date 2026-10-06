import { describe, it, expect } from "vitest";
import { loraByModelRule } from "./derivation-presets";
import { clauseActions } from "../../extension/derivation-conditions";

describe("loraByModelRule", () => {
  it("branches on $model_variant and writes $loras", () => {
    const rule = loraByModelRule("r_1");
    expect(rule.id).toBe("r_1");
    expect(rule.branches.map((b) => b.condition)).toEqual([
      { var: "model_variant", op: "equals", value: "pony" },
      { var: "model_variant", op: "equals", value: "illustrious" },
    ]);
    for (const b of rule.branches) {
      expect(clauseActions(b).map((a) => a.target_var)).toEqual(["loras"]);
    }
    expect(rule.else?.action).toEqual({ target_var: "loras", mode: "replace", value: "" });
  });

});
