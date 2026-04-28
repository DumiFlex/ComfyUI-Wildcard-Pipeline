import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DerivationRuleCard from "../components/DerivationRuleCard.vue";
import type { DerivationRule } from "../api/types";

function makeRule(overrides: Partial<DerivationRule> = {}): DerivationRule {
  return {
    id: "r_1",
    branches: [
      {
        condition: { var: "x", op: "equals", value: "y" },
        action: { target_var: "out", mode: "replace", value: "v" },
      },
    ],
    ...overrides,
  };
}

function mountCard(rule: DerivationRule, index = 0) {
  return mount(DerivationRuleCard, {
    props: { modelValue: rule, index },
    global: { plugins: [] },
  });
}

describe("DerivationRuleCard.vue", () => {
  it("renders Rule label with index+1 and IF tag for the first branch", () => {
    const wrap = mountCard(makeRule(), 0);
    expect(wrap.text()).toContain("Rule 1");
    expect(wrap.text()).toContain("IF");
    // Single branch => no ELIF tag
    expect(wrap.text()).not.toContain("ELIF");
  });

  it("renders ELIF labels for branches after the first", () => {
    const wrap = mountCard(
      makeRule({
        branches: [
          {
            condition: { var: "x", op: "equals", value: "a" },
            action: { target_var: "out", mode: "replace", value: "1" },
          },
          {
            condition: { var: "x", op: "equals", value: "b" },
            action: { target_var: "out", mode: "replace", value: "2" },
          },
          {
            condition: { var: "x", op: "equals", value: "c" },
            action: { target_var: "out", mode: "replace", value: "3" },
          },
        ],
      }),
      2,
    );
    expect(wrap.text()).toContain("Rule 3");
    expect(wrap.text()).toContain("IF");
    // Two ELIF branches → at least one ELIF label rendered
    const html = wrap.html();
    const elifMatches = html.match(/ELIF/g) ?? [];
    expect(elifMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("Add elif emits a new rule with one extra branch", async () => {
    const rule = makeRule();
    const wrap = mountCard(rule, 0);
    await wrap.find('[data-test="add-elif-0"]').trigger("click");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events.length).toBe(1);
    const next = events[0][0] as DerivationRule;
    expect(next.branches.length).toBe(2);
    // First branch unchanged
    expect(next.branches[0].condition.var).toBe("x");
    // New branch has default condition
    expect(next.branches[1].condition.op).toBe("equals");
    expect(next.branches[1].action.mode).toBe("replace");
  });

  it("Add else emits a rule with rule.else populated", async () => {
    const wrap = mountCard(makeRule(), 0);
    expect(wrap.find('[data-test="add-else-0"]').exists()).toBe(true);
    await wrap.find('[data-test="add-else-0"]').trigger("click");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events.length).toBe(1);
    const next = events[0][0] as DerivationRule;
    expect(next.else).toBeDefined();
    expect(next.else?.action.mode).toBe("replace");
    expect(next.else?.action.target_var).toBe("");
  });

  it("Remove else emits a rule without rule.else", async () => {
    const ruleWithElse = makeRule({
      else: {
        action: { target_var: "out", mode: "append", value: "z" },
      },
    });
    const wrap = mountCard(ruleWithElse, 0);
    // The "Add else" button is hidden when else already exists
    expect(wrap.find('[data-test="add-else-0"]').exists()).toBe(false);
    expect(wrap.find('[data-test="remove-else-0"]').exists()).toBe(true);
    await wrap.find('[data-test="remove-else-0"]').trigger("click");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events.length).toBe(1);
    const next = events[0][0] as DerivationRule;
    expect(next.else).toBeUndefined();
  });

  it("Remove rule emits the remove event", async () => {
    const wrap = mountCard(makeRule(), 4);
    await wrap.find('[data-test="remove-rule-4"]').trigger("click");
    expect(wrap.emitted("remove")).toBeDefined();
    expect((wrap.emitted("remove") ?? []).length).toBe(1);
  });

  it("Remove ELIF branch emits a rule with that branch dropped", async () => {
    const rule = makeRule({
      branches: [
        {
          condition: { var: "x", op: "equals", value: "a" },
          action: { target_var: "out", mode: "replace", value: "1" },
        },
        {
          condition: { var: "x", op: "equals", value: "b" },
          action: { target_var: "out", mode: "replace", value: "2" },
        },
      ],
    });
    const wrap = mountCard(rule, 0);
    await wrap.find('[data-test="remove-elif-0-1"]').trigger("click");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events.length).toBe(1);
    const next = events[0][0] as DerivationRule;
    expect(next.branches.length).toBe(1);
    expect(next.branches[0].condition.value).toBe("a");
  });
});
