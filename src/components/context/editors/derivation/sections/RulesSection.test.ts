// Derivation RulesSection — per-rule enable toggle + read-only
// summary of condition/branches. Library editing happens in SPA;
// modal exposes only `instance.disabled_rule_ids` overrides.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RulesSection from "./RulesSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

interface DerivationBranch {
  condition: { var: string; op: string; value: string };
  action: { target_var: string; mode: string; value: string };
}
interface DerivationRule {
  id: string;
  branches: DerivationBranch[];
  else?: { action: { target_var: string; mode: string; value: string } };
}

function makeRule(over: Partial<DerivationRule> = {}): DerivationRule {
  return {
    id: "r1",
    branches: [{
      condition: { var: "color", op: "equals", value: "red" },
      action: { target_var: "mood", mode: "replace", value: "warm" },
    }],
    ...over,
  };
}

function makeModule(rules: DerivationRule[], instance: ModuleEntry["instance"] = {}): ModuleEntry {
  return {
    id: "dv012345",
    type: "derivation",
    enabled: true,
    meta: { name: "rules" },
    entries: [],
    payload: { rules },
    instance,
  };
}

describe("derivation RulesSection", () => {
  it("renders one row per rule", () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([makeRule({ id: "r1" }), makeRule({ id: "r2" })]) },
    });
    expect(w.findAll('[data-test^="rule-row-"]')).toHaveLength(2);
  });

  it("empty state when no rules", () => {
    const w = mount(RulesSection, { props: { module: makeModule([]) } });
    expect(w.find('[data-test="rules-empty"]').exists()).toBe(true);
  });

  it("renders SPA hint pointing user to library editor for rule edits", () => {
    const w = mount(RulesSection, { props: { module: makeModule([makeRule()]) } });
    expect(w.find('[data-test="rules-spa-hint"]').exists()).toBe(true);
  });

  it("each row has an enable toggle reflecting disabled_rule_ids", () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule(
          [makeRule({ id: "r1" }), makeRule({ id: "r2" })],
          { disabled_rule_ids: ["r2"] },
        ),
      },
    });
    const r1 = w.find<HTMLInputElement>('[data-test="rule-toggle-r1"]').element;
    const r2 = w.find<HTMLInputElement>('[data-test="rule-toggle-r2"]').element;
    expect(r1.getAttribute("aria-checked")).toBe("true");
    expect(r2.getAttribute("aria-checked")).toBe("false");
  });

  it("toggling rule off emits disabled_rule_ids = [id]", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([makeRule({ id: "r1" })]) },
    });
    await w.find('[data-test="rule-toggle-r1"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.disabled_rule_ids).toEqual(["r1"]);
  });

  it("toggling rule back on collapses disabled_rule_ids to null when empty", async () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([makeRule({ id: "r1" })], { disabled_rule_ids: ["r1"] }),
      },
    });
    await w.find('[data-test="rule-toggle-r1"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.disabled_rule_ids).toBeNull();
  });

  it("rule summary includes condition var + op + value + target", () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([makeRule({ id: "r1" })]) },
    });
    const summary = w.find('[data-test="rule-summary-r1"]').text();
    expect(summary).toContain("$color");
    expect(summary).toContain("red");
    expect(summary).toContain("$mood");
  });

  it("rule with multi-branch shows '+N elif' chip", () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([makeRule({
          id: "r1",
          branches: [
            { condition: { var: "x", op: "equals", value: "1" }, action: { target_var: "y", mode: "replace", value: "a" } },
            { condition: { var: "x", op: "equals", value: "2" }, action: { target_var: "y", mode: "replace", value: "b" } },
            { condition: { var: "x", op: "equals", value: "3" }, action: { target_var: "y", mode: "replace", value: "c" } },
          ],
        })]),
      },
    });
    expect(w.find('[data-test="rule-elif-count-r1"]').text()).toContain("2");
  });

  it("rule with else clause shows 'else' indicator", () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([makeRule({
          id: "r1",
          else: { action: { target_var: "mood", mode: "replace", value: "neutral" } },
        })]),
      },
    });
    expect(w.find('[data-test="rule-else-r1"]').exists()).toBe(true);
  });
});
