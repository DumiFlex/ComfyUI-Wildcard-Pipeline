import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import PackBuilder from "../PackBuilder.vue";
import { api } from "../../api/client";
import { _resetAiConfigForTests } from "../../composables/useAiConfig";
import { _resetPackBuilderForTests } from "../../composables/usePackBuilder";
import type { AiConfig, AiPackItem, AiPackPlanResult } from "../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60,
  key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../api/client", () => ({
  api: {
    ai: {
      config: vi.fn(), packPlan: vi.fn(), packItem: vi.fn(), packCheck: vi.fn(), packInstall: vi.fn(),
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
  key, kind, name, var: "", about: `${name} about`, count: 0, tags: [], source: "", target: "", ...extra,
});

const PLAN: AiPackPlanResult = {
  model: "m", answer: {},
  plan: {
    title: "Seasons", summary: "Outfits by season.", rating: "safe", warnings: [],
    questions: [{ question: "How many?", choices: ["Few", "Many"] }],
    items: [
      item("i1", "template", "Scene"),
      item("i2", "constraint", "Season → Outfit", { source: "season", target: "outfit" }),
      item("i3", "wildcard", "Season", { var: "season", count: 4, tags: ["cold"] }),
      item("i4", "wildcard", "Outfit", { var: "outfit", count: 4 }),
    ],
  },
};

describe("PackBuilder", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    _resetPackBuilderForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.packPlan).mockReset().mockResolvedValue(PLAN);
    vi.mocked(api.ai.packItem).mockReset().mockImplementation(async ({ key, note }) => ({
      key, id: `id00000${key.slice(1)}`, kind: "wildcard",
      payload: key === "i1" ? { template_string: "x" } : { options: [1, 2], rules: [] },
      preview: [`built ${key}${note ? ` (${note})` : ""}`], warnings: [], model: "m",
    }));
    vi.mocked(api.ai.packCheck).mockReset()
      .mockResolvedValueOnce({
        runs: 200, failed: 0, problems: { i2: ["never applied"] }, notes: [], variables: [], prompts: [],
      })
      .mockResolvedValue({
        runs: 200, failed: 0, problems: {}, notes: [],
        variables: [{ var: "season", distinct: 2, top: [{ value: "winter", share: 0.5 }] }],
        prompts: [{ seed: 1, text: "winter day, parka", negative: "" }],
      });
    vi.mocked(api.ai.packInstall).mockReset().mockResolvedValue({
      undo_entry_id: "u1", ids: {}, bundle_id: "b0000001", template_id: "t0000001", tag: "seasons",
    });
    vi.mocked(api.importExport.undo).mockReset().mockResolvedValue({ ok: true });
  });

  async function mountIt() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div />" } },
        { path: "/bundles/:id/edit", name: "bundles-edit", component: { template: "<div />" } },
        { path: "/templates/:id/edit", name: "templates-edit", component: { template: "<div />" } },
        { path: "/settings/:section?", name: "settings", component: { template: "<div />" } },
      ],
    });
    await router.push("/");
    const w = mount(PackBuilder, { global: { plugins: [router] } });
    await flushPromises();
    return { w, router };
  }

  it("plans, refines with answers, builds in order, repairs, installs", async () => {
    const { w, router } = await mountIt();
    await w.get('[data-test="pack-request"]').setValue("season outfits");
    await w.get('[data-test="pack-plan"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.packPlan).mock.calls[0][0]).toEqual({ instruction: "season outfits" });
    expect(w.findAll('[data-test="pack-item"]')).toHaveLength(4);

    await w.findAll('[data-test="pack-choice"]')[1].trigger("click");
    await w.findAll('[data-test="pack-remove"]')[0].trigger("click"); // drop the template
    await w.get('[data-test="pack-refine"]').trigger("click");
    await flushPromises();
    const refine = vi.mocked(api.ai.packPlan).mock.calls[1][0];
    expect(refine.instruction).toBe("Answers: How many? Many");
    expect(refine.history?.[0].note).toBe("they removed Scene");

    await w.findAll('[data-test="pack-remove"]')[0].trigger("click"); // drop the template again
    await w.get('[data-test="pack-build"]').trigger("click");
    await flushPromises();
    const calls = vi.mocked(api.ai.packItem).mock.calls.map((c) => [c[0].key, c[0].note ?? ""]);
    // Wildcards first, then the constraint; a repair rebuilds the constraint with its problem.
    expect(calls).toEqual([["i3", ""], ["i4", ""], ["i2", ""], ["i2", "never applied"]]);
    expect(vi.mocked(api.ai.packItem).mock.calls[2][0].plan.items.map((i) => i.key))
      .toEqual(["i2", "i3", "i4"]);
    expect(w.findAll('[data-test="pack-built"]')).toHaveLength(3);
    expect(w.text()).toContain("fixed: never applied");
    expect(w.find('[data-test="pack-ok"]').exists()).toBe(true);
    expect(w.get('[data-test="pack-prompt"]').text()).toContain("winter day, parka");

    await w.get('[data-test="pack-install"]').trigger("click");
    await flushPromises();
    expect(api.ai.packInstall).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain("#seasons");
    await w.get('[data-test="pack-open-bundle"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/bundles/b0000001/edit");
    await w.get('[data-test="pack-undo"]').trigger("click");
    await flushPromises();
    expect(api.importExport.undo).toHaveBeenCalledWith("u1");
    expect(w.find('[data-test="pack-install"]').exists()).toBe(true);
  });

  it("says when the assistant is off", async () => {
    vi.mocked(api.ai.config).mockResolvedValue({ ...CONFIG, enabled: false });
    const { w } = await mountIt();
    expect(w.find('[data-test="pack-off"]').exists()).toBe(true);
  });
});
