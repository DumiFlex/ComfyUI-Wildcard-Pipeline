import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DerivationRuleCard from "../components/DerivationRuleCard.vue";
import RichTextInput from "../components/RichTextInput.vue";
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

  it("op dropdown lists 6 visible base ops (refinement surfaced via segmented switch)", () => {
    // 2026-05-24 final design: dropdown shows 4 compare ops + 2 presence
    // ops. When `exists` is selected an inline segmented switch appears
    // with positions any / is empty / has value, mapping to ops
    // exists / is_empty / is_set respectively. `not_exists` has no
    // refinement (no value to check when key is absent).
    const wrap = mountCard(makeRule(), 0);
    const selectComp = wrap.find('[data-test="cond-op-0-0"]')
      .findComponent({ name: "Select" });
    const opts = selectComp.props("options") as Array<{ value: string }>;
    const values = opts.map((o) => o.value);
    expect(values).toEqual([
      "equals", "not_equals", "contains", "matches", "exists", "not_exists",
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

  it("condition value input is disabled (grayed) when op = is_empty", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_empty", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    const valueInput = wrap.find('[data-test="cond-value-0-0"]');
    expect(valueInput.classes()).toContain("dvr-value-input--disabled");
  });

  it("condition value input is disabled when op = is_not_empty", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_not_empty", value: "" },
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
    // Bug #1: action values are @{} carriers post-Layer-A → hint advertises it.
    expect(hint.text()).toContain("@{");
  });

  // ── Bug #1: action values reuse the wildcard @{} nested-ref machinery ──

  it("action + ELSE value inputs get allowNestedRefs + ref-data; condition value does NOT", () => {
    const wrap = mount(DerivationRuleCard, {
      props: {
        modelValue: makeRule({
          else: { action: { target_var: "o", mode: "replace", value: "e" } },
        }),
        index: 0,
        varSuggestions: ["mood"],
        refSuggestions: ["aabbccdd"],
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm"]]]),
        uuidToHasNull: new Map([["aabbccdd", false]]),
        uuidToOptionsCount: new Map([["aabbccdd", 3]]),
        uuidToOptionTagSets: new Map([["aabbccdd", [["warm"]]]]),
        uuidToTagGroups: new Map([["aabbccdd", {}]]),
      },
    });
    const rtis = wrap.findAllComponents(RichTextInput);
    const byTest = (t: string) => rtis.find((c) => c.attributes("data-test") === t);

    const condVal = byTest("cond-value-0-0");
    const actVal = byTest("act-value-0-0");
    const elseVal = byTest("else-value-0");
    expect(condVal).toBeDefined();
    expect(actVal).toBeDefined();
    expect(elseVal).toBeDefined();

    // Condition value: engine compares it RAW → no @{} carrier machinery.
    expect(condVal!.props("allowNestedRefs")).toBeFalsy();

    // Action + ELSE values: @{} carriers → reuse the full wildcard machinery.
    for (const rti of [actVal!, elseVal!]) {
      expect(rti.props("allowNestedRefs")).toBe(true);
      expect(rti.props("refSuggestions")).toEqual(["aabbccdd"]);
      expect(rti.props("uuidToSubCategories")).toBeInstanceOf(Map);
      expect(rti.props("uuidToHasNull")).toBeInstanceOf(Map);
      expect(rti.props("uuidToOptionsCount")).toBeInstanceOf(Map);
      expect(rti.props("uuidToOptionTagSets")).toBeInstanceOf(Map);
      expect(rti.props("uuidToTagGroups")).toBeInstanceOf(Map);
    }
  });

  // ── 2026-05-24 final design: segmented refinement under `exists` ──

  it("refinement switch renders when op = exists", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "exists", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    expect(wrap.find('[data-test="cond-refinement-0-0"]').exists()).toBe(true);
  });

  it("refinement switch is hidden for compare ops + not_exists", () => {
    for (const op of ["equals", "not_equals", "contains", "matches", "not_exists"] as const) {
      const rule = makeRule({
        branches: [{
          condition: { var: "x", op, value: "" },
          action: { target_var: "out", mode: "replace", value: "v" },
        }],
      });
      const wrap = mountCard(rule, 0);
      expect(wrap.find('[data-test="cond-refinement-0-0"]').exists()).toBe(false);
    }
  });

  it("'any' position is active when saved op is bare exists", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "exists", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    expect(wrap.find('[data-test="cond-refinement-any-0-0"]').classes())
      .toContain("dvr-refinement__btn--active");
  });

  it("'is empty' position is active when saved op is is_empty", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_empty", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    const sel = wrap.find('[data-test="cond-op-0-0"]').findComponent({ name: "Select" });
    // Dropdown shows bare `exists`; refinement captures the variant.
    expect(sel.props("modelValue")).toBe("exists");
    expect(wrap.find('[data-test="cond-refinement-empty-0-0"]').classes())
      .toContain("dvr-refinement__btn--active");
  });

  it("'has value' position is active when saved op is is_set", () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_set", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    expect(wrap.find('[data-test="cond-refinement-value-0-0"]').classes())
      .toContain("dvr-refinement__btn--active");
  });

  it("clicking 'is empty' on a bare exists rule emits is_empty", async () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "exists", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    await wrap.find('[data-test="cond-refinement-empty-0-0"]').trigger("click");
    const events = wrap.emitted("update:modelValue") ?? [];
    const next = events[events.length - 1][0] as DerivationRule;
    expect(next.branches[0].condition.op).toBe("is_empty");
  });

  it("clicking 'has value' on a bare exists rule emits is_set", async () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "exists", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    await wrap.find('[data-test="cond-refinement-value-0-0"]').trigger("click");
    const events = wrap.emitted("update:modelValue") ?? [];
    const next = events[events.length - 1][0] as DerivationRule;
    expect(next.branches[0].condition.op).toBe("is_set");
  });

  it("clicking 'any' on an is_empty rule reverts to bare exists", async () => {
    const rule = makeRule({
      branches: [{
        condition: { var: "x", op: "is_empty", value: "" },
        action: { target_var: "out", mode: "replace", value: "v" },
      }],
    });
    const wrap = mountCard(rule, 0);
    await wrap.find('[data-test="cond-refinement-any-0-0"]').trigger("click");
    const events = wrap.emitted("update:modelValue") ?? [];
    const next = events[events.length - 1][0] as DerivationRule;
    expect(next.branches[0].condition.op).toBe("exists");
  });

  // ── 2026-05-10 follow-up: var autocomplete uses RichTextInput popover style ──

  // ── 2026-05-10 follow-up: var autocomplete uses RichTextInput popover style ──

  it("WHEN var input renders the inner <input> via VarAutocompleteInput", () => {
    const wrap = mount(DerivationRuleCard, {
      props: {
        modelValue: makeRule(),
        index: 0,
        varSuggestions: ["age", "color", "mood"],
      },
    });
    // VarAutocompleteInput forwards data-test to its inner <input>;
    // both the wrapping element AND the component own the prop.
    const condVar = wrap.find('[data-test="cond-var-0-0"]');
    expect(condVar.exists()).toBe(true);
    expect(condVar.element.tagName).toBe("INPUT");
  });

  it("each var input is a VarAutocompleteInput with suggestions plumbed", () => {
    const wrap = mount(DerivationRuleCard, {
      props: {
        modelValue: makeRule({
          else: { action: { target_var: "out", mode: "replace", value: "x" } },
        }),
        index: 0,
        varSuggestions: ["age", "color", "mood"],
      },
    });
    const allAc = wrap.findAllComponents({ name: "VarAutocompleteInput" });
    // 3 var inputs per rule: condition.var + action.target_var + else.target_var
    expect(allAc).toHaveLength(3);
    for (const ac of allAc) {
      expect(ac.props("suggestions")).toEqual(["age", "color", "mood"]);
    }
  });

  it("native browser datalist is no longer rendered (replaced by custom popover)", () => {
    const wrap = mountCard(makeRule(), 0);
    expect(wrap.find("datalist").exists()).toBe(false);
  });

  describe("collapse (#9)", () => {
    // v-show toggles an inline `display: none`; assert on that directly since
    // isVisible() is unreliable under jsdom for v-show.
    const hidden = (w: { attributes: (n: string) => string | undefined }) =>
      (w.attributes("style") ?? "").includes("display: none");

    it("branches start collapsed; the chevron toggles the body + peek", async () => {
      const wrap = mountCard(makeRule(), 0);
      const body = () => wrap.find('[data-test="branch-0-0"] .branch-body');
      // Collapsed by default → body hidden, peek shown.
      expect(hidden(body())).toBe(true);
      expect(wrap.find('[data-test="branch-peek-0-0"]').text()).toBe("$x → $out");
      // Expand.
      await wrap.get('[data-test="toggle-branch-0-0"]').trigger("click");
      expect(hidden(body())).toBe(false);
      expect(wrap.find('[data-test="branch-peek-0-0"]').exists()).toBe(false);
    });

    it("per-rule collapse/expand-all-branches buttons toggle every branch", async () => {
      const wrap = mountCard(makeRule(), 0);
      const body = () => wrap.find('[data-test="branch-0-0"] .branch-body');
      // Expand all first (default is collapsed), then collapse all again.
      await wrap.get('[data-test="expand-branches-0"]').trigger("click");
      expect(hidden(body())).toBe(false);
      await wrap.get('[data-test="collapse-branches-0"]').trigger("click");
      expect(hidden(body())).toBe(true);
    });

    it("adopts the collapseCommand broadcast (Collapse all / Expand all)", async () => {
      const wrap = mount(DerivationRuleCard, {
        props: {
          modelValue: makeRule(),
          index: 0,
          collapseCommand: { nonce: 0, collapsed: false },
        },
      });
      const branches = () => wrap.find(".branches");
      expect(hidden(branches())).toBe(false);
      await wrap.setProps({ collapseCommand: { nonce: 1, collapsed: true } });
      expect(hidden(branches())).toBe(true);
      await wrap.setProps({ collapseCommand: { nonce: 2, collapsed: false } });
      expect(hidden(branches())).toBe(false);
    });
  });
});
