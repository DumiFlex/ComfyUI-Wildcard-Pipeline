import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SweepPanel from "./SweepPanel.vue";
import ContextLoopWidget from "./ContextLoopWidget.vue";
import SweepModal from "./SweepModal.vue";
import {
  emptyContextLoopConfig,
  emptySweepConfig,
  parseContextLoopConfig,
  parseSweep,
  sweepFrameCount,
  sweepTotal,
  type SweepConfig,
} from "./types";
import {
  axisStatus,
  collectSweepCandidates,
  sweepSourcesFromRaw,
  type SweepCandidate,
} from "./sweep-candidates";
import type { ContextWidgetValue, ModuleEntry } from "../../widgets/_shared";

function wildcard(uid: string, binding: string, values: string[], extra: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: `lib-${uid}`,
    _uid: uid,
    type: "wildcard",
    enabled: true,
    meta: { name: binding },
    entries: [],
    payload: {
      var_binding: binding,
      options: values.map((v, i) => ({ id: `${binding}${i}`, value: v, weight: 1 })),
    },
    ...extra,
  } as ModuleEntry;
}

describe("parseSweep", () => {
  it("defaults for garbage", () => {
    for (const raw of [null, "x", [], 3]) expect(parseSweep(raw)).toEqual(emptySweepConfig());
  });

  it("matches the Python parser on bad axes", () => {
    const out = parseSweep({
      enabled: true,
      limit: 5000,
      hold_others: false,
      axes: [
        { uid: "a1", option_ids: ["x", "x", "", 3, "y"], label: "hair" },
        { uid: "a1", option_ids: ["z"] },
        { uid: "", option_ids: ["z"] },
        { uid: "b2", option_ids: [] },
        "junk",
      ],
    });
    expect(out).toEqual({
      enabled: true,
      limit: 999,
      hold_others: false,
      axes: [{ uid: "a1", option_ids: ["x", "y"], label: "hair" }],
    });
    expect(parseSweep({ limit: 0 }).limit).toBe(1);
    expect(parseSweep({ limit: 2.5 }).limit).toBe(64);
  });

  it("survives a loop config round trip", () => {
    const cfg = parseContextLoopConfig(JSON.stringify({
      sweep: { enabled: true, axes: [{ uid: "u1", option_ids: ["a", "b"] }] },
    }));
    expect(cfg.sweep.axes).toEqual([{ uid: "u1", option_ids: ["a", "b"] }]);
    expect(parseContextLoopConfig("{}").sweep).toEqual(emptySweepConfig());
  });
});

describe("sweep frame count", () => {
  const axes = [{ uid: "a", option_ids: ["1", "2"] }, { uid: "b", option_ids: ["1", "2", "3"] }];

  it("multiplies the axes and caps at the limit", () => {
    expect(sweepTotal(axes)).toBe(6);
    const cfg = { ...emptyContextLoopConfig(), sweep: { ...emptySweepConfig(), enabled: true, axes } };
    expect(sweepFrameCount(cfg)).toBe(6);
    expect(sweepFrameCount({ ...cfg, sweep: { ...cfg.sweep, limit: 4 } })).toBe(4);
  });

  it("is null when off, empty or the loop is bypassed", () => {
    const on = { ...emptyContextLoopConfig(), sweep: { ...emptySweepConfig(), enabled: true, axes } };
    expect(sweepFrameCount(emptyContextLoopConfig())).toBeNull();
    expect(sweepFrameCount({ ...on, sweep: { ...on.sweep, axes: [] } })).toBeNull();
    expect(sweepFrameCount({ ...on, bypass: true })).toBeNull();
  });
});

describe("collectSweepCandidates", () => {
  it("lists enabled downstream wildcards with their enabled options preselected", () => {
    const value: ContextWidgetValue = {
      version: 1,
      modules: [
        wildcard("u1", "hair", ["red", "blue", "green"], {
          instance: { enabled_options: ["hair0", "hair2"], variable_binding: "hair_color" },
        }),
        wildcard("u2", "mood", ["calm"], { enabled: false }),
        { ...wildcard("u3", "pose", []), payload: { var_binding: "pose", options: [{ id: "n", value: "", is_null: true }, { id: "p0", value: "sit" }] } },
        { id: "f", _uid: "f1", type: "fixed_values", enabled: true, meta: { name: "f" }, entries: [] } as ModuleEntry,
      ],
    };
    const out = collectSweepCandidates([{ label: "amber-fox", value }]);
    expect(out.map((c) => c.uid)).toEqual(["u1", "u3"]);
    expect(out[0]).toMatchObject({ binding: "hair_color", nodeLabel: "amber-fox", defaultIds: ["hair0", "hair2"] });
    expect(out[1].options).toEqual([{ id: "n", label: "(nothing)" }, { id: "p0", label: "sit" }]);
    expect(out[1].defaultIds).toEqual(["p0"]);
  });

  it("reports missing wildcards and stale options", () => {
    const cands = collectSweepCandidates([{ label: "x", value: { version: 1, modules: [wildcard("u1", "hair", ["a", "b"])] } }]);
    expect(axisStatus({ uid: "gone", option_ids: ["a"] }, cands).missing).toBe(true);
    expect(axisStatus({ uid: "u1", option_ids: ["hair0", "old"] }, cands).staleIds).toEqual(["old"]);
  });
});

const CANDS: SweepCandidate[] = [
  { uid: "u1", name: "hair", binding: "hair", nodeLabel: "amber-fox", options: [{ id: "h0", label: "red" }, { id: "h1", label: "blue" }, { id: "h2", label: "green" }], defaultIds: ["h0", "h1"] },
  { uid: "u2", name: "mood", binding: "mood", nodeLabel: "amber-fox", options: [{ id: "m0", label: "calm" }, { id: "m1", label: "sad" }], defaultIds: ["m0", "m1"] },
];

function on(axes: SweepConfig["axes"] = [], extra: Partial<SweepConfig> = {}): SweepConfig {
  return { ...emptySweepConfig(), enabled: true, axes, ...extra };
}

function lastEmit(w: ReturnType<typeof mount>): SweepConfig {
  const all = w.emitted("update:modelValue") ?? [];
  return all[all.length - 1][0] as SweepConfig;
}

describe("SweepPanel", () => {
  it("is just a switch while off", async () => {
    const w = mount(SweepPanel, { props: { modelValue: emptySweepConfig(), candidates: CANDS } });
    expect(w.find('[data-test="sweep-add"]').exists()).toBe(false);
    await w.find('[data-test="sweep-toggle"]').trigger("click");
    expect(lastEmit(w).enabled).toBe(true);
  });

  it("explains an empty graph", () => {
    const w = mount(SweepPanel, { props: { modelValue: on(), candidates: [] } });
    expect(w.find('[data-test="sweep-empty"]').text()).toContain("No wildcards downstream");
  });

  it("adds a wildcard with its enabled options", async () => {
    const w = mount(SweepPanel, { props: { modelValue: on(), candidates: CANDS } });
    const sel = w.find('[data-test="sweep-add"]');
    (sel.element as HTMLSelectElement).value = "u1";
    await sel.trigger("change");
    expect(lastEmit(w).axes).toEqual([{ uid: "u1", option_ids: ["h0", "h1"], label: "$hair" }]);
  });

  it("shows the total and the cap", () => {
    const axes = [{ uid: "u1", option_ids: ["h0", "h1", "h2"] }, { uid: "u2", option_ids: ["m0", "m1"] }];
    const w = mount(SweepPanel, { props: { modelValue: on(axes), candidates: CANDS } });
    expect(w.find('[data-test="sweep-total"]').text()).toContain("3 × 2 = 6 combinations");
    const capped = mount(SweepPanel, { props: { modelValue: on(axes, { limit: 4 }), candidates: CANDS } });
    expect(capped.find('[data-test="sweep-total"]').text()).toContain("the limit runs the first 4");
  });

  it("toggles options in wildcard order and never empties an axis", async () => {
    const w = mount(SweepPanel, { props: { modelValue: on([{ uid: "u1", option_ids: ["h1"] }]), candidates: CANDS } });
    await w.find('[data-test="sweep-axis-u1"] .wp-sweep__axis-name').trigger("click");
    await w.find('[data-test="sweep-opt-h0"]').trigger("click");
    expect(lastEmit(w).axes[0].option_ids).toEqual(["h0", "h1"]);
    await w.setProps({ modelValue: on([{ uid: "u1", option_ids: ["h1"] }]) });
    const before = (w.emitted("update:modelValue") ?? []).length;
    await w.find('[data-test="sweep-opt-h1"]').trigger("click");
    expect((w.emitted("update:modelValue") ?? []).length).toBe(before);
  });

  it("removes an axis, edits the limit and the hold switch", async () => {
    const w = mount(SweepPanel, { props: { modelValue: on([{ uid: "u1", option_ids: ["h1"] }]), candidates: CANDS } });
    await w.find('[data-test="sweep-remove-u1"]').trigger("click");
    expect(lastEmit(w).axes).toEqual([]);
    const lim = w.find('[data-test="sweep-limit"]');
    (lim.element as HTMLInputElement).value = "5000";
    await lim.trigger("change");
    expect(lastEmit(w).limit).toBe(999);
    await w.find('[data-test="sweep-limit-up"]').trigger("click");
    expect(lastEmit(w).limit).toBe(65);
    await w.setProps({ modelValue: { ...on([]), limit: 1 } });
    await w.find('[data-test="sweep-limit-down"]').trigger("click");
    expect(lastEmit(w).limit).toBe(1);
    await w.find('[data-test="sweep-hold-toggle"]').trigger("click");
    expect(lastEmit(w).hold_others).toBe(false);
  });

  it("flags an axis whose wildcard is gone", () => {
    const w = mount(SweepPanel, { props: { modelValue: on([{ uid: "zz", option_ids: ["a"], label: "$old" }]), candidates: CANDS } });
    const row = w.find('[data-test="sweep-axis-zz"]');
    expect(row.classes()).toContain("wp-sweep__axis--missing");
    expect(row.text()).toContain("$old");
  });
});

describe("ContextLoopWidget sweep wiring", () => {
  it("parses the raw downstream nodes", () => {
    const raw = JSON.stringify({ version: 1, modules: [wildcard("u1", "hair", ["red", "blue"])] });
    const [src] = sweepSourcesFromRaw([{ label: "amber-fox", raw }]);
    expect(src.value.modules[0]._uid).toBe("u1");
    expect(sweepSourcesFromRaw([{ label: "x", raw: "{bad" }])[0].value.modules).toEqual([]);
  });

  it("keeps the sweep off the node and opens it in a modal", async () => {
    const raw = JSON.stringify({ version: 1, modules: [wildcard("u1", "hair", ["red", "blue"])] });
    const w = mount(ContextLoopWidget, {
      props: { modelValue: emptyContextLoopConfig(), sweepSources: [{ label: "amber-fox", raw }] },
      global: { stubs: { teleport: true } },
    });
    expect(w.find('[data-test="sweep-toggle"]').exists()).toBe(false);
    expect(w.find('[data-test="loop-sweep-badge"]').exists()).toBe(false);
    await w.find('[data-test="loop-sweep-btn"]').trigger("click");
    const modal = w.findComponent(SweepModal);
    expect(modal.exists()).toBe(true);
    await modal.find('[data-test="sweep-toggle"]').trigger("click");
    const cfg = w.emitted("update:modelValue")?.[0]?.[0] as { sweep: SweepConfig; strategy: string };
    expect(cfg.sweep.enabled).toBe(true);
    expect(cfg.strategy).toBe("hash_index");
    await modal.find('[data-test="sweep-modal-done"]').trigger("click");
    expect(w.findComponent(SweepModal).exists()).toBe(false);
  });

  it("shows the frame count on the node button", () => {
    const axes = [{ uid: "u1", option_ids: ["h0", "h1", "h2"] }, { uid: "u2", option_ids: ["m0", "m1"] }];
    const cfg = { ...emptyContextLoopConfig(), sweep: on(axes) };
    const w = mount(ContextLoopWidget, { props: { modelValue: cfg } });
    expect(w.find('[data-test="loop-sweep-badge"]').text()).toBe("6 frames");
  });
});

describe("SweepModal", () => {
  it("previews frames in run order with option names", () => {
    const axes = [{ uid: "u1", option_ids: ["h0", "h2"] }, { uid: "u2", option_ids: ["m0", "m1"] }];
    const w = mount(SweepModal, { props: { modelValue: on(axes), candidates: CANDS }, global: { stubs: { teleport: true } } });
    const rows = w.findAll(".wp-swm__frame").map((r) => r.text());
    expect(rows).toEqual(["#1red · calm", "#2red · sad", "#3green · calm", "#4green · sad"]);
  });

  it("summarises frames past the preview cap", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `x${i}`);
    const w = mount(SweepModal, { props: { modelValue: on([{ uid: "zz", option_ids: ids }]) }, global: { stubs: { teleport: true } } });
    expect(w.findAll(".wp-swm__frame")).toHaveLength(40);
    expect(w.find(".wp-swm__frame-more").text()).toContain("10 more");
  });
});
