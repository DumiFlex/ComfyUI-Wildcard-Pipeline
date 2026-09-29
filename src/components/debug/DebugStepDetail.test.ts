import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DebugStepDetail from "./DebugStepDetail.vue";
import { buildModel } from "./debug-model";

const leaf = (value: string, result: boolean) => ({ var: "time", op: "equals", value, actual: "night", result });

function mountRules() {
  const model = buildModel({
    __wp_trace__: [{
      id: "d0000001", type: "derivation", status: "ok", name: "Lighting",
      writes: [{ variable: "light", value: "glow, rain" }],
      detail: { rules: [
        { id: "r1", fired: null, has_else: false, branches: [{ index: 0, matched: false, condition: leaf("day", false) }] },
        {
          id: "r2", fired: 0, has_else: false,
          branches: [{ index: 0, matched: true, condition: leaf("night", true) }],
          action: { target: "light", mode: "append", value: ", rain", result: "glow, rain" },
        },
      ] },
    }],
  });
  return mount(DebugStepDetail, {
    props: { step: model.steps[0], warnings: [], uuidToName: new Map(), uuidToKind: new Map(), canFocus: false },
  });
}

describe("DebugStepDetail derivation rules", () => {
  it("opens rules that fired and folds the rest", () => {
    const w = mountRules();
    const rules = w.findAll('[data-test="dbg-rule"]');
    expect(rules[0].classes()).toContain("is-folded");
    expect(rules[0].find('[data-test="dbg-cond"]').exists()).toBe(false);
    expect(rules[1].classes()).not.toContain("is-folded");
    expect(rules[1].find('[data-test="dbg-cond"]').exists()).toBe(true);
  });

  it("toggles one rule, or all of them", async () => {
    const w = mountRules();
    await w.findAll('[data-test="dbg-rule-head"]')[0].trigger("click");
    expect(w.findAll('[data-test="dbg-rule"]')[0].classes()).not.toContain("is-folded");
    const all = w.find('[data-test="dbg-rules-all"]');
    expect(all.text()).toBe("Fold all");
    await all.trigger("click");
    expect(w.findAll('[data-test="dbg-rule"].is-folded')).toHaveLength(2);
    expect(w.find('[data-test="dbg-rule-head"]').attributes("aria-expanded")).toBe("false");
  });

  it("shows an append as the piece added, then the joined result", () => {
    const w = mountRules();
    expect(w.find('[data-test="dbg-rule-action"]').text()).toContain("+=");
    expect(w.find('[data-test="dbg-rule-action"]').text()).toContain(", rain");
    expect(w.find('[data-test="dbg-rule-result"]').text()).toContain("glow, rain");
  });
});
