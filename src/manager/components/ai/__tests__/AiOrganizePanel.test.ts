import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiOrganizePanel from "../AiOrganizePanel.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import type { AiConfig, AiOrganizeResult } from "../../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60, context_max: 16384, model_size: "auto", model_size_auto: "small",
  key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => ({
  api: {
    ai: { config: vi.fn(), organize: vi.fn() },
    modules: { update: vi.fn() },
    bundles: { update: vi.fn() },
    categories: { create: vi.fn() },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const ROWS = [
  { id: "m1", name: "Hair", tags: ["portrait", "old"], category_id: null, content_rating: "safe" as const },
  { id: "b1", name: "Kit", tags: ["kit"], content_rating: "safe" as const, children: [] },
];

const RESULT: AiOrganizeResult = {
  changes: [
    {
      kind: "module", id: "m1", name: "Hair", type: "wildcard", reason: "hair colours",
      category: { name: "Characters", new: true, id: null },
      tags_add: [{ tag: "anime", new: false }, { tag: "colour", new: true }],
      tags_remove: ["old"], rating: null,
      before: { category: "", tags: ["portrait", "old"], rating: "safe" },
    },
    {
      kind: "bundle", id: "b1", name: "Kit", type: "bundle", reason: "explicit",
      category: null, tags_add: [], tags_remove: [], rating: "nsfw",
      before: { category: "", tags: ["kit"], rating: "safe" },
    },
  ],
  new_categories: ["Characters"], skipped: [], count: 2, model: "m", answer: { items: [] },
};

describe("AiOrganizePanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.organize).mockReset().mockResolvedValue(RESULT);
    vi.mocked(api.modules.update).mockReset().mockImplementation(async (id, body) => ({ id, ...body }) as never);
    vi.mocked(api.bundles.update).mockReset().mockImplementation(async (id, body) => ({ id, ...body }) as never);
    vi.mocked(api.categories.create).mockReset().mockResolvedValue({
      id: "c9", name: "Characters", color: null, icon: null, sort_order: 0,
    });
  });

  it("sends the selection, shows chips and applies only what stays on", async () => {
    const w = mount(AiOrganizePanel, { props: { rows: ROWS } });
    await flushPromises();
    expect(w.text()).toContain("2 items selected");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.organize).mock.calls[0][0]).toEqual({
      items: [{ kind: "module", id: "m1" }, { kind: "bundle", id: "b1" }], history: undefined,
    });
    const chips = w.findAll('[data-test="ai-organize-chip"]');
    expect(chips.map((c) => c.text())).toEqual([
      "Characters", "+ #anime", "+ #colour", "− #old", "Safe NSFW",
    ]);
    await chips[2].trigger("click"); // leave "colour" out
    expect(chips[2].attributes("aria-pressed")).toBe("false");
    expect(w.get('[data-test="ai-apply"]').text()).toBe("Apply to 2 items");
    await w.get('[data-test="ai-apply"]').trigger("click");
    await flushPromises();
    expect(api.categories.create).toHaveBeenCalledWith({ name: "Characters" });
    expect(api.modules.update).toHaveBeenCalledWith("m1", {
      tags: ["portrait", "anime"], category_id: "c9",
    });
    expect(api.bundles.update).toHaveBeenCalledWith("b1", { content_rating: "nsfw" });
    expect(w.emitted("applied")).toHaveLength(1);
  });

  it("turning an item off skips it, and the note tells a follow-up", async () => {
    const w = mount(AiOrganizePanel, { props: { rows: ROWS } });
    await flushPromises();
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    await w.findAll(".wp-ai-org__check [role='checkbox']")[1].trigger("click");
    expect(w.get('[data-test="ai-apply"]').text()).toBe("Apply to 1 item");
    await w.get('[data-test="ai-instruction"]').setValue("fewer tags");
    await w.get('[data-test="ai-refine"]').trigger("click");
    await flushPromises();
    const sent = vi.mocked(api.ai.organize).mock.calls[1][0];
    expect(sent.instruction).toBe("fewer tags");
    expect(sent.history?.[0].note).toBe("they turned off Kit: rating nsfw");
  });

  it("refuses more than 60 items", async () => {
    const rows = Array.from({ length: 61 }, (_, i) => ({ id: `m${i}`, tags: [] }));
    const w = mount(AiOrganizePanel, { props: { rows } });
    await flushPromises();
    expect(w.find('[data-test="ai-organize-too-many"]').exists()).toBe(true);
    expect(w.get('[data-test="ai-run"]').attributes("disabled")).toBeDefined();
  });
});
