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

  it("shows an Add to negative action as `negative:` with no result line", () => {
    const model = buildModel({
      __wp_trace__: [{
        id: "d0000002", type: "derivation", status: "ok", name: "Mood rules", writes: [],
        detail: { rules: [{
          id: "r1", fired: 0, has_else: false,
          branches: [{ index: 0, matched: true, condition: leaf("night", true) }],
          action: { target: "mood", mode: "negative", value: "smiling", result: null },
        }] },
      }],
    });
    const w = mount(DebugStepDetail, {
      props: { step: model.steps[0], warnings: [], uuidToName: new Map(), uuidToKind: new Map(), canFocus: false },
    });
    const action = w.find('[data-test="dbg-rule-action"]');
    expect(action.find('[data-test="dbg-rule-mode"]').text()).toBe("negative:");
    expect(action.find('[data-test="dbg-rule-mode"]').classes()).toContain("wp-dbg-neg-mode");
    expect(action.text()).toContain("smiling");
    expect(action.text()).not.toContain("=");
    expect(w.find('[data-test="dbg-rule-result"]').exists()).toBe(false);
  });

  it("shows every action a branch ran, later ones under `and`", () => {
    const pose = { target: "pose", mode: "replace", value: "headshot", result: "headshot" };
    const neg = { target: "pose", mode: "negative", value: "extra arms", result: null };
    const model = buildModel({
      __wp_trace__: [{
        id: "d0000003", type: "derivation", status: "ok", name: "Tier rules",
        writes: [{ variable: "pose", value: "headshot" }],
        detail: { rules: [{
          id: "r1", fired: 0, has_else: false,
          branches: [{ index: 0, matched: true, condition: leaf("night", true) }],
          action: pose,
          actions: [pose, neg],
        }] },
      }],
    });
    const w = mount(DebugStepDetail, {
      props: { step: model.steps[0], warnings: [], uuidToName: new Map(), uuidToKind: new Map(), canFocus: false },
    });
    const rows = w.findAll('[data-test="dbg-rule-action"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].find('[data-test="dbg-rule-and"]').exists()).toBe(false);
    expect(rows[1].find('[data-test="dbg-rule-and"]').text()).toBe("and");
    expect(rows[1].text()).toContain("extra arms");
  });
});
