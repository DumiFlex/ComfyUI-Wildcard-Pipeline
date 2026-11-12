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

function mountStep(entries: unknown[], index = 0) {
  const model = buildModel({ __wp_trace__: entries });
  return {
    model,
    w: mount(DebugStepDetail, {
      props: { step: model.steps[index], warnings: [], uuidToName: new Map(), uuidToKind: new Map(), canFocus: false },
    }),
  };
}

describe("DebugStepDetail per-kind details", () => {
  it("lists a wildcard's options, picked first and the cut ones last with why", async () => {
    const { w } = mountStep([{
      id: "w0000001", _uid: "u1", type: "wildcard", status: "ok", name: "Mood",
      writes: [{ variable: "mood", value: "calm" }],
      detail: {
        option_id: "calm", chance: 0.5, pool: 3, live: 2,
        steps: { library: 4, filter: 3, toggles: 3, live: 2 },
        options: [
          { id: "angry", value: "angry", base: 1, weight: null, cut: "filter" },
          { id: "tense", value: "tense", base: 1, weight: 0, cut: "constraint" },
          { id: "dreamy", value: "dreamy", base: 1, override: 3, weight: 3 },
          { id: "calm", value: "calm", base: 1, weight: 1 },
        ],
      },
    }]);
    expect(w.find('[data-test="dbg-pool-chain"]').text()).toBe("4 options→3 after the filter→2 drawable");
    // Folded while something could be drawn.
    expect(w.find('[data-test="dbg-options"]').exists()).toBe(false);
    await w.find('[data-test="dbg-options-head"]').trigger("click");
    const rows = w.findAll('[data-test="dbg-option"]');
    expect(rows.map((r) => r.find(".wp-dbg-opt__value").text())).toEqual(["calm", "dreamy", "angry", "tense"]);
    expect(rows[0].classes()).toContain("is-picked");
    expect(rows[1].text()).toContain("75%");
    expect(rows[2].find('[data-test="dbg-option-cut"]').text()).toBe("filtered out");
    expect(rows[3].find('[data-test="dbg-option-cut"]').text()).toBe("excluded by a constraint");
  });

  it("opens the options when nothing could be drawn", () => {
    const { w } = mountStep([{
      id: "w0000001", type: "wildcard", status: "ok", writes: [{ variable: "mood", value: "" }],
      detail: { pool: 0, live: 0, steps: { library: 1, filter: 1, toggles: 0, live: 0 }, options: [{ id: "a", value: "a", base: 1, weight: null, cut: "toggle" }] },
    }]);
    expect(w.find('[data-test="dbg-options"]').exists()).toBe(true);
    expect(w.find('[data-test="dbg-pool-chain"]').classes()).toContain("is-dead");
  });

  it("shows a combine's template and flags a $var nothing set", () => {
    const { w } = mountStep([{
      id: "c0000001", type: "combine", status: "ok", writes: [{ variable: "scene", value: "calm light" }],
      detail: { template: "$mood light $weather", template_source: "library", reads: { mood: "calm", weather: null } },
    }]);
    expect(w.find('[data-test="dbg-template"]').text()).toContain("light");
    const reads = w.find('[data-test="dbg-reads"]').text();
    expect(reads).toContain("$mood");
    expect(reads).toContain("calm");
    expect(reads).toContain("not set");
  });

  it("lists the steps a constraint re-weighted", () => {
    const { w } = mountStep([
      { id: "k0000001", _uid: "k1", type: "constraint", status: "ok", name: "Fits", detail: { uid: "k1", reach: { mode: "all" } } },
      {
        id: "w0000001", _uid: "u1", type: "wildcard", status: "ok", name: "Mood", writes: [{ variable: "mood", value: "calm" }],
        detail: { constraints: [{ id: "k0000001", uid: "k1", name: "Fits", source: "s", source_value: "x" }] },
      },
    ]);
    expect(w.find('[data-test="dbg-constraint-targets"]').text()).toContain("2 · Mood");
  });

  it("says why a toggle is off and what upstream read", () => {
    const { w } = mountStep([{
      node: "WP_Toggles", node_id: "5", binding: "rain", type: "toggle", value: "false", source: "upstream",
      detail: { switch: true, upstream_read: "no", needs: "Weather", held_off: true },
    }]);
    const facts = w.find('[data-test="dbg-node-facts"]').text();
    expect(facts).toContain('upstream read "no"');
    expect(facts).toContain("off: needs Weather, which is off");
  });
});
