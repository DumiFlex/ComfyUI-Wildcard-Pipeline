import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { ScenarioRunResponse, ScenarioSample } from "../../api/types";
import type { StackItemView } from "../../utils/scenario";
import { compareToBaseline, makeBaseline } from "../../utils/baseline";
import OutputsPanel from "../test-runner/OutputsPanel.vue";
import SamplesPanel from "../test-runner/SamplesPanel.vue";
import ComparePanel from "../test-runner/ComparePanel.vue";
import TraceDrawer from "../test-runner/TraceDrawer.vue";

const view = (kind: StackItemView["kind"], binding: string): StackItemView => ({
  kind, id: binding, name: binding, binding, detail: "", enabled: true, missing: false,
});
const VIEWS = [view("wildcard", "hair"), view("wildcard", "mood"), view("combine", "look")];

function sample(seed: number, hair: string, negs: ScenarioSample["negatives"]): ScenarioSample {
  return {
    seed,
    vars: { hair, mood: "gloomy", look: `${hair}, gloomy` },
    trace: [{
      id: "h", _uid: "s0", type: "wildcard", name: "Hair", binding: "hair", status: "ok", seed, error: null,
      writes: [{ variable: "hair", value: hair, overwrite: false, ...(negs?.hair ? { negative: negs.hair[0].text } : {}) }],
      refs: [],
    }],
    warnings: [],
    negatives: negs,
    error: null,
  };
}

const TRACKED = {
  seeds: [0, 1],
  values: { look: ["strawberry blonde, gloomy", "platinum bob, gloomy"] },
  negatives: { look: ["strawberry, fruit, bright colors, deformed eyes", ""] },
};

const RESULT: ScenarioRunResponse = {
  runs: 2, failed: 0, elapsed_ms: 1, seeds: { first: 0, count: 2 },
  variables: {
    hair: { counts: { "strawberry blonde": 1, "platinum bob": 1 }, distinct: 2, other: 0, internal: false },
    mood: { counts: { gloomy: 2 }, distinct: 1, other: 0, internal: false },
    look: { counts: { "strawberry blonde, gloomy": 1, "platinum bob, gloomy": 1 }, distinct: 2, other: 0, internal: false },
  },
  picks: {}, constraint_hits: {}, warnings: [],
  samples: [
    sample(0, "strawberry blonde", {
      hair: [{ text: "strawberry, fruit", pick: null, source: "hair" }],
      look: [
        { text: "strawberry, fruit", pick: null, source: "hair" },
        { text: "bright colors", pick: null, source: "mood" },
        { text: "deformed eyes", pick: null, source: "look" },
      ],
    }),
    sample(1, "platinum bob", {}),
  ],
  stack: [], missing: [], pins: {},
  tracked: TRACKED,
};

describe("Test Runner negatives", () => {
  it("Outputs shows a NEG line tinted by the variable each word came from", () => {
    const w = mount(OutputsPanel, { props: { result: RESULT, views: VIEWS, outputVar: "look" } });
    const negs = w.findAll('[data-test="output-neg"]');
    expect(negs).toHaveLength(1);
    expect(negs[0].text()).toContain("NEG");
    expect(negs[0].text()).toContain("strawberry, fruit");
    const toks = negs[0].findAll(".wp-tro__tok");
    expect(toks.map((t) => t.attributes("title"))).toEqual(["from $hair", "from $mood"]);
    expect(negs[0].find(".wp-tro__neg-own").text()).toBe("deformed eyes");
  });

  it("Samples adds a Negative column only when a seed has negatives", async () => {
    const w = mount(SamplesPanel, { props: { result: RESULT, views: VIEWS, outputVar: "look", selectedSeed: null } });
    expect(w.find('[data-test="samples-neg-head"]').exists()).toBe(true);
    const cells = w.findAll('[data-test="sample-neg"]').map((c) => c.text());
    expect(cells).toEqual(["strawberry, fruit, bright colors, deformed eyes", ""]);
    await w.find('[data-test="samples-filter"]').setValue("deformed");
    expect(w.findAll('[data-test="sample-row"]')).toHaveLength(1);
    const plain = mount(SamplesPanel, { props: { result: RESULT, views: VIEWS, outputVar: "mood", selectedSeed: null } });
    expect(plain.find('[data-test="samples-neg-head"]').exists()).toBe(false);
  });

  it("the trace drawer shows a write's negative", () => {
    const w = mount(TraceDrawer, { props: { sample: RESULT.samples[0] } });
    expect(w.find('[data-test="trace-neg"]').text()).toContain("strawberry, fruit");
    const none = mount(TraceDrawer, { props: { sample: RESULT.samples[1] } });
    expect(none.find('[data-test="trace-neg"]').exists()).toBe(false);
  });

  it("Compare diffs the negative when both sides recorded one", () => {
    const base = makeBaseline(RESULT, "look", { from: 0, count: 2 });
    const next: ScenarioRunResponse = {
      ...RESULT,
      tracked: { ...TRACKED, negatives: { look: ["strawberry, fruit, deformed eyes", ""] } },
    };
    const diff = compareToBaseline(base, next);
    const w = mount(ComparePanel, { props: { result: next, baseline: base, diff, saved: true, running: false } });
    const neg = w.find('[data-test="compare-neg"]');
    expect(neg.exists()).toBe(true);
    expect(neg.find("del").text()).toContain("bright colors");
    expect(w.find('[data-test="compare-neg-missing"]').exists()).toBe(false);
  });

  it("Compare says the negative was not recorded for an older baseline", () => {
    const old = makeBaseline({ ...RESULT, tracked: { seeds: [0, 1], values: TRACKED.values } }, "look", { from: 0, count: 2 });
    const diff = compareToBaseline(old, RESULT);
    const w = mount(ComparePanel, { props: { result: RESULT, baseline: old, diff, saved: true, running: false } });
    expect(w.find('[data-test="compare-neg-missing"]').text()).toContain("Negative not recorded");
    expect(w.find('[data-test="compare-neg"]').exists()).toBe(false);
  });
});
