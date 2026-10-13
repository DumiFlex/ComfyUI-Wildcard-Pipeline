import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiEditPanel from "../AiEditPanel.vue";
import AiWildcardPanel from "../AiWildcardPanel.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import type { AiConfig, AiWildcardEditAction, WildcardOption } from "../../../api/types";

const CONFIG: AiConfig = {
  enabled: true, provider: "ollama", base_url: "", model: "qwen3.5:9b", unload_after_s: 60, context_max: 16384, model_size: "auto", model_size_auto: "small", tool_format: "auto", embed_model: "", embed_base_url: "", search_engine: "off", search_url: "", search_keys_saved: [], search_engines: { searxng: { label: "SearXNG", needs_key: false }, brave: { label: "Brave Search", needs_key: true }, tavily: { label: "Tavily", needs_key: true }, kagi: { label: "Kagi", needs_key: true } }, key_for_host: null,
  key_set: false, key_from_env: false, keys_saved: [],
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
  api: { ai: { config: vi.fn(), draftWildcard: vi.fn(), editWildcard: vi.fn() } },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const edit = vi.mocked(api.ai.editWildcard);

const OPTS: WildcardOption[] = [
  { id: "null0001", value: "", weight: 1, sub_categories: [], is_null: true },
  { id: "aaaa0001", value: "red cloak", weight: 1, sub_categories: ["winter"] },
  { id: "aaaa0002", value: "hoodie, jeans", weight: 1, sub_categories: [] },
];

function mountEdit(action: AiWildcardEditAction, over: Record<string, unknown> = {}) {
  return mount(AiEditPanel, {
    props: {
      action, name: "outfit", varBinding: "outfit", options: OPTS,
      fromSelection: false, existingTags: ["winter"], ...over,
    },
  });
}

describe("AiEditPanel", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    edit.mockReset();
  });

  it("sends real ids without the null option and lists removals", async () => {
    edit.mockResolvedValue({
      action: "remove", model: "qwen3.5:9b", answer: {}, new_tags: [], skipped: [],
      changes: [{ option_id: "aaaa0002", before: { value: "hoodie, jeans" }, after: null, reason: "modern" }],
    });
    const w = mountEdit("remove");
    expect(w.get('[data-test="ai-edit-scope"]').text()).toContain("all 2 options");
    await w.get('[data-test="ai-instruction"]').setValue("drop anything modern");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    const sent = edit.mock.calls[0][0];
    expect(sent.action).toBe("remove");
    expect(sent.wildcard.payload.options.map((o) => o.id)).toEqual(["aaaa0001", "aaaa0002"]);
    expect(w.get('[data-test="ai-edit-results"]').text()).toContain("hoodie, jeans");
    expect(w.text()).toContain("modern");
    const pending = w.emitted("update:pending") ?? [];
    expect(pending[pending.length - 1]).toEqual([true]);
    await w.get('[data-test="ai-edit-apply"]').trigger("click");
    expect(w.emitted("apply")?.[0][0]).toHaveLength(1);
  });

  it("applies only the ticked changes", async () => {
    edit.mockResolvedValue({
      action: "reweight", model: "m", answer: {}, new_tags: [], skipped: [],
      changes: [
        { option_id: "aaaa0001", before: { weight: 1 }, after: { weight: 0.5 } },
        { option_id: "aaaa0002", before: { weight: 1 }, after: { weight: 2 } },
      ],
    });
    const w = mountEdit("reweight");
    await w.get('[data-test="ai-instruction"]').setValue("cloaks rarer");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("×0.5");
    await w.findAll('[data-test="ai-edit-results"] input[type="checkbox"]')[1].setValue(false);
    await w.get('[data-test="ai-edit-apply"]').trigger("click");
    const applied = w.emitted("apply")?.[0][0] as { option_id: string }[];
    expect(applied.map((c) => c.option_id)).toEqual(["aaaa0001"]);
  });

  it("refuses more than 300 options until the user selects fewer", () => {
    const many: WildcardOption[] = Array.from({ length: 301 }, (_, i) => ({
      id: `${i}`.padStart(8, "0"), value: `opt ${i}`, weight: 1, sub_categories: [],
    }));
    const w = mountEdit("rewrite", { options: many });
    expect(w.find('[data-test="ai-edit-too-many"]').exists()).toBe(true);
    expect(w.get('[data-test="ai-run"]').attributes("disabled")).toBeDefined();
  });

  it("shows a clear message when nothing needs changing", async () => {
    edit.mockResolvedValue({ action: "retag", model: "m", answer: {}, new_tags: [], skipped: [], changes: [] });
    const w = mountEdit("retag");
    await w.get('[data-test="ai-instruction"]').setValue("tag by season");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-error"]').text()).toContain("didn't find anything");
  });
});

describe("AiWildcardPanel", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    edit.mockReset();
  });

  it("shows the model, switches modes and edits only the selection", async () => {
    const w = mount(AiWildcardPanel, {
      props: {
        name: "outfit", varBinding: "outfit", options: OPTS,
        selectedIds: new Set(["aaaa0002"]), existingTags: ["winter"],
      },
    });
    await flushPromises();
    expect(w.text()).toContain("qwen3.5:9b");
    expect(w.get('[data-test="ai-draft-panel"]').isVisible()).toBe(true);
    await w.get('[data-test="ai-mode-retag"]').trigger("click");
    expect(w.get('[data-test="ai-edit-panel"]').isVisible()).toBe(true);
    expect(w.get('[data-test="ai-edit-scope"]').text()).toContain("the 1 option you selected");
    edit.mockResolvedValue({
      action: "retag", model: "m", answer: {}, new_tags: ["street"], skipped: [],
      changes: [{ option_id: "aaaa0002", before: { tags: [] }, after: { tags: ["street"] } }],
    });
    await w.get('[data-test="ai-edit-panel"] [data-test="ai-instruction"]').setValue("tag it");
    await w.get('[data-test="ai-edit-panel"] [data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(edit.mock.calls[0][0].action).toBe("retag");
    await w.get('[data-test="ai-edit-apply"]').trigger("click");
    expect(w.emitted("apply-edits")?.[0][0]).toBe("retag");
  });
});
