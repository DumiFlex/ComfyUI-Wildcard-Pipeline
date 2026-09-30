import { describe, expect, it } from "vitest";
import {
  WARNING_LABELS,
  buildModel,
  formatValue,
  negativeLines,
  parseSnapshot,
  reachLabel,
  stepSearchText,
  unresolvedUuids,
} from "./debug-model";

const wc = (id: string, variable: string, value: string, extra: Record<string, unknown> = {}) => ({
  id, _uid: `${id}u`, type: "wildcard", status: "ok", seed: 5,
  writes: [{ variable, value }], ...extra,
});

describe("parseSnapshot", () => {
  it("returns null for empty, malformed or non-object JSON", () => {
    expect(parseSnapshot("")).toBeNull();
    expect(parseSnapshot("{nope")).toBeNull();
    expect(parseSnapshot("[1,2]")).toBeNull();
    expect(parseSnapshot('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("formatValue", () => {
  it("joins a multi-pick object with its separator", () => {
    expect(formatValue({ items: ["a", "b"], sep: " and " })).toBe("a and b");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(null)).toBe("");
  });
});

describe("buildModel", () => {
  it("lists variables with the step that wrote them", () => {
    const m = buildModel({
      mood: "calm",
      extra: "from upstream",
      __wp_trace__: [wc("aaaa1111", "mood", "tense"), wc("bbbb2222", "mood", "calm", { name: "Mood 2" })],
    });
    const mood = m.variables.find((v) => v.name === "mood");
    expect(mood).toMatchObject({ value: "calm", writerKey: "1", writerName: "Mood 2", writeCount: 2, fromUpstream: false });
    expect(m.variables.find((v) => v.name === "extra")?.fromUpstream).toBe(true);
  });

  it("carries internal flags, multi-pick items, axes and pick tags", () => {
    const m = buildModel({
      outfit: "coat, boots",
      scratch: "x",
      __wp_trace__: [wc("cccc3333", "outfit", "coat, boots")],
      __wp_internal_flags__: { scratch: true },
      __wp_multi__: { outfit: { items: ["coat", "boots"], sep: ", " } },
      __wp_axes__: { outfit: [{ SHOES: "boots" }, { SHOES: "clogs", HAT: "cap" }] },
      __wp_picks__: { cccc3333: { value: "coat, boots", sub_categories: ["winter"] } },
    });
    const outfit = m.variables.find((v) => v.name === "outfit");
    expect(outfit?.items).toEqual(["coat", "boots"]);
    expect(outfit?.axes).toEqual([{ axis: "SHOES", value: "boots, clogs" }, { axis: "HAT", value: "cap" }]);
    expect(outfit?.tags).toEqual(["winter"]);
    expect(m.variables.find((v) => v.name === "scratch")?.internal).toBe(true);
  });

  it("names step statuses in plain words", () => {
    const m = buildModel({
      __wp_trace__: [
        { id: "a", type: "wildcard", status: "skipped_disabled", binding: "a" },
        { id: "b", type: "wildcard", status: "skipped_frame", binding: "b" },
        { id: "c", type: "combine", status: "failed", error: { type: "ValueError", message: "bad" } },
        { id: "d", type: "mystery", status: "skipped_unknown_type" },
      ],
    });
    expect(m.steps.map((s) => [s.status, s.statusLabel])).toEqual([
      ["off", "off"], ["frame", "off this frame"], ["error", "failed"], ["unknown", "unknown type"],
    ]);
    expect(m.steps[2].error).toBe("ValueError: bad");
    expect(m.steps[0].bindings).toEqual(["a"]);
  });

  it("marks a constraint that never applied, from the warning or its hit count", () => {
    const con = (id: string) => ({
      id, _uid: id, type: "constraint", status: "ok",
      constraint_source: "src00001", constraint_target: "tgt00001",
      detail: { uid: id, reach: { mode: "next", count: 2 }, cells: 1, exceptions: 0, only: false },
    });
    const m = buildModel({
      __wp_trace__: [con("con1"), con("con2"), con("con3")],
      __wp_constraint_hits__: { con2: 0, con3: 4 },
      __wp_warnings__: [{ type: "constraint_never_applied", module_id: "con1" }],
    });
    expect(m.steps.map((s) => s.status)).toEqual(["never", "never", "ok"]);
    expect(m.steps[2].constraint).toMatchObject({ hits: 4, reach: "next 2 targets", cells: 1, only: false });
  });

  it("groups consecutive steps by Context node with that node's seed", () => {
    const m = buildModel({
      __wp_trace__: [
        { ...wc("a", "x", "1"), node_id: "3" },
        { ...wc("b", "y", "2"), node_id: "3" },
        { node: "WP_ContextInjector", binding: "z", type: "int", value: 7, node_id: "4" },
        { ...wc("c", "w", "3"), node_id: "5" },
      ],
      __wp_nodes__: [{ node_id: "3", seed: 11 }, { node_id: "5", seed: 12 }],
    });
    expect(m.groups.map((g) => [g.nodeId, g.seed, g.steps.length])).toEqual([["3", "11", 2], ["4", "", 1], ["5", "12", 1]]);
    const inj = m.steps[2];
    expect(inj).toMatchObject({ kind: "injector", valueType: "INT", writes: [{ variable: "z", value: "7" }] });
  });

  it("hangs nested refs under the step that made them", () => {
    const m = buildModel({
      __wp_trace__: [{ ...wc("p", "props", "a red hat"), node_id: "2" }],
      __wp_ref_log__: [
        { owner: "pu", node_id: "2", uuid: "col00001", name: "color", depth: 0, value: "red" },
        { owner: "other", node_id: "2", uuid: "x", depth: 0, value: "?" },
      ],
    });
    expect(m.steps[0].refs).toEqual([{ name: "color", uuid: "col00001", depth: 0, value: "red" }]);
  });

  it("links a wildcard's re-weighting constraints to their steps", () => {
    const m = buildModel({
      __wp_trace__: [
        { id: "con1", _uid: "con1", type: "constraint", status: "ok", name: "Dress code" },
        wc("tgt", "outfit", "apron", {
          detail: { constraints: [{ id: "con1", uid: "con1", name: "", source: "src", source_value: "maid" }] },
        }),
      ],
    });
    expect(m.steps[1].appliedBy).toEqual([{ name: "Dress code", stepKey: "0", source: "src", sourceValue: "maid" }]);
  });

  it("labels every engine warning type and links it to its step", () => {
    const m = buildModel({
      __wp_trace__: [{ ...wc("w1", "look", "a"), node_id: "7" }],
      __wp_warnings__: [
        { type: "unknown_ref", severity: "warn", owner_uid: "w1u", node_id: "7", detail: { uuid: "dead", name: "hat" }, message: "Unknown wildcard ref @{dead#hat}" },
        { type: "constraint_partial_reach", severity: "warning", module_id: "w1", detail: { reached: 1, requested: 3 } },
        { type: "cycle_detected", severity: "error", message: "Cycle: 'abcdef12' → x" },
        { type: "brand_new_type", severity: "info" },
      ],
    });
    const [ref, partial, cycle, unknown] = m.warnings;
    expect(ref).toMatchObject({ label: "Reference not found", severity: "warning", stepKey: "0", detailText: "placeholder, or a module that was deleted" });
    expect(partial).toMatchObject({ detailText: "reached 1 of 3", stepKey: "0" });
    expect(cycle).toMatchObject({ label: "Reference cycle", severity: "error", message: "Cycle: @{abcdef12} → x", stepKey: null });
    expect(unknown.label).toBe("brand new type");
    expect(m.steps[0].warningCount).toBe(2);
    expect(m.counts).toEqual({ info: 1, warning: 2, error: 1 });
  });

  it("covers every warning type the engine emits", () => {
    for (const t of [
      "unknown_ref", "ref_subcategory_empty_pool", "ref_out_of_surface", "var_out_of_surface",
      "unknown_var", "axis_untagged_pick", "unknown_tag_axis", "recursion_limit", "cycle_detected",
      "constraint_never_applied", "constraint_partial_reach", "constraint_source_missing",
      "constraint_register_failed", "constraint_excludes_all_options",
      "constraint_factor_ignored_on_allow", "unknown_constraint_mode",
      "fixed_values_overrides_malformed", "handler_error",
    ]) expect(WARNING_LABELS[t], t).toBeTruthy();
  });

  it("reads an old snapshot without the version key", () => {
    const m = buildModel({ a: "1", __wp_trace__: [wc("x", "a", "1")], __wp_node_seed__: 9 });
    expect(m.version).toBe(1);
    expect(m.seed).toBe("9");
    expect(m.steps[0].detail).toBeNull();
    expect(m.groups).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("reachLabel reads every selector mode", () => {
    expect(reachLabel(undefined)).toBe("every target");
    expect(reachLabel({ mode: "first" })).toBe("first target");
    expect(reachLabel({ mode: "next", count: 1 })).toBe("next 1 target");
    expect(reachLabel({ mode: "pick", picks: [{}, {}] })).toBe("2 picked targets");
  });

  it("unresolvedUuids asks for refs and pick ids the trace can't name", () => {
    const raw = {
      v: "has @{feedbeef} in it",
      __wp_trace__: [wc("abcd0000", "v", "has @{feedbeef} in it")],
      __wp_picks__: { cafe0000: { value: "x" } },
    };
    const m = buildModel(raw);
    expect(unresolvedUuids(m, raw, m.names).sort()).toEqual(["cafe0000", "feedbeef"]);
  });

  it("stepSearchText covers name, bindings and values", () => {
    const m = buildModel({ __wp_trace__: [wc("a", "mood", "Calm", { name: "Mood picker" })] });
    const text = stepSearchText(m.steps[0]);
    expect(text).toContain("mood picker");
    expect(text).toContain("$mood");
    expect(text).toContain("calm");
  });
});

describe("negatives", () => {
  const snap = {
    hair: "strawberry blonde",
    mood: "gloomy",
    look: "gloomy strawberry blonde",
    face: "green eyes",
    __wp_trace__: [
      wc("hair0001", "hair", "strawberry blonde"),
      wc("mood0001", "mood", "gloomy"),
      {
        id: "der00001", _uid: "der00001u", type: "derivation", status: "ok", name: "Mood rules", writes: [],
        detail: { rules: [{ id: "r1", fired: 0, branches: [], action: { target: "mood", mode: "negative", value: "smiling", result: null } }] },
      },
    ],
    __wp_negatives__: {
      hair: [{ text: "strawberry", pick: 0, source: "hair" }, { text: "fruit", pick: 1, source: "hair" }],
      mood: [{ text: "bright colors", pick: null, source: "mood" }, { text: "smiling", pick: null, source: "r1:0" }],
      look: [{ text: "strawberry", pick: null, source: "hair" }],
      face: [{ text: "deformed eyes", pick: null, source: "injector" }],
    },
  };

  it("joins a variable's own entries and names other sources", () => {
    const m = buildModel(snap);
    const neg = (name: string) => m.variables.find((v) => v.name === name)?.negatives;
    expect(neg("hair")).toEqual([{ text: "strawberry, fruit", source: "" }]);
    expect(neg("mood")).toEqual([{ text: "bright colors", source: "" }, { text: "smiling", source: "Mood rules" }]);
    expect(neg("look")).toEqual([{ text: "strawberry", source: "$hair" }]);
    expect(neg("face")).toEqual([{ text: "deformed eyes", source: "Injector" }]);
    expect(m.negativeCount).toBe(4);
  });

  it("is empty for a snapshot without the table", () => {
    const m = buildModel({ a: "1", __wp_trace__: [wc("aaaa0000", "a", "1")] });
    expect(m.variables[0].negatives).toEqual([]);
    expect(m.negativeCount).toBe(0);
  });

  it("skips blank and malformed entries", () => {
    expect(negativeLines("x", [{ text: "  " }, "junk", { text: "ok", source: "x" }])).toEqual([{ text: "ok", source: "" }]);
    expect(negativeLines("x", "not a list")).toEqual([]);
  });

  it("carries a write's negative onto the step", () => {
    const m = buildModel({
      __wp_trace__: [wc("hair0001", "hair", "red hair", { writes: [{ variable: "hair", value: "red hair", negative: "blonde" }] })],
    });
    expect(m.steps[0].writes[0].negative).toBe("blonde");
    expect(buildModel({ __wp_trace__: [wc("a", "b", "c")] }).steps[0].writes[0].negative).toBe("");
  });
});
