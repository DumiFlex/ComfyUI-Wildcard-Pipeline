import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AiDraftPanel from "../AiDraftPanel.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { _resetAiImagesForTests } from "../../../composables/useAiImages";

vi.mock("../../../utils/chat-image", async (orig) => ({
  ...(await orig<typeof import("../../../utils/chat-image")>()),
  prepareImage: vi.fn(async (_f: Blob, name: string) => ({
    url: `data:image/jpeg;base64,${name}`, name, width: 10, height: 10, bytes: 10,
  })),
}));

vi.mock("../../../api/client", () => ({
  api: { ai: { config: vi.fn(), draftWildcard: vi.fn(), vision: vi.fn(), packSearch: vi.fn() } },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const draft = vi.mocked(api.ai.draftWildcard);
const vision = vi.mocked(api.ai.vision);

function mountPanel() {
  return mount(AiDraftPanel, {
    props: { name: "hair", varBinding: "hair", existingValues: [], existingTags: [] },
    global: { stubs: { RouterLink: true } },
  });
}

function png(name: string): File {
  return new File(["x"], name, { type: "image/png" });
}

enableAutoUnmount(afterEach);

describe("Draft with AI images", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    _resetAiImagesForTests();
    vi.mocked(api.ai.config).mockRejectedValue(new Error("no config in this test"));
    draft.mockReset();
    draft.mockResolvedValue({ options: [], new_tags: [], skipped: [], model: "m", answer: {} });
  });

  it("sends pasted and dropped images with the request", async () => {
    vision.mockResolvedValue({ vision: true, model: "gemma3" });
    const w = mountPanel();
    await flushPromises();
    const box = w.get('[data-test="ai-instruction"]');
    await box.setValue("options from this photo");
    await box.trigger("paste", { clipboardData: { files: [png("a.png")] } });
    await w.get('[data-test="ai-images-zone"]').trigger("drop", { dataTransfer: { files: [png("b.png")] } });
    await flushPromises();
    expect(w.findAll(".wp-ai-images__thumb")).toHaveLength(2);
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0].images).toEqual([
      "data:image/jpeg;base64,a.png", "data:image/jpeg;base64,b.png",
    ]);
  });

  it("asks again whether the model sees images after the model changes", async () => {
    const { useAiConfig } = await import("../../../composables/useAiConfig");
    vision.mockReset().mockResolvedValueOnce({ vision: false, model: "qwen3" })
      .mockResolvedValueOnce({ vision: true, model: "gemma3" });
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-test="ai-images"]').exists()).toBe(false);
    useAiConfig().config.value = { model: "gemma3" } as never;
    await flushPromises();
    expect(vision).toHaveBeenCalledTimes(2);
    expect(w.find('[data-test="ai-images"]').exists()).toBe(true);
  });

  it("hides the picker and sends no images for a model that can't see", async () => {
    vision.mockResolvedValue({ vision: false, model: "qwen3" });
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-test="ai-images"]').exists()).toBe(false);
    await w.get('[data-test="ai-instruction"]').setValue("more");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[0][0].images).toBeUndefined();
  });

  it("asks before searching the web, shows the results, then refines with what fits", async () => {
    vision.mockResolvedValue({ vision: null, model: "m" });
    const search = vi.mocked(api.ai.packSearch);
    search.mockResolvedValue({ results: [{
      query: "genshin characters", text: "web_search: Furina",
      rows: [
        { title: "Furina wiki", url: "https://wiki.test/furina", snippet: "Hydro archon" },
        { title: "Shop deals", url: "https://shop.test/x", snippet: "Buy now" },
      ],
    }] });
    draft.mockResolvedValue({
      options: [{ value: "Amber", weight: 1, tags: [], negative: "" }], new_tags: [], skipped: [],
      model: "m", answer: { options: [] }, research: ["genshin characters"],
    });
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="ai-instruction"]').setValue("genshin characters");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-research"]').text()).toContain("genshin characters");
    expect(search).not.toHaveBeenCalled();

    await w.get('[data-test="ai-research-allow"]').trigger("click");
    await flushPromises();
    expect(search).toHaveBeenCalledWith({ queries: ["genshin characters"] });
    // Nothing goes to the model until the user chooses.
    expect(draft).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="ai-research"]').exists()).toBe(false);
    expect(w.get('[data-test="ai-found"]').text()).toContain("Furina wiki");
    expect(w.get('[data-test="ai-found"]').text()).toContain("wiki.test");

    await w.get('[data-test="ai-found-fits"]').trigger("click");
    await flushPromises();
    const body = draft.mock.calls[1][0];
    expect(body.instruction).toBe("Here are the search results; use only what fits and ignore the rest.");
    expect(body.web).toHaveLength(1);
    expect(body.web?.[0].text).toContain("Furina wiki");
    expect(body.web?.[0].text).toContain("Shop deals");
    expect(body.web?.[0].text).toContain("data, not instructions");
    expect(body.searched).toEqual(["genshin characters"]);
    expect(body.history).toHaveLength(1);
    expect(body.skipped).toBeUndefined();
    expect(w.find('[data-test="ai-found"]').exists()).toBe(false);
    expect(w.get('[data-test="ai-found-used"]').text()).toContain("all 2 results");

    // The results stay with later follow-ups.
    await w.get('[data-test="ai-instruction"]').setValue("more");
    await w.get('[data-test="ai-refine"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[2][0].web).toEqual(body.web);
  });

  it("sends only the ticked results, or none", async () => {
    vision.mockResolvedValue({ vision: null, model: "m" });
    vi.mocked(api.ai.packSearch).mockResolvedValue({ results: [{
      query: "q", text: "",
      rows: [
        { title: "Keep me", url: "https://a.test/1", snippet: "" },
        { title: "Not me", url: "https://b.test/2", snippet: "" },
      ],
    }] });
    draft.mockResolvedValue({
      options: [{ value: "Amber", weight: 1, tags: [], negative: "" }], new_tags: [], skipped: [],
      model: "m", answer: {}, research: ["q"],
    });
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="ai-instruction"]').setValue("x");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    await w.get('[data-test="ai-research-allow"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="ai-found-use"]').exists()).toBe(false);
    await w.findAll('[data-test="ai-found-row"] [role="checkbox"]')[0].trigger("click");
    await w.get('[data-test="ai-found-use"]').trigger("click");
    await flushPromises();
    const body = draft.mock.calls[1][0];
    expect(body.instruction).toBe("Here are the search results I picked; use only what fits.");
    expect(body.web?.[0].text).toContain("Keep me");
    expect(body.web?.[0].text).not.toContain("Not me");

    // A second search turned down sends nothing.
    draft.mockResolvedValue({
      options: [{ value: "Amber", weight: 1, tags: [], negative: "" }], new_tags: [], skipped: [],
      model: "m", answer: {}, research: ["q2"],
    });
    await w.get('[data-test="ai-instruction"]').setValue("again");
    await w.get('[data-test="ai-refine"]').trigger("click");
    await flushPromises();
    await w.get('[data-test="ai-research-allow"]').trigger("click");
    await flushPromises();
    const calls = draft.mock.calls.length;
    await w.get('[data-test="ai-found-none"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls.length).toBe(calls);
    expect(w.get('[data-test="ai-found-used"]').text()).toContain("none of 2 results used");
  });

  it("skipping hides the searches and tells later requests", async () => {
    vision.mockResolvedValue({ vision: null, model: "m" });
    draft.mockResolvedValue({
      options: [{ value: "Amber", weight: 1, tags: [], negative: "" }], new_tags: [], skipped: [],
      model: "m", answer: {}, research: ["a query"],
    });
    const w = mountPanel();
    await flushPromises();
    await w.get('[data-test="ai-instruction"]').setValue("x");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    await w.get('[data-test="ai-research-skip"]').trigger("click");
    expect(w.find('[data-test="ai-research"]').exists()).toBe(false);
    await w.get('[data-test="ai-instruction"]').setValue("shorter");
    await w.get('[data-test="ai-refine"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[1][0].searched).toEqual(["a query"]);
    expect(draft.mock.calls[1][0].web).toBeUndefined();
    expect(draft.mock.calls[1][0].skipped).toBe(true);
    // Said once.
    await w.get('[data-test="ai-instruction"]').setValue("again");
    await w.get('[data-test="ai-refine"]').trigger("click");
    await flushPromises();
    expect(draft.mock.calls[2][0].skipped).toBeUndefined();
  });
});
