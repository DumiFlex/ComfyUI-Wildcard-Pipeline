import { describe, expect, it } from "vitest";
import corpus from "../../tests/fixtures/toggles-corpus.json";
import {
  collectUpstreamKinds,
  collectUpstreamRenderableVariables,
  collectUpstreamVariables,
  type LiteGraphLike,
  type LiteNodeLike,
} from "./graph";
import {
  MAX_OUTPUTS,
  defaultTogglesConfig,
  dragRow,
  visibleRows,
  withUpstream,
  groupsOf,
  internalToggleVars,
  needsDepth,
  needsLoop,
  newToggle,
  normalizeOuts,
  outputValues,
  parseTogglesConfig,
  planOutputs,
  resolveToggles,
  rowsOf,
  toggleProblems,
  toggleRows,
  togglesPreviewModules,
  uniqueVar,
  varFromName,
  type ToggleRow,
  type TogglesConfig,
} from "./toggles";

function t(id: string, v: string, on: boolean, extra: Partial<ToggleRow> = {}): ToggleRow {
  return { id, kind: "toggle", name: v, var: v, on, pin: false, out: 0, style: "switch", ...extra };
}
function cfg(rows: TogglesConfig["rows"], mode: TogglesConfig["mode"] = "any"): TogglesConfig {
  return { version: 1, mode, group_var: "", rows };
}

describe("toggles corpus (shared with engine/toggles.py)", () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const parsed = withUpstream(parseTogglesConfig(JSON.stringify(c.config)), "upstream" in c ? c.upstream : null).config;
      expect(resolveToggles(parsed)).toEqual(c.values);
      const vals = outputValues(parsed);
      expect(vals).toHaveLength(MAX_OUTPUTS);
      expect(vals.slice(0, c.outputs.length)).toEqual(c.outputs);
      expect(vals.slice(c.outputs.length).some(Boolean)).toBe(false);
      if ("internal" in c) expect([...internalToggleVars(parsed)].sort()).toEqual(c.internal);
    });
  }
});

describe("parseTogglesConfig", () => {
  it("falls back to one toggle on a broken value", () => {
    for (const raw of ["", "{", "[]", null, 5]) {
      const c = parseTogglesConfig(raw);
      expect(toggleRows(c)).toHaveLength(1);
      expect(toggleRows(c)[0]).toMatchObject({ pin: true, out: 1, style: "switch" });
    }
  });
  it("keeps labels, labels and styles; drops junk; re-ids repeats", () => {
    const c = parseTogglesConfig({
      mode: "one",
      group_var: " framing ",
      rows: [
        { id: "l1", kind: "label", name: "LoRAs", color: 3, collapsed: true },
        { id: "a", kind: "toggle", name: "A", var: "a", on: true, pin: true, out: 1, style: "buttons", on_label: "Day", off_label: "Night", needs: "b" },
        { id: "a", kind: "toggle", name: "B", var: "b", style: "nope", pin: false, out: 4 },
        { kind: "other" },
        7,
      ],
    });
    expect(c.mode).toBe("one");
    expect(c.group_var).toBe("framing");
    expect(c.rows[0]).toEqual({ id: "l1", kind: "label", name: "LoRAs", color: 3, collapsed: true });
    expect(c.rows[1]).toMatchObject({ style: "buttons", on_label: "Day", off_label: "Night", needs: "b" });
    expect(c.rows[2]).toMatchObject({ style: "switch", out: 0 });
    expect(c.rows[2].id).not.toBe("a");
    expect(c.rows).toHaveLength(3);
  });
});

describe("names", () => {
  it("makes a variable from a name", () => {
    expect(varFromName("Use subject LoRA?")).toBe("use_subject_lora");
    expect(varFromName("  Café  au lait ")).toBe("cafe_au_lait");
    expect(varFromName("4K")).toBe("t_4k");
    expect(varFromName("??")).toBe("");
  });
  it("keeps variables unique on the node", () => {
    const c = cfg([t("1", "rain", false), t("2", "rain_2", false)]);
    expect(uniqueVar("rain", c)).toBe("rain_3");
    expect(uniqueVar("rain", c, "1")).toBe("rain");
    expect(newToggle(c).var).toBe("toggle_3");
    expect(defaultTogglesConfig().rows[0]).toMatchObject({ name: "Toggle 1", var: "toggle_1", out: 1 });
  });
});

describe("outputs", () => {
  it("normalizes slots and drops pins past 16", () => {
    const rows = Array.from({ length: 18 }, (_, i) => t(String(i), `v${i}`, true, { pin: true, out: 1 }));
    const n = normalizeOuts(cfg(rows));
    const pinned = toggleRows(n).filter((r) => r.pin);
    expect(pinned).toHaveLength(16);
    expect(pinned.map((r) => r.out)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(toggleRows(n)[17]).toMatchObject({ pin: false, out: 0 });
  });
  it("keeps valid slots out of row order", () => {
    const c = cfg([t("a", "a", true, { pin: true, out: 2 }), t("b", "b", true, { pin: true, out: 1 })]);
    expect(normalizeOuts(c)).toEqual(c);
  });
  it("plans an unpin: remove its slot and shift the later ones down", () => {
    const prev = cfg([
      t("a", "a", true, { pin: true, out: 3 }),
      t("b", "b", true, { pin: true, out: 1 }),
      t("c", "c", true, { pin: true, out: 2 }),
    ]);
    const next = cfg([
      t("a", "a", true, { pin: true, out: 3 }),
      t("b", "b", true, { pin: false, out: 1 }),
      t("c", "c", true, { pin: true, out: 2 }),
    ]);
    const plan = planOutputs(prev, next);
    expect(plan.remove).toEqual([1]);
    expect(plan.add).toBe(0);
    expect(toggleRows(plan.config).map((r) => [r.id, r.pin, r.out])).toEqual([
      ["a", true, 2], ["b", false, 0], ["c", true, 1],
    ]);
  });
  it("plans a delete and a new pin together", () => {
    const prev = cfg([t("a", "a", true, { pin: true, out: 1 }), t("b", "b", true, { pin: true, out: 2 })]);
    const next = cfg([t("b", "b", true, { pin: true, out: 2 }), t("n", "n", false, { pin: true })]);
    const plan = planOutputs(prev, next);
    expect(plan.remove).toEqual([1]);
    expect(plan.add).toBe(1);
    expect(toggleRows(plan.config).map((r) => r.out)).toEqual([1, 2]);
  });
  it("removes several slots highest first", () => {
    const prev = cfg([1, 2, 3, 4].map((i) => t(`t${i}`, `v${i}`, true, { pin: true, out: i })));
    const next = cfg([t("t2", "v2", true, { pin: true, out: 2 }), t("t4", "v4", true, { pin: true, out: 4 })]);
    const plan = planOutputs(prev, next);
    expect(plan.remove).toEqual([3, 1]);
    expect(toggleRows(plan.config).map((r) => r.out)).toEqual([1, 2]);
  });
  it("won't pin a 17th", () => {
    const prev = normalizeOuts(cfg(Array.from({ length: 16 }, (_, i) => t(`${i}`, `v${i}`, true, { pin: true, out: i + 1 }))));
    const next = { ...prev, rows: [...prev.rows, t("x", "x", true, { pin: true })] };
    const plan = planOutputs(prev, next);
    expect(plan.add).toBe(0);
    expect(toggleRows(plan.config)[16]).toMatchObject({ pin: false, out: 0 });
  });
});

describe("needs + problems + groups", () => {
  it("finds loops and depth", () => {
    const c = cfg([t("a", "a", true), t("b", "b", true, { needs: "a" }), t("c", "c", true, { needs: "b" })]);
    expect(needsLoop(c, "a", "c")).toBe(true);
    expect(needsLoop(c, "c", "a")).toBe(false);
    expect(needsLoop(c, "a", "a")).toBe(true);
    expect(needsDepth(c, "c")).toBe(2);
    expect(needsDepth(c, "a")).toBe(0);
  });
  it("reports bad, empty and repeated variables", () => {
    const c: TogglesConfig = { ...cfg([t("a", "x", true), t("b", "x", true), t("c", "9x", true), t("d", "", true)], "one"), group_var: "x" };
    const p = toggleProblems(c);
    expect(p.get("a")).toBeUndefined();
    expect(p.get("b")).toContain("also writes $x");
    expect(p.get("c")).toContain("starts with a letter");
    expect(p.get("d")).toContain("No variable");
    expect(p.get("group")).toContain("also writes $x");
  });
  it("groups rows under labels and flattens them back", () => {
    const c = cfg([
      t("a", "a", true),
      { id: "L", kind: "label", name: "Scene", color: 2 },
      t("b", "b", true),
    ]);
    const g = groupsOf(c);
    expect(g.map((x) => [x.label?.id ?? null, x.toggles.map((r) => r.id)])).toEqual([[null, ["a"]], ["L", ["b"]]]);
    expect(rowsOf(g)).toEqual(c.rows);
  });
});

describe("toggle variables in the graph walkers", () => {
  function chain(config: TogglesConfig) {
    const nodes: LiteNodeLike[] = [];
    const g = {
      _nodes: nodes,
      links: { 10: { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 } },
      getNodeById: (id: number) => nodes.find((n) => n.id === id) ?? null,
    } as unknown as LiteGraphLike;
    nodes.push(
      {
        id: 1, type: "WP_Toggles", graph: g,
        inputs: [{ name: "upstream", link: null }],
        outputs: [{ name: "context", links: [10], type: "PIPELINE_CONTEXT" }],
        widgets: [{ name: "wp_toggles", value: JSON.stringify(config) }],
      },
      {
        id: 2, type: "WP_PromptAssembler", graph: g,
        inputs: [{ name: "context", link: 10 }],
        outputs: [],
        widgets: [],
      },
    );
    return { g, asm: nodes[1] };
  }

  it("keeps internal toggles out of the Assembler and shows the rest", () => {
    const c = { ...cfg([t("a", "dawn", true), t("b", "dusk", false, { visible: true })], "one"), group_var: "time", group_visible: true as const };
    const { g, asm } = chain(c);
    expect(collectUpstreamVariables(g, asm).sort()).toEqual(["dawn", "dusk", "time"]);
    expect(collectUpstreamRenderableVariables(g, asm).sort()).toEqual(["dusk", "time"]);
    const kinds = collectUpstreamKinds(g, asm);
    expect(kinds.time).toBe("toggle");
    expect(kinds.__wp_internal_flags__).toBe(JSON.stringify({ dawn: true }));
  });

  it("the Pick one variable is internal without Show in Assembler", () => {
    const { g, asm } = chain({ ...cfg([t("a", "dawn", true)], "one"), group_var: "time" });
    expect(collectUpstreamRenderableVariables(g, asm)).toEqual([]);
  });

  it("the preview splits shown and internal variables", () => {
    const c = cfg([t("a", "dawn", true), t("b", "dusk", false, { visible: true })]);
    const steps = togglesPreviewModules({ widgets: [{ name: "wp_toggles", value: JSON.stringify(c) }] });
    expect(steps.map((s) => [s.instance, (s.entries as { variable_name: string }[]).map((e) => e.variable_name)])).toEqual([
      [{}, ["dusk"]],
      [{ internal: true }, ["dawn"]],
    ]);
  });
});

describe("pick_style", () => {
  it("keeps a known Pick one style and drops radio or junk", () => {
    expect(parseTogglesConfig({ mode: "one", rows: [], pick_style: "chip" }).pick_style).toBe("chip");
    expect(parseTogglesConfig({ mode: "one", rows: [], pick_style: "radio" }).pick_style).toBeUndefined();
    expect(parseTogglesConfig({ mode: "one", rows: [], pick_style: "buttons" }).pick_style).toBeUndefined();
  });
  it("keeps visible only as true", () => {
    const c = parseTogglesConfig({ rows: [{ id: "a", kind: "toggle", name: "a", var: "a", visible: true }, { id: "b", kind: "toggle", name: "b", var: "b", visible: "yes" }] });
    expect(toggleRows(c).map((r) => r.visible)).toEqual([true, undefined]);
  });
});

describe("dragRow (edit view drag across groups)", () => {
  const L = (id: string, collapsed = false): TogglesConfig["rows"][number] => ({ id, kind: "label", name: id, color: 1, ...(collapsed ? { collapsed: true } : {}) });
  const ids = (rows: TogglesConfig["rows"]) => rows.map((r) => r.id);
  const c = cfg([t("a", "a", true), L("L1"), t("b", "b", true), t("c", "c", true), L("L2"), t("d", "d", true)]);

  it("moves a toggle into another group", () => {
    // a L1 b c L2 d → drag a below L2
    expect(ids(dragRow(c, 0, 4))).toEqual(["L1", "b", "c", "L2", "a", "d"]);
  });
  it("moves a toggle out of a group to the top", () => {
    expect(ids(dragRow(c, 2, 0))).toEqual(["b", "a", "L1", "c", "L2", "d"]);
  });
  it("a label carries its toggles and never splits a group", () => {
    // drag L2 between b and c: it moves past c, taking d along.
    expect(ids(dragRow(c, 4, 3))).toEqual(["a", "L1", "b", "c", "L2", "d"]);
    // drag L2 above L1.
    expect(ids(dragRow(c, 4, 1))).toEqual(["a", "L2", "d", "L1", "b", "c"]);
    // drag L1 to the end.
    expect(ids(dragRow(c, 1, 5))).toEqual(["a", "L2", "d", "L1", "b", "c"]);
  });
  it("keeps a folded group's hidden toggles and unfolds on a drop into it", () => {
    const f = cfg([t("a", "a", true), L("L1", true), t("b", "b", true), L("L2"), t("d", "d", true)]);
    expect(ids(visibleRows(f))).toEqual(["a", "L1", "L2", "d"]);
    const out = dragRow(f, 3, 2); // d just below folded L1
    expect(ids(out)).toEqual(["a", "L1", "b", "d", "L2"]);
    expect(out[1]).toMatchObject({ id: "L1", collapsed: false });
    expect(ids(dragRow(f, 1, 3))).toEqual(["a", "L2", "d", "L1", "b"]);
  });
});

describe("parseTogglesConfig negative", () => {
  it("keeps a toggle's negative and drops a blank one", () => {
    const cfg = parseTogglesConfig(JSON.stringify({
      mode: "one",
      rows: [
        { id: "t1", name: "Day", var: "day", negative: "night sky" },
        { id: "t2", name: "Night", var: "night", negative: "   " },
      ],
    }));
    expect(cfg.rows.find((r) => r.id === "t1")).toMatchObject({ negative: "night sky" });
    expect(cfg.rows.find((r) => r.id === "t2")).not.toHaveProperty("negative");
  });
});

describe("parseTogglesConfig looks", () => {
  it("keeps icons and #rrggbb colours, drops anything else", () => {
    const cfg = parseTogglesConfig({
      rows: [
        { id: "l1", kind: "label", name: "G", color: 3, hex: "#FFAA00", icon: "pi-clock" },
        { id: "l2", kind: "label", name: "H", color: 3, hex: "red", icon: "<b>" },
        { id: "t1", name: "Day", var: "day", icon: "sun", icon_color: "#ffcc00", text_color: "#123456", tint: "#00AAFF" },
        { id: "t2", name: "Night", var: "night", icon: "", icon_color: "blue", tint: "#12345" },
      ],
    });
    expect(cfg.rows[0]).toMatchObject({ hex: "#ffaa00", icon: "clock" });
    expect(cfg.rows[1]).not.toHaveProperty("hex");
    expect(cfg.rows[1]).not.toHaveProperty("icon");
    expect(cfg.rows[2]).toMatchObject({ icon: "sun", icon_color: "#ffcc00", text_color: "#123456", tint: "#00aaff" });
    for (const k of ["icon", "icon_color", "text_color", "tint"]) expect(cfg.rows[3]).not.toHaveProperty(k);
  });
});
