import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiDraftPanel from "../AiDraftPanel.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import type { AiConfig } from "../../../api/types";

const CONFIG: AiConfig = {
  enabled: true, provider: "ollama", base_url: "", model: "qwen3.5:9b", unload_after_s: 60, context_max: 16384, model_size: "auto", model_size_auto: "small", tool_format: "auto", allow_delete: false, auto_apply: false,
  embed_key_set: false, embed_key_own: false, local: true, thinking: "auto", embed_model: "", embed_base_url: "", embed_api: "auto", search_engine: "off", search_url: "", search_keys_saved: [], search_engines: { searxng: { label: "SearXNG", needs_key: false }, brave: { label: "Brave Search", needs_key: true }, tavily: { label: "Tavily", needs_key: true }, kagi: { label: "Kagi", needs_key: true } }, reader_engine: "builtin", reader_url: "", reader_keys_saved: [], reader_engines: { builtin: { label: "Built in (page text)", needs_key: false, needs_url: false, base_url: "" }, crawl4ai: { label: "Crawl4AI (your server)", needs_key: false, needs_url: true, base_url: "" }, firecrawl: { label: "Firecrawl", needs_key: true, needs_url: false, base_url: "https://api.firecrawl.dev" } }, danbooru_lookup: false, web_always_allow: false, key_for_host: null,
  key_set: false, key_from_env: false, keys_saved: [],
  presets: {
    anthropic: { label: "Claude", api: "anthropic", local: false, needs_key: true, base_url: "", embeds: false, embed_model: "", embed_note: "" },
    openai: { label: "OpenAI", api: "openai", local: false, needs_key: true, base_url: "", embeds: true, embed_model: "", embed_note: "" },
    openrouter: { label: "OpenRouter", api: "openai", local: false, needs_key: true, base_url: "https://openrouter.ai/api/v1", embeds: true, embed_model: "", embed_note: "" },
    ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "", embeds: true, embed_model: "", embed_note: "" },
    lmstudio: { label: "LM Studio", api: "openai", local: true, needs_key: false, base_url: "", embeds: true, embed_model: "", embed_note: "" },
    llamacpp: { label: "llama.cpp", api: "openai", local: true, needs_key: false, base_url: "", embeds: false, embed_model: "", embed_note: "" },
    custom: { label: "Other", api: "openai", local: true, needs_key: false, base_url: "", embeds: true, embed_model: "", embed_note: "" },
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
      new_tags: ["cool"], skipped: [{ text: "red hair", reason: "duplicate" }], model: "qwen3.5:9b", answer: {},
    });
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="ai-instruction"]').setValue("more colours");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();

    const body = draft.mock.calls[0][0];
    expect(body.instruction).toBe("more colours");
    expect(body.count).toBe(10);
    // Blank scaffold rows are not sent.
    expect(body.wildcard.payload.options).toEqual([{ value: "red hair" }]);
    expect(body.wildcard.payload.tag_groups).toEqual({ TONE: ["warm"] });
    // A new wildcard has no id to send.
    expect(body.wildcard).not.toHaveProperty("id");

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
      new_tags: ["x"], skipped: [], model: "m", answer: {},
    });
    const w = mountPanel();
    await w.get('[data-test="ai-instruction"]').setValue("go");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    await w.findAll(".wp-ai-draft__check [role='checkbox']")[0].trigger("click");
    expect(w.get('[data-test="ai-draft-add"]').text()).toBe("Add 1 option");
    await w.get('[data-test="ai-draft-add"]').trigger("click");
    expect(w.emitted("commit-options")?.[0]).toEqual([[
      { value: "b hair", weight: 1, tags: ["x"], negative: "frizz" },
    ]]);
    expect(w.find('[data-test="ai-draft-results"]').exists()).toBe(false);
  });

  it("adds the tag groups the ticked rows use, before the options", async () => {
    draft.mockResolvedValue({
      options: [
        { value: "school uniform", weight: 1, tags: ["loafers"], negative: "" },
        { value: "hiking gear", weight: 1, tags: ["boots"], negative: "" },
      ],
      new_tags: ["loafers", "boots"], skipped: [], model: "m", answer: {},
      groups: [{ name: "SHOES", kind: "accepts", tags: ["loafers", "boots"] }],
    });
    const w = mount(AiDraftPanel, {
      props: {
        name: "outfit", varBinding: "outfit", existingValues: [], existingTags: [],
        tagGroups: { STYLE: [] }, tagGroupKinds: {},
      },
    });
    await w.get('[data-test="ai-instruction"]').setValue("outfits and their shoes");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-draft-groups"]').text()).toContain("SHOES");
    // Untick hiking gear: its "boots" no longer goes into the group.
    await w.findAll(".wp-ai-draft__check [role='checkbox']")[1].trigger("click");
    await w.get('[data-test="ai-draft-add"]').trigger("click");
    expect(w.emitted("commit-groups")?.[0]).toEqual([[
      { name: "SHOES", kind: "accepts", tags: ["loafers"] },
    ]]);
    expect(w.emitted("commit-options")?.[0][0]).toHaveLength(1);
  });

  it("shows the server's error", async () => {
    const { ApiError } = await import("../../../api/client");
    draft.mockRejectedValue(new ApiError(403, "the AI assistant is off"));
    const w = mountPanel();
    await w.get('[data-test="ai-instruction"]').setValue("go");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-error"]').text()).toContain("the AI assistant is off");
  });

  it("explains an empty result", async () => {
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [{ text: "x", reason: "duplicate" }], model: "m", answer: {} });
    const w = mountPanel();
    await w.get('[data-test="ai-instruction"]').setValue("go");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-error"]').text()).toContain("already in the list");
  });

  it("clamps the count and needs an instruction", async () => {
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [], model: "m", answer: {} });
    const w = mountPanel();
    expect(w.get('[data-test="ai-run"]').attributes("disabled")).toBeDefined();
    await w.get('[data-test="ai-instruction"]').setValue("go");
    await w.get('[data-test="ai-draft-count"]').setValue("500");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0].count).toBe(100);
  });

  it("takes How many from the typed request and sends option tags", async () => {
    // Bench W18: "draft 6 desert weather options" drafted 10.
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [], model: "m", answer: {} });
    const w = mount(AiDraftPanel, {
      props: {
        name: "weather", varBinding: "weather", existingValues: ["rain"], existingTags: ["wet"],
        existingOptions: [{ value: "rain", sub_categories: ["wet"] }, { value: "" }],
      },
    });
    await w.get('[data-test="ai-instruction"]').setValue("draft 6 desert weather options");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0].count).toBe(6);
    expect((w.get('[data-test="ai-draft-count"]').element as HTMLInputElement).value).toBe("6");
    expect(draft.mock.calls[0][0].wildcard.payload.options).toEqual([{ value: "rain", sub_categories: ["wet"] }]);
  });

  it("lets the server read How many from a request in another language", async () => {
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [], model: "m", answer: {}, count: 6 });
    const w = mountPanel();
    await w.get('[data-test="ai-instruction"]').setValue("Entwirf sechs Wüstenwetter-Optionen");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0].count_auto).toBe(true);
    expect((w.get('[data-test="ai-draft-count"]').element as HTMLInputElement).value).toBe("6");
  });

  it("keeps a count typed by hand", async () => {
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [], model: "m", answer: {}, count: 4 });
    const w = mountPanel();
    await w.get('[data-test="ai-draft-count"]').setValue("4");
    await w.get('[data-test="ai-instruction"]').setValue("Entwirf Wüstenwetter-Optionen");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0]).not.toHaveProperty("count_auto");
    expect(draft.mock.calls[0][0].count).toBe(4);
  });

  it("lists left-off tags and negatives apart from skipped options", async () => {
    draft.mockResolvedValue({
      options: [{ value: "dust storm", weight: 1, tags: ["dry"], negative: "" }], new_tags: [],
      skipped: [{ text: "#desert", reason: "on every new option, so it filters nothing" },
        { text: "2 negatives", reason: "not asked for" }, { text: "sand", reason: "duplicate" }],
      model: "m", answer: {},
    });
    const w = mountPanel();
    await w.get('[data-test="ai-instruction"]').setValue("desert weather");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(w.text()).toContain("skipped 1 duplicate");
    expect(w.text()).toContain("left off #desert (on every new option, so it filters nothing), 2 negatives (not asked for)");
  });

  it("sends a saved wildcard's id, so it isn't offered as its own reference", async () => {
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [], model: "m", answer: {} });
    const w = mount(AiDraftPanel, {
      props: { moduleId: "abcd1234", name: "hair", varBinding: "hair", existingValues: [], existingTags: [] },
    });
    await w.get('[data-test="ai-instruction"]').setValue("more");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0].wildcard.id).toBe("abcd1234");
  });
});
