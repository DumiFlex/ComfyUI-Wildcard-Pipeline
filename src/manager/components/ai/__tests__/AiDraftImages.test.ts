import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  api: { ai: { config: vi.fn(), draftWildcard: vi.fn(), vision: vi.fn() } },
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
});
