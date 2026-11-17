import { describe, expect, it } from "vitest";
import corpus from "../../tests/fixtures/sliders-corpus.json";
import {
  MAX_OUTPUTS,
  defaultSlidersConfig,
  dropSliderRow,
  fineStepOf,
  fmtSlider,
  groupsOf,
  internalSliderVars,
  isSliderNode,
  newSlider,
  padBands,
  mixParts,
  mixPreset,
  mixStep,
  mixValues,
  orbitPreset,
  orbitReady,
  padAxes,
  padConfig,
  padPhrase,
  padRatio,
  phrasePreview,
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
  sliderRuns,
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

describe("styles and snapping", () => {
  const row = (id: string, style: SliderRow["style"]): SliderRow => ({
    id, kind: "slider", name: id, var: id, value: 0, min: 0, max: 1, step: 0.05,
    decimals: 2, mode: "number", pin: false, out: 0, style,
  });

  it("stands neighbouring faders in one strip", () => {
    const runs = sliderRuns([row("a", "fader"), row("b", "fader"), row("c", "bar"), row("d", "fader")]);
    expect(runs.map((r) => (r.kind === "row" ? r.s.id : r.faders.map((f) => f.id).join("+")))).toEqual(["a+b", "c", "d"]);
  });

  it("drags finer down to one unit of the last decimal", () => {
    expect(fineStepOf({ step: 0.05, decimals: 2 })).toBe(0.01);
    expect(fineStepOf({ step: 5, decimals: 0 })).toBe(1);
    expect(fineStepOf({ step: 1, decimals: 0 })).toBeUndefined();
    expect(fineStepOf({ step: 0.01, decimals: 2 })).toBeUndefined();
  });

  it("keeps free and the style through a round trip", () => {
    const raw = JSON.stringify({ rows: [{ id: "a", kind: "slider", var: "a", style: "fader", free: true }, { id: "b", kind: "slider", var: "b", free: "yes" }] });
    const rows = parseSlidersConfig(raw).rows as SliderRow[];
    expect(rows[0]).toMatchObject({ style: "fader", free: true });
    expect(rows[1]).not.toHaveProperty("free");
  });
});

describe("WP Slider 2D pad config", () => {
  it("keeps two pinned axes, X then Y, and the pad looks", () => {
    const cfg = padConfig(JSON.stringify({
      pad: { ratio: 1.5, area: true, grid: 99 },
      rows: [
        { id: "L", kind: "label", name: "G" },
        { id: "a", kind: "slider", name: "Width", var: "width", style: "fader" },
        { id: "b", kind: "slider", name: "Height", var: "height" },
        { id: "c", kind: "slider", name: "Extra", var: "extra" },
      ],
    }));
    expect(cfg.pad).toEqual({ ratio: 1.5, area: true });
    expect((cfg.rows as SliderRow[]).map((s) => [s.id, s.pin, s.out, s.style])).toEqual([["a", true, 1, "row"], ["b", true, 2, "row"]]);
  });

  it("adds missing axes with free variables", () => {
    const empty = padConfig("");
    expect((empty.rows as SliderRow[]).map((s) => [s.name, s.var, s.out])).toEqual([["X", "x", 1], ["Y", "y", 2]]);
    const one = padConfig({ rows: [{ id: "a", kind: "slider", name: "Y", var: "y" }] });
    expect((one.rows as SliderRow[]).map((s) => s.var)).toEqual(["y", "y_2"]);
  });

  it("reads the style, Auto shape, dots, snap and size", () => {
    const cfg = padConfig({ pad: { style: "map", fit: true, grid: 0, snap_dots: true, size: "s", ratio: 9, no_tint: true }, rows: [] });
    expect(cfg.pad).toEqual({ style: "map", fit: true, no_tint: true, grid: 0, snap_dots: true, size: "s" });
    expect(padConfig({ pad: { style: "nope", size: "xl", grid: 17 }, rows: [] }).pad).toEqual({});
  });

  it("padRatio follows the ranges with fit, and a stick is square", () => {
    const x = { min: 0, max: 1024 };
    const y = { min: 0, max: 1344 };
    expect(padRatio({}, x, y)).toBe(1);
    expect(padRatio({ ratio: 1.5 }, x, y)).toBe(1.5);
    expect(padRatio({ fit: true }, x, y)).toBeCloseTo(1024 / 1344);
    expect(padRatio({ fit: true }, { min: 0, max: 100 }, { min: 0, max: 1 })).toBe(4);
    expect(padRatio({ style: "stick", ratio: 2 }, x, y)).toBe(1);
  });

  it("padBands turns a Words axis's ranges into bands", () => {
    const [, mood] = padConfig({ rows: [
      { id: "a", kind: "slider", name: "X", var: "x" },
      { id: "b", kind: "slider", name: "Mood", var: "mood", mode: "words", words: [{ word: "calm", upto: 0.5 }, { word: "wild" }] },
    ] }).rows as SliderRow[];
    expect(mood && padBands(mood)).toEqual([{ to: 0.5, label: "calm" }, { to: 1, label: "wild" }]);
    const [x] = padConfig("").rows as SliderRow[];
    expect(x && padBands(x)).toEqual([]);
  });

  it("is read as a slider node by the graph walkers", () => {
    expect(isSliderNode("WP_Slider2D")).toBe(true);
    expect(isSliderNode("WP_Slider")).toBe(true);
    expect(isSliderNode("WP_Toggles")).toBe(false);
  });
});

describe("WP Slider 3D pad config", () => {
  it("keeps three pinned axes and the first later text row as the phrase", () => {
    const cfg = padConfig({
      pad: { style: "orbit", light: true },
      rows: [
        { id: "a", kind: "slider", name: "A", var: "a" },
        { id: "b", kind: "slider", name: "B", var: "b" },
        { id: "c", kind: "slider", name: "C", var: "c" },
        { id: "d", kind: "slider", name: "D", var: "d" },
        { id: "p", kind: "slider", name: "P", var: "p", mode: "text", text: "$a and $c", pin: true, out: 4 },
      ],
    }, 3);
    expect((cfg.rows as SliderRow[]).map((s) => [s.id, s.pin, s.out])).toEqual([["a", true, 1], ["b", true, 2], ["c", true, 3], ["p", false, 0]]);
    expect(cfg.pad).toEqual({ style: "orbit", light: true });
    expect(padAxes(cfg, 3).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(padPhrase(cfg)?.id).toBe("p");
    expect(phrasePreview(cfg)).toBe("0.00 and 0.00");
    // A 2D pad never takes the orbit style.
    expect(padConfig({ pad: { style: "orbit" }, rows: [] }).pad).toEqual({});
  });

  it("adds a missing Z and has no phrase until one is made", () => {
    const empty = padConfig("", 3);
    expect((empty.rows as SliderRow[]).map((s) => [s.name, s.var, s.out])).toEqual([["X", "x", 1], ["Y", "y", 2], ["Z", "z", 3]]);
    expect(padPhrase(empty)).toBeUndefined();
    expect(phrasePreview(empty)).toBe("");
    expect(orbitReady(empty)).toBe(false);
  });

  it("orbitPreset sets camera words, keeps ids and adds the phrase", () => {
    const base = padConfig("", 3);
    const cam = orbitPreset(base, "camera");
    const rows = cam.rows as SliderRow[];
    expect(rows.map((s) => s.id).slice(0, 3)).toEqual(base.rows.map((r) => r.id));
    expect(rows.map((s) => s.var)).toEqual(["view_side", "view_height", "view_shot", "view"]);
    expect(rows.slice(0, 3).every((s) => s.mode === "words" && s.internal && s.pin)).toBe(true);
    expect(cam.pad).toEqual({ style: "orbit" });
    expect(orbitReady(cam)).toBe(true);
    expect(phrasePreview(cam)).toBe("front-left view, high angle, medium shot");
    const back = { ...cam, rows: rows.map((s, i) => (i === 0 ? { ...s, value: 180 } : s)) };
    expect(phrasePreview(back)).toMatch(/^back view/);
    const front = { ...cam, rows: rows.map((s, i) => (i === 0 ? { ...s, value: -180 } : s)) };
    expect(phrasePreview(front)).toMatch(/^back view/);
    // Survives the widget's own round trip.
    expect(padConfig(cam, 3)).toEqual(cam);
  });

  it("orbitPreset light swaps the words and keeps the phrase row's id", () => {
    const cam = orbitPreset(padConfig("", 3), "camera");
    const light = orbitPreset(cam, "light");
    expect(light.pad).toEqual({ style: "orbit", light: true });
    expect(padPhrase(light)?.id).toBe(padPhrase(cam)?.id);
    expect(phrasePreview(light)).toBe("light from the front-left, high light, diffused light");
  });

  it("mixPreset makes three 0..1 shares and a weighted phrase", () => {
    const base = padConfig("", 3);
    const mix = mixPreset(base);
    const rows = mix.rows as SliderRow[];
    expect(rows.map((s) => s.id).slice(0, 3)).toEqual(base.rows.map((r) => r.id));
    expect(rows.map((s) => s.var)).toEqual(["mix_a", "mix_b", "mix_c", "style_mix"]);
    expect(rows.slice(0, 3).every((s) => s.mode === "number" && s.internal && s.min === 0 && s.max === 1)).toBe(true);
    expect(mix.pad).toEqual({ style: "mix" });
    expect(phrasePreview(mix)).toBe("(watercolor:0.40), (ink sketch:0.30), (oil painting:0.30)");
    expect(padConfig(mix, 3)).toEqual(mix);
    // Never on a 2D pad, and the light look goes.
    expect(padConfig({ pad: { style: "mix" }, rows: [] }).pad).toEqual({});
    expect(mixPreset({ ...mix, pad: { style: "orbit", light: true } }).pad).toEqual({ style: "mix" });
  });

  it("mixParts / mixValues read and write each axis as a part of its own range", () => {
    const rows = padAxes(padConfig("", 3), 3).map((s, i) => ({ ...s, min: i === 2 ? 1 : 0, max: i === 1 ? 2 : i === 2 ? 3 : 1, value: [0.5, 1, 2][i] ?? 0 }));
    expect(mixParts(rows)).toEqual([0.5, 0.5, 0.5]);
    expect(mixValues(rows, [50, 25, 25])).toEqual([0.5, 0.5, 1.5]);
    expect(mixValues(rows, [0, 0, 100])).toEqual([0, 0, 3]);
    expect(mixParts([{ ...rows[0], max: 0, min: 0 } as SliderRow])).toEqual([0, 0, 0]);
  });

  it("mixStep follows the finest axis step on a step that divides 100", () => {
    const axes = padAxes(mixPreset(padConfig("", 3)), 3);
    expect(mixStep(axes)).toBe(5);
    expect(mixStep(axes.map((s) => ({ ...s, step: 0.01 })))).toBe(1);
    expect(mixStep(axes.map((s) => ({ ...s, step: 0.03 })))).toBe(2);
    expect(mixStep(axes.map((s) => ({ ...s, step: 0.3 })))).toBe(25);
    expect(mixStep([])).toBe(5);
  });

  it("is read as a slider node by the graph walkers", () => {
    expect(isSliderNode("WP_Slider3D")).toBe(true);
  });
});

