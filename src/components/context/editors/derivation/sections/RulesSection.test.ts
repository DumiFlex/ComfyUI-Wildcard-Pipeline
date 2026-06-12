// Derivation RulesSection — accordion + branch table per the
// 2026-05-10 tier-D modal expansion. Each rule renders as a card with
// expandable body; body shows IF/ELIF/ELSE rows with per-branch
// disable + condition.value override + action.value override.
//
// Library editing (rule structure) stays SPA. Modal exposes only
// per-instance overrides — no add-rule / remove-rule / edit-condition-op
// / edit-mode UI here.

import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import RulesSection from "./RulesSection.vue";
import RichTextInput from "../../../../../manager/components/RichTextInput.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

// The override fields are RichTextInput hosts loaded via defineAsyncComponent
// (lazy chunk — keeps the bundle split). `flushPromises()` resolves the async
// wrapper so `findAllComponents(RichTextInput)` matches the real instance, and
// driving the field is `vm.$emit("update:modelValue", …)` rather than the
// old `<input>` value-set + "input" event.
async function expandAndFindRti(
  w: ReturnType<typeof mount>,
  ruleId: string,
  testId: string,
) {
  await w.find(`[data-test="rule-head-${ruleId}"]`).trigger("click");
  await flushPromises();
  return w
    .findAllComponents(RichTextInput)
    .find((c) => c.attributes("data-test") === testId);
}

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

function multiRule(): DerivationRule {
  return {
    id: "r1",
    branches: [
      { condition: { var: "color", op: "equals", value: "red" }, action: { target_var: "mood", mode: "replace", value: "warm" } },
      { condition: { var: "color", op: "equals", value: "blue" }, action: { target_var: "mood", mode: "replace", value: "cool" } },
    ],
    else: { action: { target_var: "mood", mode: "replace", value: "neutral" } },
  };
}

function makeModule(
  rules: DerivationRule[],
  instance: ModuleEntry["instance"] = {},
): ModuleEntry {
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

function lastPatch(w: ReturnType<typeof mount>): Partial<ModuleEntry> {
  const updates = w.emitted("update")! as unknown[][];
  return updates[updates.length - 1][0] as Partial<ModuleEntry>;
}

describe("derivation RulesSection (tier-D accordion + branch table)", () => {
  // ── Existing baseline behaviour kept under the redesign ──────────

  it("renders one card per rule", () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([makeRule({ id: "r1" }), makeRule({ id: "r2" })]) },
    });
    expect(w.findAll('[data-test^="rule-card-"]')).toHaveLength(2);
  });

  it("empty state when no rules", () => {
    const w = mount(RulesSection, { props: { module: makeModule([]) } });
    expect(w.find('[data-test="rules-empty"]').exists()).toBe(true);
  });

  it("rule head includes summary built from first branch", () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([makeRule({ id: "r1" })]) },
    });
    const summary = w.find('[data-test="rule-summary-r1"]').text();
    expect(summary).toContain("$color");
    expect(summary).toContain("red");
    expect(summary).toContain("$mood");
  });

  it("rule toggle reflects + flips disabled_rule_ids", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([makeRule({ id: "r1" })]) },
    });
    await w.find('[data-test="rule-toggle-r1"]').trigger("click");
    expect(lastPatch(w).instance?.disabled_rule_ids).toEqual(["r1"]);
  });

  // ── Accordion behaviour ──────────────────────────────────────────

  it("rule body is collapsed by default", () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    expect(w.find('[data-test="rule-body-r1"]').exists()).toBe(false);
  });

  it("clicking rule head expands the body", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    expect(w.find('[data-test="rule-body-r1"]').exists()).toBe(true);
  });

  // ── Branch table ─────────────────────────────────────────────────

  it("expanded body shows IF + ELIF + ELSE rows for a multi-branch rule", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    expect(w.find('[data-test="branch-row-r1-0"]').exists()).toBe(true);  // IF
    expect(w.find('[data-test="branch-row-r1-1"]').exists()).toBe(true);  // ELIF
    expect(w.find('[data-test="branch-row-r1-else"]').exists()).toBe(true);  // ELSE
  });

  it("IF row has NO branch toggle checkbox (always-on, never disable-able)", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    expect(w.find('[data-test="branch-toggle-r1-0"]').exists()).toBe(false);
  });

  it("ELIF and ELSE rows both have branch toggle checkboxes", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    expect(w.find('[data-test="branch-toggle-r1-1"]').exists()).toBe(true);
    expect(w.find('[data-test="branch-toggle-r1-else"]').exists()).toBe(true);
  });

  it("toggling ELIF off emits disabled_branch_keys with 'r1:1' entry", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    await w.find('[data-test="branch-toggle-r1-1"]').trigger("click");
    expect(lastPatch(w).instance?.disabled_branch_keys).toEqual(["r1:1"]);
  });

  it("toggling ELSE off emits disabled_branch_keys with 'r1:else' entry", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    await w.find('[data-test="branch-toggle-r1-else"]').trigger("click");
    expect(lastPatch(w).instance?.disabled_branch_keys).toEqual(["r1:else"]);
  });

  it("toggling a disabled branch back on removes it from disabled_branch_keys", async () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([multiRule()], {
          disabled_branch_keys: ["r1:1", "r1:else"],
        }),
      },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    await w.find('[data-test="branch-toggle-r1-1"]').trigger("click");
    expect(lastPatch(w).instance?.disabled_branch_keys).toEqual(["r1:else"]);
  });

  it("toggling last disabled branch back on collapses to null", async () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([multiRule()], { disabled_branch_keys: ["r1:1"] }),
      },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    await w.find('[data-test="branch-toggle-r1-1"]').trigger("click");
    expect(lastPatch(w).instance?.disabled_branch_keys).toBeNull();
  });

  // ── Action.value override ────────────────────────────────────────

  it("each branch has an action.value override input", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    await flushPromises();
    const rtis = w.findAllComponents(RichTextInput);
    const has = (t: string) => rtis.some((c) => c.attributes("data-test") === t);
    expect(has("action-override-r1-0")).toBe(true);
    expect(has("action-override-r1-1")).toBe(true);
    expect(has("action-override-r1-else")).toBe(true);
  });

  it("typing into IF action override emits action_value_overrides patch", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    const input = await expandAndFindRti(w, "r1", "action-override-r1-0");
    input!.vm.$emit("update:modelValue", "fiery");
    await w.vm.$nextTick();
    const patch = lastPatch(w);
    expect(patch.instance?.action_value_overrides).toEqual({
      r1: { "0": "fiery" },
    });
  });

  it("ELSE action override uses 'else' branch_key", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    const input = await expandAndFindRti(w, "r1", "action-override-r1-else");
    input!.vm.$emit("update:modelValue", "blank");
    await w.vm.$nextTick();
    expect(lastPatch(w).instance?.action_value_overrides).toEqual({
      r1: { else: "blank" },
    });
  });

  it("clearing action override emits patch that drops the entry", async () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([multiRule()], {
          action_value_overrides: { r1: { "0": "fiery" } },
        }),
      },
    });
    const input = await expandAndFindRti(w, "r1", "action-override-r1-0");
    input!.vm.$emit("update:modelValue", "");
    await w.vm.$nextTick();
    expect(lastPatch(w).instance?.action_value_overrides).toBeNull();
  });

  // ── Condition.value override ─────────────────────────────────────

  it("IF + ELIF rows have condition.value override input; ELSE does NOT", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    await flushPromises();
    const rtis = w.findAllComponents(RichTextInput);
    const has = (t: string) => rtis.some((c) => c.attributes("data-test") === t);
    expect(has("cond-override-r1-0")).toBe(true);
    expect(has("cond-override-r1-1")).toBe(true);
    expect(has("cond-override-r1-else")).toBe(false);
  });

  it("typing into IF condition override emits condition_value_overrides patch", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    const input = await expandAndFindRti(w, "r1", "cond-override-r1-0");
    input!.vm.$emit("update:modelValue", "purple");
    await w.vm.$nextTick();
    expect(lastPatch(w).instance?.condition_value_overrides).toEqual({
      r1: { "0": "purple" },
    });
  });

  // ── Mod-count chip ───────────────────────────────────────────────

  it("mod-count chip hidden when no overrides on rule", () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([multiRule()]) },
    });
    expect(w.find('[data-test="rule-mod-count-r1"]').exists()).toBe(false);
  });

  it("mod-count chip shows total override count for the rule", () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([multiRule()], {
          action_value_overrides: { r1: { "0": "fiery" } },
          condition_value_overrides: { r1: { "0": "purple" } },
          disabled_branch_keys: ["r1:1"],
        }),
      },
    });
    const chip = w.find('[data-test="rule-mod-count-r1"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("3");
  });

  // ── Drag-to-reorder ─────────────────────────────────────────────

  it("drag handle is rendered on each rule head", () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([makeRule({ id: "r1" }), makeRule({ id: "r2" })]) },
    });
    expect(w.find('[data-test="rule-drag-r1"]').exists()).toBe(true);
    expect(w.find('[data-test="rule-drag-r2"]').exists()).toBe(true);
  });

  it("dropping rule r2 onto r1 emits rule_order_override = ['r2', 'r1']", async () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([
          makeRule({ id: "r1" }),
          makeRule({ id: "r2" }),
          makeRule({ id: "r3" }),
        ]),
      },
    });
    // Simulate dragstart on r2's handle, then drop on r1's card.
    await w.find('[data-test="rule-drag-r2"]').trigger("dragstart");
    await w.find('[data-test="rule-card-r1"]').trigger("dragover");
    await w.find('[data-test="rule-card-r1"]').trigger("drop");
    expect(lastPatch(w).instance?.rule_order_override).toEqual(["r2", "r1", "r3"]);
  });

  it("dropping rule onto itself or back into library order collapses override to null", async () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule(
          [makeRule({ id: "r1" }), makeRule({ id: "r2" })],
          { rule_order_override: ["r2", "r1"] },
        ),
      },
    });
    // Drop r2 onto r1 — moving r2 to position 0 BEFORE r1 means
    // r1 ends up at index 1 → order becomes [r2, r1] which is the
    // current state. Force back to library order via swap r1→r2:
    await w.find('[data-test="rule-drag-r1"]').trigger("dragstart");
    await w.find('[data-test="rule-card-r2"]').trigger("dragover");
    await w.find('[data-test="rule-card-r2"]').trigger("drop");
    // New order [r1, r2] = library order → collapse override to null.
    expect(lastPatch(w).instance?.rule_order_override).toBeNull();
  });

  it("rule card receives drop-target class while another rule is being dragged over it", async () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([
          makeRule({ id: "r1" }),
          makeRule({ id: "r2" }),
        ]),
      },
    });
    await w.find('[data-test="rule-drag-r2"]').trigger("dragstart");
    await w.find('[data-test="rule-card-r1"]').trigger("dragover");
    expect(w.find('[data-test="rule-card-r1"]').classes()).toContain(
      "rule-card--drop-target",
    );
  });
});

// ── @{} nested-ref parity (chips in summary + RichTextInput overrides) ──
//
// The canvas derivation modal must reach full parity with the SPA
// DerivationRuleCard editor: `@{uuid}` refs render as CHIPS in the
// read-only rule summary, and the ACTION / ELSE-action override fields
// become RichTextInputs with the full wildcard `@{}` machinery
// (allowNestedRefs + the six ref-data maps + $var suggestions). The
// CONDITION override stays var-only (engine compares condition.value
// raw — no `@{}` carrier resolution there). Mirrors the prop sets in
// src/manager/components/DerivationRuleCard.vue.

const REF_DATA = {
  varSuggestions: ["mood", "age"],
  refSuggestions: ["aabbccdd"],
  uuidToName: new Map([["aabbccdd", "color"]]),
  uuidToSubCategories: new Map([["aabbccdd", ["warm", "cool"]]]),
  uuidToHasNull: new Map([["aabbccdd", false]]),
  uuidToOptionsCount: new Map([["aabbccdd", 3]]),
  uuidToOptionTagSets: new Map([["aabbccdd", [["warm"], ["cool"]]]]),
  uuidToTagGroups: new Map([["aabbccdd", {}]]),
};

/** A rule whose IF action value carries a nested `@{uuid}` ref so the
 *  summary has something to chipify. */
function refRule(): DerivationRule {
  return {
    id: "r1",
    branches: [{
      condition: { var: "color", op: "equals", value: "red" },
      action: { target_var: "mood", mode: "replace", value: "@{aabbccdd#color:warm}" },
    }],
    else: { action: { target_var: "mood", mode: "replace", value: "@{aabbccdd}" } },
  };
}

describe("derivation RulesSection — @{} chip + autocomplete parity", () => {
  it("summary renders an @{} ref as a chip (not raw @{uuid} text)", () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([refRule()]), ...REF_DATA },
    });
    const summary = w.find('[data-test="rule-summary-r1"]');
    // The chip carries the uuid as a data attribute (same as OptionRow).
    const chip = summary.find('[data-uuid="aabbccdd"]');
    expect(chip.exists()).toBe(true);
    // Resolved name is shown, raw hex is NOT printed verbatim.
    expect(summary.text()).toContain("color");
    expect(summary.text()).not.toContain("@{aabbccdd");
  });

  it("action override + ELSE action override mount RichTextInput with allowNestedRefs + ref-data", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([refRule()]), ...REF_DATA },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    await flushPromises();
    const rtis = w.findAllComponents(RichTextInput);
    const byTest = (t: string) => rtis.find((c) => c.attributes("data-test") === t);

    const actVal = byTest("action-override-r1-0");
    const elseVal = byTest("action-override-r1-else");
    expect(actVal).toBeDefined();
    expect(elseVal).toBeDefined();

    for (const rti of [actVal!, elseVal!]) {
      expect(rti.props("surface")).toBe("derivation");
      expect(rti.props("allowNestedRefs")).toBe(true);
      expect(rti.props("refSuggestions")).toEqual(["aabbccdd"]);
      expect(rti.props("varSuggestions")).toEqual(["mood", "age"]);
      expect(rti.props("uuidToName")).toBeInstanceOf(Map);
      expect(rti.props("uuidToSubCategories")).toBeInstanceOf(Map);
      expect(rti.props("uuidToHasNull")).toBeInstanceOf(Map);
      expect(rti.props("uuidToOptionsCount")).toBeInstanceOf(Map);
      expect(rti.props("uuidToOptionTagSets")).toBeInstanceOf(Map);
      expect(rti.props("uuidToTagGroups")).toBeInstanceOf(Map);
    }
  });

  it("condition override mounts RichTextInput WITHOUT allowNestedRefs (raw compare) but WITH var-suggestions", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([refRule()]), ...REF_DATA },
    });
    await w.find('[data-test="rule-head-r1"]').trigger("click");
    await flushPromises();
    const rtis = w.findAllComponents(RichTextInput);
    const condVal = rtis.find((c) => c.attributes("data-test") === "cond-override-r1-0");
    expect(condVal).toBeDefined();
    expect(condVal!.props("surface")).toBe("derivation");
    // condition.value is compared RAW → no @{} carrier machinery.
    expect(condVal!.props("allowNestedRefs")).toBeFalsy();
    // …but $var autocomplete stays available (parity with the SPA field).
    expect(condVal!.props("varSuggestions")).toEqual(["mood", "age"]);
    // No ref-data passed to the condition input (empty default Map).
    expect((condVal!.props("refSuggestions") as string[] | undefined) ?? []).toEqual([]);
  });

  it("typing into the action-override RichTextInput emits action_value_overrides patch", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([refRule()]), ...REF_DATA },
    });
    const actVal = await expandAndFindRti(w, "r1", "action-override-r1-0");
    actVal!.vm.$emit("update:modelValue", "fiery");
    await w.vm.$nextTick();
    const updates = w.emitted("update")! as unknown[][];
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.action_value_overrides).toEqual({ r1: { "0": "fiery" } });
  });

  it("clearing the action-override RichTextInput back to empty collapses the override to null", async () => {
    const w = mount(RulesSection, {
      props: {
        module: makeModule([refRule()], { action_value_overrides: { r1: { "0": "fiery" } } }),
        ...REF_DATA,
      },
    });
    const actVal = await expandAndFindRti(w, "r1", "action-override-r1-0");
    actVal!.vm.$emit("update:modelValue", "");
    await w.vm.$nextTick();
    const updates = w.emitted("update")! as unknown[][];
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.action_value_overrides).toBeNull();
  });

  // Filter-pop-up seam: picking an `@` ref whose target declares
  // sub_categories must open the SubcategoryFilterPicker from inside the
  // canvas action-override input. Driven via RichTextInput's test seams
  // (jsdom can't fake the real keyboard path). This exercises the
  // picker-open code path — real-browser z-index/positioning over the
  // litegraph modal still needs a human check (see report).
  it("action-override RichTextInput opens SubcategoryFilterPicker on @-pick with sub-cats", async () => {
    const w = mount(RulesSection, {
      props: { module: makeModule([refRule()]), ...REF_DATA },
      attachTo: document.body,
    });
    const actVal = await expandAndFindRti(w, "r1", "action-override-r1-0");
    const vm = actVal!.vm as unknown as {
      __triggerAutocompleteForTest: (t: "@" | "$") => void;
      __applyAutocompleteForTest: (label: string) => void;
    };
    vm.__triggerAutocompleteForTest("@");
    vm.__applyAutocompleteForTest("aabbccdd");
    await w.vm.$nextTick();
    expect(document.querySelector('[data-test="subcat-picker"]')).not.toBeNull();
    w.unmount();
  });
});
