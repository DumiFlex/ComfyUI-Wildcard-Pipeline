import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiDraftPanel from "../AiDraftPanel.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import type { AiConfig } from "../../../api/types";

const CONFIG: AiConfig = {
  enabled: true, provider: "ollama", base_url: "", model: "qwen3.5:9b", unload_after_s: 60,
  key_set: false, key_from_env: false,
  presets: {
    anthropic: { label: "Claude", api: "anthropic", local: false, needs_key: true, base_url: "" },
    openai: { label: "OpenAI", api: "openai", local: false, needs_key: true, base_url: "" },
    ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" },
    lmstudio: { label: "LM Studio", api: "openai", local: true, needs_key: false, base_url: "" },
    llamacpp: { label: "llama.cpp", api: "openai", local: true, needs_key: false, base_url: "" },
    custom: { label: "Other", api: "openai", local: true, needs_key: false, base_url: "" },
  },
};

vi.mock("../../../api/client", () => ({
  api: { ai: { config: vi.fn(), draftWildcard: vi.fn() } },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const draft = vi.mocked(api.ai.draftWildcard);

function mountPanel() {
  return mount(AiDraftPanel, {
    props: {
      name: "hair", varBinding: "hair",
      existingValues: ["red hair", ""], existingTags: ["warm"],
      tagGroups: { TONE: ["warm"] },
    },
  });
}

describe("AiDraftPanel", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    draft.mockReset();
  });

  it("sends the editor's draft and shows the suggestions, new tags marked", async () => {
    draft.mockResolvedValue({
      options: [
        { value: "silver hair", weight: 1, tags: ["cool"], negative: "" },
        { value: "auburn hair", weight: 2, tags: ["warm"], negative: "grey" },
      ],
      new_tags: ["cool"], skipped: [{ text: "red hair", reason: "duplicate" }], model: "qwen3.5:9b",
    });
    const w = mountPanel();
    await flushPromises();
    expect(w.text()).toContain("qwen3.5:9b");
    await w.get('[data-test="ai-draft-instruction"]').setValue("more colours");
    await w.get('[data-test="ai-draft-generate"]').trigger("click");
    await flushPromises();

    const body = draft.mock.calls[0][0];
    expect(body.instruction).toBe("more colours");
    expect(body.count).toBe(10);
    // Blank scaffold rows are not sent.
    expect(body.wildcard.payload.options).toEqual([{ value: "red hair" }]);
    expect(body.wildcard.payload.tag_groups).toEqual({ TONE: ["warm"] });

    const rows = w.findAll(".wp-ai-draft__row");
    expect(rows).toHaveLength(2);
    expect(rows[0].get(".wp-ai-draft__tag").attributes("data-new")).toBe("true");
    expect(rows[1].get(".wp-ai-draft__tag").attributes("data-new")).toBe("false");
    expect(w.text()).toContain("skipped 1 duplicate");
    const pending = w.emitted("update:pending") ?? [];
    expect(pending[pending.length - 1]).toEqual([true]);
  });

  it("adds only the ticked rows, in the bulk-add shape", async () => {
    draft.mockResolvedValue({
      options: [
        { value: "a hair", weight: 1, tags: [], negative: "" },
        { value: "b hair", weight: 1, tags: ["x"], negative: "frizz" },
      ],
      new_tags: ["x"], skipped: [], model: "m",
    });
    const w = mountPanel();
    await w.get('[data-test="ai-draft-instruction"]').setValue("go");
    await w.get('[data-test="ai-draft-generate"]').trigger("click");
    await flushPromises();
    await w.findAll(".wp-ai-draft__check")[0].trigger("change");
    expect(w.get('[data-test="ai-draft-add"]').text()).toBe("Add 1 option");
    await w.get('[data-test="ai-draft-add"]').trigger("click");
    expect(w.emitted("commit-options")?.[0]).toEqual([[
      { value: "b hair", weight: 1, tags: ["x"], negative: "frizz" },
    ]]);
    expect(w.find('[data-test="ai-draft-results"]').exists()).toBe(false);
  });

  it("shows the server's error", async () => {
    const { ApiError } = await import("../../../api/client");
    draft.mockRejectedValue(new ApiError(403, "the AI assistant is off"));
    const w = mountPanel();
    await w.get('[data-test="ai-draft-instruction"]').setValue("go");
    await w.get('[data-test="ai-draft-generate"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-draft-error"]').text()).toContain("the AI assistant is off");
  });

  it("explains an empty result", async () => {
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [{ text: "x", reason: "duplicate" }], model: "m" });
    const w = mountPanel();
    await w.get('[data-test="ai-draft-instruction"]').setValue("go");
    await w.get('[data-test="ai-draft-generate"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-draft-error"]').text()).toContain("already in the list");
  });

  it("clamps the count and needs an instruction", async () => {
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [], model: "m" });
    const w = mountPanel();
    expect(w.get('[data-test="ai-draft-generate"]').attributes("disabled")).toBeDefined();
    await w.get('[data-test="ai-draft-instruction"]').setValue("go");
    await w.get('[data-test="ai-draft-count"] input').setValue("500");
    await w.get('[data-test="ai-draft-generate"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0].count).toBe(100);
  });
});
