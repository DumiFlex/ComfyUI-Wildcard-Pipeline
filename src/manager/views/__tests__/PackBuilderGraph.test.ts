import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import PackBuilder from "../PackBuilder.vue";
import { api } from "../../api/client";
import { _resetAiConfigForTests } from "../../composables/useAiConfig";
import { _resetPackBuilderForTests, usePackBuilder } from "../../composables/usePackBuilder";
import type { AiConfig, AiPackGraph, AiPackItem, AiPackPlan, AiPackPlanResult } from "../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60, context_max: 16384, model_size: "auto", model_size_auto: "small",
  key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../api/client", () => ({
  api: {
    ai: {
      config: vi.fn(), packPlan: vi.fn(), packItem: vi.fn(), packCheck: vi.fn(), packInstall: vi.fn(),
      packReview: vi.fn(), packChange: vi.fn(), packSearch: vi.fn(),
      vision: vi.fn().mockResolvedValue({ vision: true, model: "m" }),
    },
    importExport: { undo: vi.fn() },
    modules: { list: vi.fn().mockResolvedValue([]) },
    bundles: { list: vi.fn().mockResolvedValue([]) },
    templates: { list: vi.fn().mockResolvedValue([]) },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const item = (key: string, kind: AiPackItem["kind"], name: string, extra: Partial<AiPackItem> = {}): AiPackItem => ({
  key, id: `0000000${key.slice(1)}`, kind, name, var: "", section: "", about: `${name} about`, count: 0, tags: [],
  source: "", target: "", use: "", library_id: "", library_type: "", ...extra,
});

const SETTINGS = { library: "inspire", negatives: "auto", structure: "sections", style: "auto", rating: "auto", count: 0, model: "any", youth_negative: "on", planner: "graph" } as const;

const GRAPH: AiPackGraph = {
  title: "Heroes", summary: "", design: "", rating: "safe", style: "tags", model: "", anchor: "race",
  questions: [], assumptions: [], from_images: [], research: [], run: { mode: "single", frames: 0 },
  inputs: [], sections: [],
  slots: [
    { name: "Race", var: "race", what: "races", section: "", count: 4, show: "prompt", pick: "", hold: false, sometimes_none: 0, axes: [{ name: "kind", values: ["elf", "dwarf"] }] },
    { name: "Weapon", var: "weapon", what: "weapons", section: "", count: 5, show: "prompt", pick: "", hold: false, sometimes_none: 0, axes: [{ name: "type", values: ["gun", "blade"] }] },
  ],
  fixed: [],
  relations: [
    { kind: "exclude", from: { slot: "Race", axis: "kind", value: "elf" }, to: { slot: "Weapon", axis: "type", value: "gun" } },
    { kind: "derive", from: { slot: "Race", axis: "kind", value: "elf" }, var: "title", text: "Elder", otherwise: "Hero" },
  ],
  template: { lead: "1girl", order: ["title", "race", "weapon"], tail: "", negative: "lowres" },
};

function plan(): AiPackPlanResult {
  const p: AiPackPlan = {
    title: "Heroes", summary: "", rating: "safe", warnings: [], style: "tags", model: "", anchor: "race",
    questions: [], assumptions: [], research: [], decisions: [], settings: { ...SETTINGS }, inputs: [], sections: [],
    items: [
      item("i1", "wildcard", "Race", { var: "race", count: 4, tags: ["elf", "dwarf"] }),
      item("i2", "wildcard", "Weapon", { var: "weapon", count: 5, tags: ["gun", "blade"] }),
      item("i3", "constraint", "Race → Weapon", { source: "race", target: "weapon" }),
      item("i4", "derivation", "Title rule", { var: "title" }),
      item("i5", "template", "Heroes"),
    ],
    graph: GRAPH,
  };
  return { model: "m", answer: {}, review: [], plan: p };
}

describe("PackBuilder on a graph plan", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    _resetPackBuilderForTests();
    vi.useFakeTimers();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.packPlan).mockReset().mockImplementation(async () => plan());
    vi.mocked(api.ai.packReview).mockReset().mockImplementation(async ({ plan: p }) => ({
      findings: [], note: "", plan: { ...p, warnings: ["compiled again"] },
    }));
  });

  async function start() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: PackBuilder }] });
    const w = mount(PackBuilder, { global: { plugins: [router], stubs: { Teleport: true } } });
    await flushPromises();
    const pb = usePackBuilder();
    pb.convo.instruction.value = "fantasy heroes";
    await pb.askPlan();
    await flushPromises();
    return { w, pb };
  }

  it("edits the graph behind an item and leaves items out through the graph", async () => {
    const { w, pb } = await start();
    expect(pb.draft.value?.graph?.slots.length).toBe(2);
    // The constraint's editor shows its relation; removing it edits the graph.
    const rows = w.findAll("[data-test='pack-item-open']");
    await rows[2].trigger("click");
    expect(w.findAll("[data-test='pack-relation']").length).toBe(1);
    await w.find("[data-test='pack-relation-remove']").trigger("click");
    expect(pb.draft.value?.graph?.relations.map((r) => r.kind)).toEqual(["derive"]);
    expect(pb.edited.value).toBe(true);
    // A wildcard's count and name go to its slot.
    pb.editItem("i1", { count: 9, name: "Races" });
    expect(pb.draft.value?.graph?.slots[0]).toMatchObject({ count: 9, name: "Races" });
    // Leaving a wildcard out takes its slot, its relations and its template read with it.
    pb.removeItem("i2");
    const g = pb.draft.value!.graph!;
    expect(g.slots.map((s) => s.var)).toEqual(["race"]);
    expect(g.template.order).toEqual(["title", "race"]);
    expect(pb.removed.value.size).toBe(0);
    // The recheck sends the graph and takes the server's items as they are.
    vi.advanceTimersByTime(500);
    await flushPromises();
    const calls = vi.mocked(api.ai.packReview).mock.calls;
    const sent = calls[calls.length - 1][0].plan;
    expect(sent.graph?.slots.length).toBe(1);
    expect(pb.draft.value?.warnings).toEqual(["compiled again"]);
  });

  it("adds a slot and a rule through the graph", async () => {
    const { w, pb } = await start();
    await w.find("[data-test='pack-add']").trigger("click");
    const kinds = w.findAll("[data-test='pack-add-kind']");
    expect(kinds.map((k) => k.text())).toEqual(["Wildcard", "Fixed values", "Derivation", "Constraint"]);
    await kinds[0].trigger("click");
    const slots = pb.draft.value?.graph?.slots ?? [];
    expect(slots[slots.length - 1]).toMatchObject({ var: "slot_3", show: "prompt" });
    expect(pb.draft.value?.graph?.template.order).toContain("slot_3");
    pb.addRelation({ kind: "agree", from: { slot: "Race", axis: "kind", value: "" }, to: { slot: "Weapon", axis: "kind", value: "" } });
    expect(pb.draft.value?.graph?.relations.length).toBe(3);
    pb.editRelation(2, { kind: "only" });
    expect(pb.draft.value?.graph?.relations[2].kind).toBe("only");
  });
});
