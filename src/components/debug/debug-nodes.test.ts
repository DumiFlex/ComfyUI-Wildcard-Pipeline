import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DebugStepDetail from "./DebugStepDetail.vue";
import DebugVariables from "./DebugVariables.vue";
import DebugTrace from "./DebugTrace.vue";
import { WARNING_LABELS, buildModel, kindColor } from "./debug-model";

// WP Debug and the nodes that write context without a module: Context Loop,
// Model Info, Toggles and the Injector.

const loopRow = (binding: string, value: string, detail: Record<string, unknown> = {}) => ({
  node: "WP_ContextLoop", node_id: "3", binding, value, internal: false,
  type: "iteration", detail: { frame: 5, of: 18, ...detail },
});

describe("node rows in the model", () => {
  it("reads Context Loop rows as their own kind and names the frame", () => {
    const m = buildModel({ iteration: "5", __wp_trace__: [loopRow("iteration", "5", { seed: 42, combo: 2, combos: 4 })] });
    const s = m.steps[0];
    expect(s.kind).toBe("loop");
    expect(s.kindLabel).toBe("loop");
    expect(s.source).toBe("frame 5 of 18");
    expect(s.writes).toEqual([{ variable: "iteration", value: "5", overwrite: false, negative: "" }]);
    expect(m.variables[0]).toMatchObject({ name: "iteration", writerKind: "loop", writerNodeId: "3", fromUpstream: false });
  });

  it("says where Model Info and Toggles values came from", () => {
    const m = buildModel({
      __wp_trace__: [
        { node: "WP_ModelInfo", node_id: "7", binding: "model_family", type: "model", value: "SDXL" },
        { node: "WP_ModelInfo", node_id: "7", binding: "model_variant", type: "rules", value: "pony" },
        { node: "WP_Toggles", node_id: "8", binding: "toggle_1", type: "toggle", value: "true", source: "upstream" },
        { node: "WP_Toggles", node_id: "8", binding: "look", type: "pick", value: "noir" },
      ],
    });
    expect(m.steps.map((s) => s.source)).toEqual([
      "from the model", "file-name rule", "switch, set upstream", "Pick one",
    ]);
  });

  it("labels every node warning and ties it to the node's row", () => {
    for (const t of [
      "injector_reserved_binding", "injector_invalid_binding", "model_info_nothing_detected",
      "model_info_bad_rule", "toggles_problem", "toggles_upstream_many",
    ]) expect(WARNING_LABELS[t]).toBeTruthy();
    const m = buildModel({
      __wp_trace__: [
        { node: "WP_Toggles", node_id: "8", binding: "toggle_1", type: "toggle", value: "true" },
        { node: "WP_Toggles", node_id: "8", binding: "look", type: "pick", value: "$missing" },
        { node: "WP_ContextInjector", node_id: "9", binding: "subject", type: "str", value: "cat" },
      ],
      __wp_warnings__: [
        { type: "unknown_var", node_id: "8", message: "WP Toggles value: $missing", detail: { name: "missing", surface: "assembler" } },
        { type: "toggles_problem", node_id: "8", message: "WP Toggles: two rows share $x" },
        { type: "injector_invalid_binding", node_id: "9", binding: "subject", message: "skipped" },
        { type: "unknown_var", node_id: "404", message: "elsewhere" },
      ],
    });
    expect(m.warnings.map((w) => w.stepKey)).toEqual(["1", "1", "2", null]);
    expect(m.warnings[0].detailText).toBe("in an assembler");
    expect(m.steps[1].warningCount).toBe(2);
  });

  it("gives every node kind a colour token", () => {
    expect(kindColor("loop")).toBe("var(--wp-kind-loop)");
    expect(kindColor("toggle")).toBe("var(--wp-kind-toggle)");
    expect(kindColor("unknown")).toBe("var(--wp-text-dim)");
  });
});

describe("node rows in the view", () => {
  it("shows the Loop's frame facts when a row opens", () => {
    const m = buildModel({ __wp_trace__: [loopRow("iteration", "5", { seed: 42, combo: 2, combos: 4, value_line: 1, values: 3 })] });
    const w = mount(DebugStepDetail, {
      props: { step: m.steps[0], warnings: [], uuidToName: new Map(), uuidToKind: new Map(), canFocus: false },
    });
    const facts = w.find('[data-test="dbg-node-facts"]').text();
    expect(facts).toContain("frame 5 of 18");
    expect(facts).toContain("frame seed 42");
    expect(facts).toContain("sweep combination 2 of 4");
    expect(facts).toContain("value line 1 of 3");
  });

  it("says a wildcard was swept, matched a variable or read a filter variable", () => {
    const wcRow = (detail: Record<string, unknown>) => ({
      id: "aaaa1111", _uid: "u1", type: "wildcard", status: "ok", writes: [{ variable: "style", value: "noir" }], detail,
    });
    const m = buildModel({ __wp_trace__: [
      wcRow({ mode: "pinned", swept: true }),
      wcRow({ mode: "match_variable", match_variable: "model_variant" }),
      wcRow({ filter: "$model_variant", filter_vars: { model_variant: "pony" } }),
    ] });
    const at = (i: number) => mount(DebugStepDetail, {
      props: { step: m.steps[i], warnings: [], uuidToName: new Map(), uuidToKind: new Map(), canFocus: false },
    });
    expect(at(0).find('[data-test="dbg-swept"]').exists()).toBe(true);
    expect(at(0).text()).not.toContain("pinned option");
    expect(at(1).find('[data-test="dbg-match-var"]').text()).toContain("$model_variant");
    expect(at(2).find('[data-test="dbg-filter-var"]').text()).toContain("pony");
  });

  it("groups variables by the node that wrote them, each node drawn its own way", () => {
    const m = buildModel({
      toggle_1: "true",
      model_family: "SDXL",
      mood: "calm",
      __wp_trace__: [
        { node: "WP_Toggles", node_id: "8", binding: "toggle_1", type: "toggle", value: "true" },
        { node: "WP_ModelInfo", node_id: "7", binding: "model_family", type: "model", value: "SDXL" },
        { id: "aaaa1111", _uid: "u", node_id: "9", type: "wildcard", status: "ok", writes: [{ variable: "mood", value: "calm" }] },
      ],
    });
    const w = mount(DebugVariables, {
      props: {
        rows: m.variables, pinned: new Set<string>(), flashed: new Set<string>(), uuidToName: new Map(), uuidToKind: new Map(),
        ctxActiveKey: null, nodeInfo: (id: string) => ({ title: id === "8" ? "Moods" : "", codename: id === "9" ? "ALPHA" : "" }),
        stepsByKey: new Map(m.steps.map((s) => [s.key, s])),
      },
    });
    const secs = w.findAll('[data-test="dbg-var-section"]');
    expect(secs.map((x) => x.attributes("data-kind"))).toEqual(["toggle", "model", "context"]);
    expect(secs[0].find('[data-test="dbg-var-section-head"]').text()).toContain("Moods");
    expect(secs[0].find(".wp-dbg-var-row__switch").classes()).toContain("is-on");
    expect(secs[1].find(".wp-dbg-var-row__value.is-model").text()).toBe("SDXL");
    expect(secs[1].find('[data-test="dbg-node-source"]').text()).toBe("from the model");
    expect(secs[2].find('[data-test="dbg-var-section-head"]').text()).toContain("ALPHA");
    expect(secs[2].find('[data-test="dbg-var"]').exists()).toBe(true);
  });

  it("draws every pick of a Pick one node as its own switch", async () => {
    const m = buildModel({
      warm: "true", cold: "false", mood: "warm light",
      __wp_trace__: [
        { node: "WP_Toggles", node_id: "8", binding: "warm", type: "toggle", value: "true" },
        { node: "WP_Toggles", node_id: "8", binding: "cold", type: "toggle", value: "false" },
        { node: "WP_Toggles", node_id: "8", binding: "mood", type: "pick", value: "warm light" },
      ],
    });
    const w = mount(DebugVariables, {
      props: {
        rows: m.variables, pinned: new Set<string>(), flashed: new Set<string>(), uuidToName: new Map(), uuidToKind: new Map(),
        ctxActiveKey: null, stepsByKey: new Map(m.steps.map((s) => [s.key, s])), canFocus: true,
      },
    });
    const rows = w.findAll('[data-test="dbg-var"]');
    const byName = (n: string) => rows.find((r) => r.text().includes(`$${n}`));
    expect(byName("warm")?.find(".wp-dbg-var-row__switch").classes()).toContain("is-on");
    expect(byName("warm")?.text()).toContain("picked");
    expect(byName("cold")?.find(".wp-dbg-var-row__switch").classes()).toContain("is-off");
    expect(byName("cold")?.text()).toContain("not picked");
    expect(byName("mood")?.text()).toContain("pick one");
  });

  it("shows a toggle with a value as its text plus its .bool state", () => {
    const m = buildModel({
      day: "bright daylight", night: "",
      __wp_negatives__: { day: [{ text: "dark", pick: null, source: "WP_Toggles" }] },
      __wp_trace__: [
        { node: "WP_Toggles", node_id: "8", binding: "day", type: "toggle", value: "bright daylight", bool: true, has_value: true, negative: "dark" },
        { node: "WP_Toggles", node_id: "8", binding: "night", type: "toggle", value: "", bool: false, has_value: true },
      ],
    });
    const w = mount(DebugVariables, {
      props: {
        rows: m.variables, pinned: new Set<string>(), flashed: new Set<string>(), uuidToName: new Map(), uuidToKind: new Map(),
        ctxActiveKey: null, stepsByKey: new Map(m.steps.map((s) => [s.key, s])),
      },
    });
    const rows = w.findAll('[data-test="dbg-var"]');
    const day = rows.find((r) => r.text().includes("$day"));
    const night = rows.find((r) => r.text().includes("$night"));
    // With a value, the row shows the text; on/off is the .bool line.
    expect(day?.find(".wp-dbg-var-row__switch").exists()).toBe(false);
    expect(day?.text()).toContain("bright daylight");
    expect(day?.find('[data-test="dbg-var-bool"]').text()).toContain("true");
    expect(day?.find('[data-test="dbg-var-neg"]').text()).toContain("dark");
    expect(night?.find('[data-test="dbg-var-bool"]').text()).toContain("false");
    expect(night?.text()).toContain("empty while off");
  });

  it("folds a long value and long negatives until the row is opened", async () => {
    const long = "word ".repeat(60).trim();
    const m = buildModel({
      story: long, short: "calm",
      __wp_negatives__: { story: [{ text: "bad ".repeat(40).trim(), pick: null, source: "" }] },
      __wp_trace__: [
        { id: "aaaa1111", _uid: "u1", node_id: "9", type: "wildcard", status: "ok", writes: [{ variable: "story", value: long }] },
        { id: "bbbb2222", _uid: "u2", node_id: "9", type: "wildcard", status: "ok", writes: [{ variable: "short", value: "calm" }] },
      ],
    });
    const w = mount(DebugVariables, {
      props: {
        rows: m.variables, pinned: new Set<string>(), flashed: new Set<string>(), uuidToName: new Map(), uuidToKind: new Map(),
        ctxActiveKey: null, stepsByKey: new Map(m.steps.map((s) => [s.key, s])),
      },
    });
    const rowOf = (name: string) => w.findAll('[data-test="dbg-var"]').find((r) => r.text().includes(`$${name}`));
    expect(rowOf("short")?.find('[data-test="dbg-var-more"]').exists()).toBe(false);
    const story = rowOf("story");
    expect(story?.find(".wp-dbg-var-row__value").classes()).toContain("is-folded");
    const more = story?.find('[data-test="dbg-var-more"]');
    expect(more?.text()).toBe("Show all");
    await more?.trigger("click");
    expect(rowOf("story")?.find(".wp-dbg-var-row__value").classes()).not.toContain("is-folded");
    expect(rowOf("story")?.find('[data-test="dbg-var-more"]').text()).toBe("Show less");
  });

  it("draws node rows in the trace as numbered steps, in run order", () => {
    const m = buildModel({
      __wp_trace__: [
        { id: "aaaa1111", _uid: "u", node_id: "9", type: "wildcard", status: "ok", writes: [{ variable: "mood", value: "calm" }] },
        { node: "WP_Toggles", node_id: "8", binding: "warm", type: "toggle", value: "true" },
        { node: "WP_Toggles", node_id: "8", binding: "cold", type: "toggle", value: "false" },
      ],
    });
    const w = mount(DebugTrace, {
      props: {
        groups: m.groups, showGroupHeads: true, expanded: new Set<string>(), pinned: new Set<string>(), flashKey: null,
        warningsByStep: new Map(), uuidToName: new Map(), uuidToKind: new Map(),
        nodeInfo: () => ({ title: "", codename: "" }), canFocus: false, ctxActiveKey: null,
      },
    });
    expect(w.find('[data-test="dbg-node-card"]').exists()).toBe(false);
    expect(w.findAll(".wp-dbg-step__order").map((x) => x.text())).toEqual(["1", "2", "3"]);
    expect(w.findAll(".wp-dbg-step").map((x) => x.attributes("data-kind"))).toEqual(["wildcard", "toggle", "toggle"]);
  });
});
