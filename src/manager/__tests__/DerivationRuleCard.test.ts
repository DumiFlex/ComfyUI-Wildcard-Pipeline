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

  // ── 2026-05-09 redesign: compact grid + presence ops + UX polish ────

  it("renders $ prefix on var inputs (matches IdentitySection idiom)", () => {
    const wrap = mountCard(makeRule(), 0);
    // Every var-input wrap has a $ prefix span. Two per branch (condition + action).
    const prefixes = wrap.findAll(".dvr-prefix");
    expect(prefixes.length).toBeGreaterThanOrEqual(2);
    expect(prefixes[0].text()).toBe("$");
  });

  it("op dropdown lists 6 visible ops (is_set/is_unset surfaced via tick mark)", () => {
    // 2026-05-10 UX shift: dropdown only shows 4 compare ops + the 2
    // presence-base ops. `is_set`/`is_unset` are hidden — the user
    // surfaces them via a "must have value" tick checkbox shown next
    // to `exists`/`not_exists`. Engine still accepts all 8 ops.
    const wrap = mountCard(makeRule(), 0);
    const selectComp = wrap.find('[data-test="cond-op-0-0"]')
      .findComponent({ name: "Select" });
    const opts = selectComp.props("options") as Array<{ value: string }>;
    const values = opts.map((o) => o.value);
    expect(values).toEqual([
      "equals", "not_equals", "contains", "matches",
      "exists", "not_exists",
    ]);
  });

  it("each op option carries a tooltip via title attribute", () => {
    const wrap = mountCard(makeRule(), 0);
    const selectComp = wrap.find('[data-test="cond-op-0-0"]')
      .findComponent({ name: "Select" });
    const opts = selectComp.props("options") as Array<{ title?: string; value: string }>;
    // Every op has a tooltip; matches op tooltip references regex.
    for (const opt of opts) {
      expect(typeof opt.title).toBe("string");
      expect(opt.title!.length).toBeGreaterThan(0);
    }
    const matchesOpt = opts.find((o) => o.value === "matches")!;
    expect(matchesOpt.title!.toLowerCase()).toMatch(/regex/);
  });

  it("condition value input is enabled when op is a compare op", () => {
    const wrap = mountCard(makeRule(), 0);  // op = "equals"
    const valueInput = wrap.find('[data-test="cond-value-0-0"]');
    expect(valueInput.classes()).not.toContain("dvr-value-input--disabled");
  });

  it("condition value input is disabled (grayed) when op = exists", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "exists", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    const valueInput = wrap.find('[data-test="cond-value-0-0"]');
    expect(valueInput.classes()).toContain("dvr-value-input--disabled");
  });

  it("condition value input is disabled when op = is_unset", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_unset", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    const valueInput = wrap.find('[data-test="cond-value-0-0"]');
    expect(valueInput.classes()).toContain("dvr-value-input--disabled");
  });

  it("regex101 help link appears only when op = matches", () => {
    const equalsRule = makeRule();
    expect(mountCard(equalsRule, 0).find('[data-test="cond-regex-help-0-0"]').exists()).toBe(false);

    const matchesRule = makeRule({
      branches: [{
        condition: { var: "x", op: "matches", value: "^a.*z$" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(matchesRule, 0);
    const link = wrap.find('[data-test="cond-regex-help-0-0"]');
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toContain("regex101.com");
    expect(link.attributes("target")).toBe("_blank");
  });

  it("supported-syntax hint line renders below action value", () => {
    const wrap = mountCard(makeRule(), 0);
    const hint = wrap.find('[data-test="act-hint-0-0"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("$var");
    expect(hint.text()).toContain("{a|b|c}");
  });

  // ── 2026-05-10 follow-up: tick mark replaces is_set/is_unset ops ──

  it("'must have value' tick is hidden for compare ops", () => {
    const wrap = mountCard(makeRule(), 0);  // op = "equals"
    expect(wrap.find('[data-test="cond-must-have-value-0-0"]').exists()).toBe(false);
  });

  it("'must have value' tick renders for exists op (unchecked)", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "exists", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    const tick = wrap.find<HTMLInputElement>(
      '[data-test="cond-must-have-value-input-0-0"]',
    );
    expect(tick.exists()).toBe(true);
    expect(tick.element.checked).toBe(false);
  });

  it("'must have value' tick is checked when saved op is is_set", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_set", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    const tick = wrap.find<HTMLInputElement>(
      '[data-test="cond-must-have-value-input-0-0"]',
    );
    expect(tick.element.checked).toBe(true);
  });

  it("dropdown displays 'exists' (not 'is_set') when saved op is is_set", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_set", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    // Select gets the displayed op — `is_set` collapses to `exists`.
    const selectComp = wrap.find('[data-test="cond-op-0-0"]')
      .findComponent({ name: "Select" });
    expect(selectComp.props("modelValue")).toBe("exists");
  });

  it("toggling tick on (op=exists) emits op=is_set", async () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "exists", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    await wrap.find('[data-test="cond-must-have-value-input-0-0"]').trigger("change");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events.length).toBe(1);
    const next = events[0][0] as DerivationRule;
    expect(next.branches[0].condition.op).toBe("is_set");
  });

  it("toggling tick off (op=is_unset) emits op=not_exists", async () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_unset", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    await wrap.find('[data-test="cond-must-have-value-input-0-0"]').trigger("change");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events.length).toBe(1);
    const next = events[0][0] as DerivationRule;
    expect(next.branches[0].condition.op).toBe("not_exists");
  });

  // ── 2026-05-10 follow-up: datalist autocomplete on var inputs ───

  it("WHEN var input has list= attribute pointing at the rule's datalist", () => {
    const wrap = mountCard(makeRule(), 7);
    const varInput = wrap.find('[data-test="cond-var-7-0"]');
    expect(varInput.attributes("list")).toBe("dvr-vars-7");
  });

  it("THEN target_var input has list= attribute pointing at the rule's datalist", () => {
    const wrap = mountCard(makeRule(), 7);
    const targetInput = wrap.find('[data-test="act-target-7-0"]');
    expect(targetInput.attributes("list")).toBe("dvr-vars-7");
  });

  it("datalist renders one option per varSuggestion entry", () => {
    const wrap = mount(DerivationRuleCard, {
      props: {
        modelValue: makeRule(),
        index: 0,
        varSuggestions: ["age", "color", "mood"],
      },
    });
    const datalist = wrap.find("datalist");
    expect(datalist.attributes("id")).toBe("dvr-vars-0");
    const opts = datalist.findAll("option");
    expect(opts).toHaveLength(3);
    expect(opts.map((o) => o.attributes("value"))).toEqual(["age", "color", "mood"]);
  });
});
