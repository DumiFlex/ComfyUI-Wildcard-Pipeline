import { describe, expect, it } from "vitest";
import corpus from "../../tests/fixtures/toggles-corpus.json";
import {
  MAX_OUTPUTS,
  defaultTogglesConfig,
  withUpstream,
  groupsOf,
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
