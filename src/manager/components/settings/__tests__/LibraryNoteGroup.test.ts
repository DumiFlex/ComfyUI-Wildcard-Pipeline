import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import LibraryNoteGroup from "../LibraryNoteGroup.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import type { AiConfig } from "../../../api/types";

vi.mock("../../../api/client", () => ({
  api: { ai: { config: vi.fn(), saveConfig: vi.fn(), suggestLibraryNote: vi.fn() } },
  ApiError: class ApiError extends Error {},
}));

function cfg(over: Partial<AiConfig> = {}): AiConfig {
  return { enabled: true, model: "qwen3.5-9b", library_note: "", ...over } as AiConfig;
}

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div/>" } }] });

async function mountIt(over: Partial<AiConfig> = {}) {
  vi.mocked(api.ai.config).mockResolvedValue(cfg(over));
  const w = mount(LibraryNoteGroup, { global: { plugins: [router] } });
  await flushPromises();
  return w;
}

describe("Settings › AI assistant › About my library", () => {
  beforeEach(() => {
    _resetAiConfigForTests();
    vi.mocked(api.ai.config).mockReset();
    vi.mocked(api.ai.saveConfig).mockReset();
    vi.mocked(api.ai.suggestLibraryNote).mockReset();
  });

  it("shows the saved note and saves an edit only on Save", async () => {
    const w = await mountIt({ library_note: "Booru tags." });
    const box = w.get<HTMLTextAreaElement>('[data-test="ai-library-note"]');
    expect(box.element.value).toBe("Booru tags.");
    expect(w.get('[data-test="ai-library-note-save"]').attributes("disabled")).toBeDefined();
    expect(w.get('[data-test="ai-library-note-count"]').text()).toBe("11 / 600");

    await box.setValue("  Booru tags, lowercase.  ");
    expect(api.ai.saveConfig).not.toHaveBeenCalled();
    vi.mocked(api.ai.saveConfig).mockResolvedValue(cfg({ library_note: "Booru tags, lowercase." }));
    await w.get('[data-test="ai-library-note-save"]').trigger("click");
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ library_note: "Booru tags, lowercase." });
    expect(w.get('[data-test="ai-library-note-saved"]').text()).toContain("New chats read it");
    expect(w.find('[data-test="ai-library-note-revert"]').exists()).toBe(false);
  });

  it("blocks a note over 600 characters and puts an edit back", async () => {
    const w = await mountIt({ library_note: "Old." });
    const box = w.get<HTMLTextAreaElement>('[data-test="ai-library-note"]');
    await box.setValue("x".repeat(610));
    expect(w.get('[data-test="ai-library-note-over"]').text()).toContain("10 characters over");
    expect(w.get('[data-test="ai-library-note-save"]').attributes("disabled")).toBeDefined();
    await w.get('[data-test="ai-library-note-revert"]').trigger("click");
    expect(box.element.value).toBe("Old.");
  });

  it("Suggest fills the box without saving", async () => {
    const w = await mountIt();
    vi.mocked(api.ai.suggestLibraryNote).mockResolvedValue({ note: "I use booru tags.", model: "qwen3.5-9b" });
    await w.get('[data-test="ai-library-note"]').setValue("draft so far");
    await w.get('[data-test="ai-library-note-suggest"]').trigger("click");
    await flushPromises();
    expect(api.ai.suggestLibraryNote).toHaveBeenCalledWith({ current: "draft so far" });
    expect(w.get<HTMLTextAreaElement>('[data-test="ai-library-note"]').element.value).toBe("I use booru tags.");
    expect(w.get('[data-test="ai-library-note-suggested"]').text()).toContain("Suggested by qwen3.5-9b");
    expect(api.ai.saveConfig).not.toHaveBeenCalled();
  });

  it("shows why Suggest failed, and is off until a model is set", async () => {
    const w = await mountIt();
    vi.mocked(api.ai.suggestLibraryNote).mockRejectedValue(new Error("the library is empty"));
    await w.get('[data-test="ai-library-note-suggest"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-library-note-error"]').text()).toBe("the library is empty");

    _resetAiConfigForTests();
    const off = await mountIt({ enabled: false });
    expect(off.get('[data-test="ai-library-note-suggest"]').attributes("disabled")).toBeDefined();
  });
});
