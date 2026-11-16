import { describe, expect, it } from "vitest";
import corpus from "../../tests/fixtures/sliders-corpus.json";
import {
  MAX_OUTPUTS,
  defaultSlidersConfig,
  dropSliderRow,
  fmtSlider,
  groupsOf,
  internalSliderVars,
  newSlider,
  normalizeOuts,
  outputNumber,
  outputValues,
  ownSliderNegatives,
  parseSlidersConfig,
  planOutputs,
  resolveSliders,
  sliderMarks,
  sliderNums,
  sliderOutputType,
  sliderProblems,
  sliderRows,
  slidersPreviewModules,
  staticSliderNegatives,
  uniqueVar,
  varFromName,
  visibleRows,
  type SlidersConfig,
  type SliderRow,
} from "./sliders";

describe("sliders corpus (shared with engine/sliders.py)", () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const cfg = parseSlidersConfig(JSON.stringify(c.config));
      expect(resolveSliders(cfg)).toEqual(c.values);
      expect(sliderNums(cfg)).toEqual(c.nums);
      expect(ownSliderNegatives(cfg)).toEqual("negatives" in c ? c.negatives : {});
      const vals = outputValues(cfg);
      expect(vals).toHaveLength(MAX_OUTPUTS);
      expect(vals.slice(0, c.outputs.length)).toEqual(c.outputs);
      expect(vals.slice(c.outputs.length).every((v) => v === 0)).toBe(true);
      expect([...internalSliderVars(cfg)].sort()).toEqual("internal" in c ? c.internal : []);
    });
  }
});

const row = (over: Partial<SliderRow> & { id: string }): SliderRow => ({
  kind: "slider", name: over.id, var: over.id, value: 0.5, min: 0, max: 1, step: 0.05,
  decimals: 2, mode: "number", pin: false, out: 0, style: "row", ...over,
});
const cfgOf = (...rows: SlidersConfig["rows"]): SlidersConfig => ({ version: 1, rows });

describe("parseSlidersConfig", () => {
  it("falls back to one slider for junk", () => {
    for (const raw of ["", "{", "[]", "null", 5]) {
      const cfg = parseSlidersConfig(raw);
      expect(sliderRows(cfg)).toHaveLength(1);
    }
  });

  it("cleans fields and keeps looks", () => {
    const cfg = parseSlidersConfig({ rows: [
      { id: "x", var: "a", value: "nope", min: true, max: Number.NaN, step: -1, decimals: 99, mode: "loud",
        words: [1, { word: "w", upto: false }], style: "fader", tint: "#ABCDEF", icon: "pi-star", marks: true, out: 3 },
      { id: "x", kind: "label", name: " L ", color: 12, collapsed: true },
      { id: "z", kind: "other" },
    ] });
    const [s, l] = cfg.rows;
    expect(cfg.rows).toHaveLength(2);
    expect(s).toMatchObject({ value: 0, min: 0, max: 1, step: 0.01, decimals: 6, mode: "number", style: "fader",
      tint: "#abcdef", icon: "star", marks: true, out: 0, words: [{ word: "w" }] });
    expect(l).toMatchObject({ kind: "label", name: "L", color: 1, collapsed: true });
    expect(l?.id).not.toBe("x");
  });
});

describe("fmtSlider", () => {
  it("never writes -0", () => {
    expect(fmtSlider({ value: -0.004, decimals: 2 })).toBe("0.00");
    expect(fmtSlider({ value: -0.2, decimals: 0 })).toBe("0");
    expect(fmtSlider({ value: -1.5, decimals: 1 })).toBe("-1.5");
  });
});

describe("helpers", () => {
  it("names variables", () => {
    expect(varFromName("Camera distance!")).toBe("camera_distance");
    expect(varFromName("3D depth")).toBe("s_3d_depth");
    const cfg = cfgOf(row({ id: "a", var: "detail" }));
    expect(uniqueVar("detail", cfg)).toBe("detail_2");
    expect(uniqueVar("detail", cfg, "a")).toBe("detail");
    expect(newSlider(cfg, "Detail").var).toBe("detail_2");
    expect(sliderRows(defaultSlidersConfig())[0]?.var).toBe("slider_1");
  });

  it("types outputs by decimals", () => {
    expect(sliderOutputType({ decimals: 0 })).toBe("INT");
    expect(sliderOutputType({ decimals: 2 })).toBe("FLOAT");
  });

  it("reports problems", () => {
    const p = sliderProblems(cfgOf(
      row({ id: "a", var: "x", min: 1, max: 1 }),
      row({ id: "b", var: "" }),
      row({ id: "c", var: "9x" }),
      row({ id: "d", var: "y", name: "D" }),
      row({ id: "e", var: "y" }),
    ));
    expect([...p.keys()]).toEqual(["a", "b", "c", "e"]);
    expect(p.get("e")).toContain('"D"');
  });

  it("marks words range ends", () => {
    const s = row({ id: "a", mode: "words", marks: true, words: [{ word: "a", upto: 0.3 }, { word: "b", upto: 2 }, { word: "c" }] });
    expect(sliderMarks(s).map((m) => m.value)).toEqual([0, 0.3, 1]);
    expect(sliderMarks({ ...s, marks: undefined })).toEqual([]);
  });

  it("files the matched word's negative, else the slider's", () => {
    const s = row({ id: "a", mode: "words", value: 0.2, negative: "base",
      words: [{ word: "near", upto: 0.5, negative: "cropped" }, { word: "far" }] });
    expect(ownSliderNegatives(cfgOf(s))).toEqual({ a: "cropped" });
    expect(ownSliderNegatives(cfgOf({ ...s, value: 0.9 }))).toEqual({ a: "base" });
    const node = { widgets: [{ name: "wp_sliders", value: JSON.stringify(cfgOf({ ...s, value: 0.9 }, row({ id: "b" }))) }] };
    expect(staticSliderNegatives(node)).toEqual({ a: "base", b: "" });
  });

  it("splits preview steps by internal", () => {
    const node = { widgets: [{ name: "wp_sliders", value: JSON.stringify(cfgOf(row({ id: "a" }), row({ id: "b", internal: true }))) }] };
    const mods = slidersPreviewModules(node);
    expect(mods.map((m) => m.id)).toEqual(["51d0f0fe", "51d0f0fd"]);
    expect(mods[1]?.instance).toEqual({ internal: true });
  });
});

describe("outputs", () => {
  it("normalizes slots and drops pins past the cap", () => {
    const rows = Array.from({ length: 18 }, (_, i) => row({ id: `s${i}`, pin: true, out: 0 }));
    const cfg = normalizeOuts(cfgOf(...rows));
    const pins = sliderRows(cfg).filter((s) => s.pin);
    expect(pins).toHaveLength(MAX_OUTPUTS);
    expect(pins.map((s) => s.out)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("plans removals and additions", () => {
    const prev = cfgOf(row({ id: "a", pin: true, out: 1 }), row({ id: "b", pin: true, out: 2 }), row({ id: "c", pin: true, out: 3 }));
    const next = cfgOf(row({ id: "a", pin: true, out: 1 }), row({ id: "b" }), row({ id: "c", pin: true, out: 3 }), row({ id: "d", pin: true }));
    const plan = planOutputs(prev, next);
    expect(plan.remove).toEqual([2]);
    expect(plan.add).toBe(1);
    expect(sliderRows(plan.config).map((s) => s.out)).toEqual([1, 0, 2, 3]);
  });
});

describe("groups and drag", () => {
  const L = (id: string, collapsed = false) => ({ id, kind: "label" as const, name: id, color: 1, ...(collapsed ? { collapsed } : {}) });
  const ids = (rows: SlidersConfig["rows"] | null) => rows?.map((r) => r.id) ?? null;

  it("groups by the label above", () => {
    const cfg = cfgOf(row({ id: "a" }), L("L1", true), row({ id: "b" }), L("L2"), row({ id: "c" }));
    expect(groupsOf(cfg).map((g) => g.sliders.map((s) => s.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(ids(visibleRows(cfg))).toEqual(["a", "L1", "L2", "c"]);
  });

  it("moves a slider", () => {
    const cfg = cfgOf(row({ id: "a" }), L("L1", true), row({ id: "b" }), row({ id: "c" }));
    expect(ids(dropSliderRow(cfg, "a", "c", "after"))).toEqual(["L1", "b", "c", "a"]);
    expect(ids(dropSliderRow(cfg, "c", "a", "before"))).toEqual(["c", "a", "L1", "b"]);
    const into = dropSliderRow(cfg, "a", "L1", "after");
    expect(ids(into)).toEqual(["L1", "a", "b", "c"]);
    expect(into?.[0]).toMatchObject({ collapsed: false });
    expect(dropSliderRow(cfg, "a", "a", "before")).toBeNull();
    expect(dropSliderRow(cfg, "a", "L1", "before")).toBeNull();
  });

  it("moves a label with its sliders, only between groups", () => {
    const cfg = cfgOf(L("L1"), row({ id: "a" }), L("L2"), row({ id: "b" }), row({ id: "c" }));
    expect(ids(dropSliderRow(cfg, "L1", "c", "after"))).toEqual(["L2", "b", "c", "L1", "a"]);
    expect(ids(dropSliderRow(cfg, "L2", "L1", "before"))).toEqual(["L2", "b", "c", "L1", "a"]);
    expect(ids(dropSliderRow(cfg, "L1", "x", "end"))).toBeNull();
    expect(ids(dropSliderRow(cfg, "L1", "b", "end"))).toEqual(["L2", "b", "c", "L1", "a"]);
    expect(dropSliderRow(cfg, "L1", "b", "after")).toBeNull();
  });
});

describe("output type", () => {
  it("follows the decimals unless the slider picks one", () => {
    expect(sliderOutputType({ decimals: 0 })).toBe("INT");
    expect(sliderOutputType({ decimals: 2 })).toBe("FLOAT");
    expect(sliderOutputType({ decimals: 2, out_type: "int" })).toBe("INT");
    expect(sliderOutputType({ decimals: 0, out_type: "float" })).toBe("FLOAT");
    expect(outputNumber({ value: 6.5, decimals: 1, out_type: "int" })).toBe(7);
    expect(outputNumber({ value: -0.4, decimals: 1, out_type: "int" })).toBe(0);
    expect(parseSlidersConfig(JSON.stringify({ rows: [{ id: "a", kind: "slider", var: "a", out_type: "x" }] })).rows[0]).not.toHaveProperty("out_type");
  });
});
