import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import PackBuilder from "../PackBuilder.vue";
import { api } from "../../api/client";
import { _resetAiConfigForTests } from "../../composables/useAiConfig";
import { _resetPackBuilderForTests, relSig, usePackBuilder } from "../../composables/usePackBuilder";
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
      packReview: vi.fn(), packChange: vi.fn(), packImages: vi.fn(), packSearch: vi.fn(),
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

  it("holds a slot from a finding's patch, keeps the run on the graph and marks sweep axes", async () => {
    const { w, pb } = await start();
    // A hold finding's patch edits the slot, not an item the recompile would drop.
    pb.applyFinding({ id: "h1", key: "i1", level: "tip", text: "Race changes every frame",
      patch: { op: "slot", var: "race", set: { hold: true }, label: "Hold it" } });
    expect(pb.draft.value?.graph?.slots[0].hold).toBe(true);
    expect(pb.draft.value?.graph?.slots[1].hold).toBe(false);
    // "Runs as" goes to the graph too, so the model is shown the run the user set.
    pb.editPlan({ run: { mode: "sweep", frames: 0 } });
    expect(pb.draft.value?.graph?.run).toEqual({ mode: "sweep", frames: 0 });
    await flushPromises();
    // In a sweep run the slot editor offers the sweep-axis box.
    await w.findAll("[data-test='pack-item-open']")[1].trigger("click");
    const box = w.get("[data-test='pack-slot-sweep']");
    await box.setValue(true);
    expect(pb.draft.value?.graph?.slots[1].sweep).toBe(true);
    expect(pb.draft.value?.graph?.slots[1].hold).toBe(false);
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
    // A draw relation (a shared list in front of each option) belongs to
    // the wildcard it feeds, not to a constraint.
    pb.addRelation({ kind: "draw", from: { slot: "Race", axis: "kind", value: "elf" }, to: { slot: "Weapon", axis: "", value: "" } });
    expect(pb.relationsOf("i2")).toEqual([3]);
    expect(pb.relationsOf("i3")).toEqual([0, 2]);
  });

  it("locks hand edits so the next answer keeps them, and shows what the code did", async () => {
    const { w, pb } = await start();
    const exclude = relSig(GRAPH.relations[0]);
    // Each hand edit records what it set: the slot, the relation, the template field.
    pb.editSlot("race", { what: "fantasy races" });
    pb.removeRelation(0);
    pb.addRelation({ kind: "agree", from: { slot: "Race", axis: "kind", value: "" }, to: { slot: "Weapon", axis: "type", value: "" } });
    pb.editTemplate({ lead: "1boy" });
    const agree = relSig(pb.draft.value!.graph!.relations[1]);
    expect(pb.draft.value?.locks).toEqual({ slots: ["race"], relations: [agree], removed_relations: [exclude], template: ["lead"] });
    // Editing the kept relation moves its lock; adding the removed one back frees it.
    pb.editRelation(1, { kind: "accepts" });
    pb.addRelation(GRAPH.relations[0]);
    expect(pb.draft.value?.locks).toEqual({
      slots: ["race"], relations: ["accepts|Race|kind||Weapon|type|||", exclude],
      removed_relations: [], template: ["lead"],
    });
    await flushPromises();
    expect(w.find("[data-test='pack-item-locked']").exists()).toBe(true);
    // The recheck sends the locks with the plan; the next update sends the
    // plan as `previous`, locks included.
    vi.mocked(api.ai.packReview).mockImplementation(async ({ plan: p }) => ({
      findings: [], note: "", plan: { ...p, applied: ["Kept your Race slot"] },
    }));
    vi.advanceTimersByTime(500);
    await flushPromises();
    expect(pb.draft.value?.applied).toEqual(["Kept your Race slot"]);
    expect(w.get("[data-test='pack-applied']").text()).toContain("Kept your Race slot");
    pb.convo.instruction.value = "add a hat";
    await pb.refinePlan();
    await flushPromises();
    const calls = vi.mocked(api.ai.packPlan).mock.calls;
    expect(calls[calls.length - 1][0].previous?.locks?.slots).toEqual(["race"]);
  });

  it("settles the code's own questions with no AI call", async () => {
    const story = { header: "Story or single", question: "Story or single images?", multi: false,
      choices: ["A story of 4 frames", "Single images"], binds: { set: "run" as const, frames: 4 } };
    const sweep = { header: "Sweep axes", question: "Which slots?", multi: true,
      choices: ["Race", "Weapon"], binds: { set: "sweep" as const } };
    vi.mocked(api.ai.packPlan).mockImplementation(async () => {
      const p = plan();
      return { ...p, plan: { ...p.plan, questions: [story, sweep] } };
    });
    const { w, pb } = await start();
    expect(w.findAll("[data-test='pack-question-code']").length).toBe(2);
    // A story answer sets the run on the plan and the graph, and is kept as a decision.
    pb.choose(story, "A story of 4 frames");
    expect(pb.draft.value?.run).toEqual({ mode: "story", frames: 4 });
    expect(pb.draft.value?.graph?.run).toEqual({ mode: "story", frames: 4 });
    expect(pb.draft.value?.questions.map((q) => q.header)).toEqual(["Sweep axes"]);
    expect(pb.decisions.value).toEqual([{ question: story.question, answer: "A story of 4 frames" }]);
    // A sweep marks the slots as they are picked and settles at two.
    pb.choose(sweep, "Weapon");
    expect(pb.draft.value?.graph?.slots.map((s) => !!s.sweep)).toEqual([false, true]);
    expect(pb.draft.value?.questions.length).toBe(1);
    pb.choose(sweep, "Race");
    expect(pb.draft.value?.graph?.slots.map((s) => !!s.sweep)).toEqual([true, true]);
    expect(pb.draft.value?.questions.length).toBe(0);
    expect(pb.decisions.value.length).toBe(2);
    expect(vi.mocked(api.ai.packPlan).mock.calls.length).toBe(1);
  });

  it("decides the code's questions for the user with the first choices", async () => {
    const story = { header: "Story or single", question: "Story or single images?", multi: false,
      choices: ["A story of 3 frames", "Single images"], binds: { set: "run" as const, frames: 3 } };
    vi.mocked(api.ai.packPlan).mockImplementation(async () => {
      const p = plan();
      return { ...p, plan: { ...p.plan, questions: [story] } };
    });
    const { pb } = await start();
    pb.decideAll();
    expect(pb.draft.value?.run).toEqual({ mode: "story", frames: 3 });
    expect(pb.draft.value?.questions.length).toBe(0);
    expect(pb.draft.value?.decisions).toEqual([{ question: story.question, answer: "A story of 3 frames" }]);
  });

  it("reads an added image with one narrow call and fixes an item's finding with another", async () => {
    vi.mocked(api.ai.packPlan).mockImplementation(async () => {
      const p = plan();
      return { ...p, review: [{ id: "m1", key: "i1", level: "fix", text: "Race mixes races and ages", by: "model", type: "mixed_slot" }] };
    });
    const { w, pb } = await start();
    // An image added later is read into the graph, not re-planned.
    vi.mocked(api.ai.packImages).mockImplementation(async ({ plan: p }) => ({
      model: "m", review: [],
      plan: { ...p, from_images: ["a feathered hat"], applied: ["From your images: added Hat"] },
    }));
    pb.images.images.value = [{ url: "data:image/jpeg;base64,AAAA", name: "a.jpg", w: 1, h: 1 }] as never;
    await flushPromises();
    expect(w.find("[data-test='pack-reading-images']").exists()).toBe(false);
    const imgCalls = vi.mocked(api.ai.packImages).mock.calls;
    expect(imgCalls.length).toBe(1);
    expect(imgCalls[0][0].images).toEqual(["data:image/jpeg;base64,AAAA"]);
    expect(pb.draft.value?.from_images).toEqual(["a feathered hat"]);
    expect(pb.draft.value?.applied).toEqual(["From your images: added Hat"]);
    // The next update doesn't send the image again.
    pb.convo.instruction.value = "add a cloak";
    await pb.refinePlan();
    await flushPromises();
    const planCalls = vi.mocked(api.ai.packPlan).mock.calls;
    expect(planCalls.length).toBe(2);
    expect(planCalls[1][0].images).toBeUndefined();
    // Fix all: a finding about one item is one change call on that item,
    // not a whole re-plan; the model's finding is then checked again.
    vi.mocked(api.ai.packChange).mockImplementation(async ({ plan: p }) => ({ model: "m", review: [], plan: p }));
    vi.mocked(api.ai.packReview).mockImplementation(async ({ plan: p }) => ({ findings: [], note: "", plan: p }));
    await pb.fixFindings();
    await flushPromises();
    const change = vi.mocked(api.ai.packChange).mock.calls;
    expect(change.length).toBe(1);
    expect(change[0][0]).toMatchObject({ key: "i1", instruction: "Race mixes races and ages", request: "fantasy heroes" });
    expect(vi.mocked(api.ai.packPlan).mock.calls.length).toBe(2);
    const reviews = vi.mocked(api.ai.packReview).mock.calls;
    expect(reviews[reviews.length - 1][0]).toMatchObject({ ai: true, recheck: ["Race mixes races and ages"] });
  });

  it("applies a settings change to a graph plan through the code, with no AI call", async () => {
    const { w, pb } = await start();
    vi.mocked(api.ai.packReview).mockClear();
    pb.settings.value = { ...pb.settings.value, count: 4 };
    await flushPromises();
    vi.advanceTimersByTime(500);
    await flushPromises();
    const calls = vi.mocked(api.ai.packReview).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0].plan.settings.count).toBe(4);
    expect(vi.mocked(api.ai.packPlan).mock.calls.length).toBe(1);
    expect(pb.edited.value).toBe(false);
    await w.find("[data-test='pack-settings-toggle']").trigger("click");
    expect(w.get("[data-test='pack-settings-note']").text()).toContain("as you change them");
  });
});
