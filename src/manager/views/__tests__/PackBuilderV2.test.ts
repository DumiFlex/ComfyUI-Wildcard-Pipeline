import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import PackBuilder from "../PackBuilder.vue";
import { api } from "../../api/client";
import { _resetAiConfigForTests } from "../../composables/useAiConfig";
import {
  _resetPackBuilderForTests, applyPatch, pickAnswer, usePackBuilder,
} from "../../composables/usePackBuilder";
import type { AiConfig, AiPackItem, AiPackPlanResult } from "../../api/types";

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

const SETTINGS = { library: "reuse", negatives: "auto", structure: "sections", style: "auto", rating: "auto", count: 0 } as const;

function plan(round: number): AiPackPlanResult {
  return {
    model: "m", answer: { round }, review: [
      { id: "r1", key: "", level: "fix", text: "There is no template", patch: {
        op: "add", item: { kind: "template", name: "Look prompt", about: "Reads $hair, $outfit" } } },
    ],
    plan: {
      title: "Looks", summary: "", rating: "safe", warnings: [], style: "tags", model: "", anchor: "",
      questions: round === 1 ? [
        { header: "Hair", question: "Which hair styles?", multi: true, choices: ["Long", "Short", "Braids"] },
        { header: "Mood", question: "What mood?", multi: false, choices: ["Calm", "Wild"] },
        { header: "Era", question: "Which era?", multi: false, choices: ["Modern", "Medieval"] },
      ] : [{ header: "Shoes", question: "Shoes too?", multi: false, choices: ["Yes", "No"] }],
      assumptions: ["Adults only"], research: round === 1 ? ["popular hairstyles 2026"] : [],
      decisions: [], settings: { ...SETTINGS }, inputs: [],
      sections: [{ name: "Body", about: "hair and face" }, { name: "Clothes", about: "" }],
      items: [
        item("i1", "wildcard", "Hair", { var: "hair", count: 12, section: "Body", tags: ["a", "b", "c", "d", "e", "f"] }),
        item("i2", "wildcard", "Outfit", { var: "outfit", count: 12, section: "Clothes" }),
      ],
    },
  };
}

describe("PackBuilder v2", () => {
  let round = 0;
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    _resetPackBuilderForTests();
    round = 0;
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.packPlan).mockReset().mockImplementation(async () => plan(++round));
    vi.mocked(api.ai.packReview).mockReset().mockImplementation(async ({ plan: p }) => ({
      findings: [], note: "", plan: { ...p, warnings: [] },
    }));
    vi.mocked(api.ai.packSearch).mockReset().mockResolvedValue({
      results: [{ query: "popular hairstyles 2026", text: "wolf cut, bixie" }],
    });
    vi.mocked(api.ai.packChange).mockReset();
    vi.mocked(api.ai.packItem).mockReset();
    vi.mocked(api.ai.packCheck).mockReset().mockResolvedValue({
      runs: 200, failed: 0, problems: {}, notes: [], variables: [], prompts: [], quality: [],
    });
  });

  async function mountIt() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/bundles/:id/edit", name: "bundles-edit", component: { template: "<div />" } },
        { path: "/settings/:section?", name: "settings", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    const w = mount(PackBuilder, { global: { plugins: [router] } });
    await flushPromises();
    await w.get('[data-test="pack-request"]').setValue("looks");
    await w.get('[data-test="pack-plan"]').trigger("click");
    await flushPromises();
    return w;
  }

  it("takes several choices, typed answers and 'decide for me', then asks new questions only", async () => {
    const w = await mountIt();
    const qs = w.findAll('[data-test="pack-question"]');
    expect(qs).toHaveLength(3);
    const hair = qs[0].findAll('[data-test="pack-choice"]');
    await hair[0].trigger("click");
    await hair[2].trigger("click");
    await qs[0].get('[data-test="pack-other"]').setValue("pixie cut");
    await qs[1].get('[data-test="pack-other"]').setValue("Dreamy");
    await w.get('[data-test="pack-decide-all"]').trigger("click");
    await w.get('[data-test="pack-answer"]').trigger("click");
    await flushPromises();
    const sent = vi.mocked(api.ai.packPlan).mock.calls[1][0];
    expect(sent.decisions).toEqual([
      { question: "Which hair styles?", answer: "Long, Braids, pixie cut" },
      { question: "What mood?", answer: "Dreamy" },
      { question: "Which era?", answer: "Your call (decide for me)" },
    ]);
    // The next round's questions, nothing answered yet; decisions shown.
    expect(w.findAll('[data-test="pack-question"]')).toHaveLength(1);
    expect(w.text()).toContain("Shoes too?");
    expect(w.findAll('[data-test="pack-decision"]')).toHaveLength(3);
    // Reopening one takes it out and puts it in the edit box.
    await w.findAll('[data-test="pack-decision"]')[1].trigger("click");
    expect(usePackBuilder().decisions.value).toHaveLength(2);
    expect((w.get('[data-test="pack-edit"]').element as HTMLTextAreaElement).value)
      .toBe('About "What mood?": ');
  });

  it("groups items by section, wraps tags, and edits an item by hand", async () => {
    const w = await mountIt();
    expect(w.findAll('[data-test="pack-section"]').map((s) => s.text())).toEqual([
      expect.stringContaining("Body"), expect.stringContaining("Clothes")]);
    expect(w.text()).toContain("+2");
    await w.findAll('[data-test="pack-item-open"]')[0].trigger("click");
    const name = w.get('[data-test="pack-edit-name"]');
    await name.setValue("Hairstyle");
    await name.trigger("change");
    await new Promise((r) => setTimeout(r, 450));
    await flushPromises();
    expect(api.ai.packReview).toHaveBeenCalled();
    const calls = vi.mocked(api.ai.packReview).mock.calls;
    const sent = calls[calls.length - 1]?.[0];
    expect(sent?.plan.items[0].name).toBe("Hairstyle");
    expect(w.find('[data-test="pack-edited"]').exists()).toBe(true);
  });

  it("keeps a hand-added item the server's recheck leaves out", async () => {
    vi.mocked(api.ai.packReview).mockImplementation(async ({ plan: p }) => ({
      findings: [], note: "",
      plan: { ...p, items: p.items.filter((i) => i.name), warnings: ["Left out a blank item."] },
    }));
    const w = await mountIt();
    const key = usePackBuilder().addItem("constraint");
    await new Promise((r) => setTimeout(r, 450));
    await flushPromises();
    expect(api.ai.packReview).toHaveBeenCalled();
    expect(usePackBuilder().draft.value?.items.some((i) => i.key === key)).toBe(true);
    expect(w.findAll('[data-test="pack-item"]')).toHaveLength(3);
  });

  it("applies a finding's fix without the model and dismisses others", async () => {
    const w = await mountIt();
    expect(w.findAll('[data-test="pack-item"]')).toHaveLength(2);
    await w.get('[data-test="pack-finding-apply"]').trigger("click");
    await flushPromises();
    expect(w.findAll('[data-test="pack-item"]')).toHaveLength(3);
    expect(w.text()).toContain("Look prompt");
    expect(w.find('[data-test="pack-finding"]').exists()).toBe(false);
    expect(api.ai.packPlan).toHaveBeenCalledTimes(1);
  });

  it("runs research only after Allow, then refines with what it found", async () => {
    const w = await mountIt();
    expect(w.get('[data-test="pack-research"]').text()).toContain("popular hairstyles 2026");
    expect(api.ai.packSearch).not.toHaveBeenCalled();
    await w.get('[data-test="pack-research-allow"]').trigger("click");
    await flushPromises();
    expect(api.ai.packSearch).toHaveBeenCalledWith({ queries: ["popular hairstyles 2026"] });
    const sent = vi.mocked(api.ai.packPlan).mock.calls[1][0];
    expect(sent.web).toEqual([{ query: "popular hairstyles 2026", text: "wolf cut, bixie" }]);
    expect(sent.searched).toEqual(["popular hairstyles 2026"]);
    expect(sent.instruction).toBe("Use what the searches found.");
    expect(w.find('[data-test="pack-research"]').exists()).toBe(false);
  });

  it("changes one item with the AI and keeps the rest", async () => {
    vi.mocked(api.ai.packChange).mockImplementation(async ({ plan: p }) => ({
      model: "m", review: [],
      plan: { ...p, items: p.items.map((i) => (i.key === "i2" ? { ...i, name: "Armor", var: "armor" } : i)) },
    }));
    const w = await mountIt();
    await w.findAll('[data-test="pack-item-open"]')[1].trigger("click");
    await w.get('[data-test="pack-item-ask"]').setValue("make it armor");
    await w.get('[data-test="pack-item-change"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.packChange).mock.calls[0][0]).toMatchObject({ key: "i2", instruction: "make it armor" });
    expect(w.text()).toContain("$armor");
    expect(w.text()).toContain("$hair");
  });

  it("keeps building past a failed item, can't install nothing, and shows a summary", async () => {
    vi.mocked(api.ai.packItem).mockRejectedValue(new Error("the model's answer wasn't valid JSON"));
    const w = await mountIt();
    await w.get('[data-test="pack-build"]').trigger("click");
    await flushPromises();
    // Two tries per item, both items tried.
    expect(vi.mocked(api.ai.packItem).mock.calls.map((c) => c[0].key)).toEqual(["i1", "i1", "i2", "i2"]);
    expect(w.get('[data-test="pack-summary"]').text()).toContain("0 built, 2 failed");
    expect(w.get('[data-test="pack-install"]').attributes("disabled")).toBeDefined();
    expect(w.find('[data-test="pack-nothing"]').exists()).toBe(true);
    await w.findAll('[data-test="pack-skip"]')[0].trigger("click");
    expect(w.get('[data-test="pack-summary"]').text()).toContain("1 skipped");
  });

  it("skips the item building now and goes on with the next", async () => {
    vi.mocked(api.ai.packItem).mockImplementation(({ key }, signal) => {
      if (key === "i1") {
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return Promise.resolve({
        key, id: "00000002", kind: "wildcard", payload: { options: [1] }, preview: [], warnings: [],
        repair: "", model: "m",
      });
    });
    const w = await mountIt();
    await w.get('[data-test="pack-build"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="pack-stage"]').text()).toContain("Building Hair");
    await w.get('[data-test="pack-skip-stage"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.packItem).mock.calls.map((c) => c[0].key)).toEqual(["i1", "i2"]);
    expect(w.get('[data-test="pack-summary"]').text()).toContain("1 built, 1 skipped");
    expect(w.get('[data-test="pack-install"]').attributes("disabled")).toBeUndefined();
  });

  it("extends a bundle: says so, sends its id, and keeps its items fixed", async () => {
    usePackBuilder().extendBundle({ id: "bb000001", name: "Hero" });
    vi.mocked(api.ai.packPlan).mockImplementation(async () => {
      const p = plan(++round);
      p.plan.base = { id: "bb000001", name: "Hero", nested: false, sets: ["class"] };
      p.plan.items.unshift(item("e1", "library", "Class", {
        var: "class", existing: true, library_id: "aaaa0001", library_type: "wildcard" }));
      return p;
    });
    const w = await mountIt();
    expect(vi.mocked(api.ai.packPlan).mock.calls[0][0].bundle_id).toBe("bb000001");
    expect(w.get('[data-test="pack-target"]').text()).toContain("Extending Hero");
    const first = w.findAll('[data-test="pack-item"]')[0];
    expect(first.text()).toContain("in bundle");
    expect(first.find('[data-test="pack-remove"]').exists()).toBe(false);
    expect(first.get('[data-test="pack-item-open"]').attributes("disabled")).toBeDefined();
  });

  it("sends the settings with the plan", async () => {
    const pb = usePackBuilder();
    pb.settings.value = { ...pb.settings.value, negatives: "none", structure: "flat", count: 20 };
    await mountIt();
    expect(vi.mocked(api.ai.packPlan).mock.calls[0][0].settings)
      .toEqual({ ...SETTINGS, negatives: "none", structure: "flat", count: 20 });
  });
});

describe("pack plan helpers", () => {
  it("applies edit, add and remove patches without touching the input", () => {
    const p = plan(1).plan;
    const edited = applyPatch(p, { op: "edit", key: "i1", set: { about: "Never empty." } });
    expect(edited.items[0].about).toBe("Never empty.");
    expect(p.items[0].about).toBe("Hair about");
    const added = applyPatch(p, { op: "add", item: { kind: "derivation", name: "D", about: "x" } });
    expect(added.items.map((i) => i.key)).toEqual(["i1", "i2", "i3"]);
    expect(added.items[2].id).toMatch(/^[0-9a-f]{8}$/);
    expect(applyPatch(p, { op: "remove", key: "i1" }).items.map((i) => i.key)).toEqual(["i2"]);
  });

  it("reads a pick as an answer", () => {
    expect(pickAnswer({ chosen: ["A"], other: " b ", decide: false })).toBe("A, b");
    expect(pickAnswer({ chosen: [], other: "", decide: true })).toBe("Your call (decide for me)");
    expect(pickAnswer(undefined)).toBe("");
  });
});
