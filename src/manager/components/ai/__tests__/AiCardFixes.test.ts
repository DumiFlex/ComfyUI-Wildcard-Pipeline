import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AiChatDrawer from "../AiChatDrawer.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { _resetAiChatForTests } from "../../../composables/useAiChat";
import type { AiChatProposal, AiChatResult, AiConfig } from "../../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60, context_max: 16384,
  model_size: "auto", model_size_auto: "small", key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => {
  const chat = vi.fn();
  return {
    api: {
      ai: {
        config: vi.fn(), chat,
        chatStream: vi.fn((body: unknown, _on: unknown, signal?: AbortSignal) => chat(body, signal)),
        patchChat: vi.fn(() => Promise.resolve({})), chats: vi.fn(), getChat: vi.fn(),
        deleteChat: vi.fn(), compactChat: vi.fn(), vision: vi.fn(), packPlan: vi.fn(), models: vi.fn(),
        saveConfig: vi.fn(),
      },
      modules: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      bundles: { update: vi.fn() },
      categories: { create: vi.fn() },
    },
    ApiError: class ApiError extends Error {
      constructor(public status: number, message: string) { super(message); }
    },
  };
});

const BLEED = "Options name camera (3 of 4), which belongs in its own wildcard";
const DUPES = "2 options repeat another option";
const MODEL_ONLY = "Looks like a lookup table";

function card(extra: Partial<AiChatProposal> = {}): AiChatProposal {
  const options = Array.from({ length: 150 }, (_, i) => ({
    id: `o${i}`, value: i === 0 ? "w".repeat(600) : `option ${i}, close-up`, weight: 1,
  }));
  return {
    pid: "p1", tool: "create_wildcard", title: "Create wildcard Outfit", summary: "$outfit with 150 options",
    preview: [], after: null,
    warnings: [BLEED, DUPES, MODEL_ONLY, "w4", "w5"],
    fixes: [
      { warning: BLEED, key: "scope:camera", label: "Remove camera words" },
      { warning: DUPES, key: "dupes", label: "Merge the repeats" },
    ],
    op: { op: "create", kind: "module", new_category: "", body: {
      type: "wildcard", name: "Outfit", description: "d ".repeat(400),
      tags: Array.from({ length: 40 }, (_, i) => `tag${i}`),
      payload: { variable_name: "outfit", options },
    } },
    ...extra,
  } as unknown as AiChatProposal;
}

function result(p: AiChatProposal): AiChatResult {
  return { chat_id: "c1", message: "Here it is.", model: "m", steps: [], proposals: [p] };
}

describe("chat card fixes, caps and the magnifier", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    _resetAiChatForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.vision).mockResolvedValue({ vision: true, model: "m" });
    vi.mocked(api.ai.patchChat).mockReset().mockResolvedValue({} as never);
  });

  async function start(p: AiChatProposal) {
    vi.mocked(api.ai.chat).mockReset().mockResolvedValue(result(p));
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/", name: "dashboard", component: { template: "<div />" } },
    ] });
    await router.push("/");
    const w = mount(AiChatDrawer, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    await w.get('[data-test="ai-chat-input"]').setValue("make outfits");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    return w;
  }

  it("caps warnings and tags, fixes on the card and tells the model", async () => {
    const fixed = { type: "wildcard", name: "Outfit", payload: { variable_name: "outfit", options: [] } };
    vi.mocked(api.ai.patchChat).mockResolvedValue({ fixed: { p1: fixed } } as never);
    const w = await start(card());
    const c = w.get('[data-test="ai-chat-proposal"]');
    expect(c.findAll('[data-test="ai-chat-warning"]')).toHaveLength(3);
    expect(c.get('[data-test="ai-chat-more-warnings"]').text()).toBe("2 more warnings");
    expect(c.text()).toContain("+30");
    // Fixable warnings get the card's fix, the other one asks the model.
    expect(c.findAll('[data-test="ai-chat-fix"]').map((b) => b.text())).toEqual([
      "Remove camera words", "Merge the repeats"]);
    expect(c.findAll('[data-test="ai-chat-ask-fix"]')).toHaveLength(1);
    expect(c.get('[data-test="ai-chat-fix-all"]').text()).toBe("Fix all 2");

    await c.get('[data-test="ai-chat-fix"]').trigger("click");
    await flushPromises();
    expect(api.ai.patchChat).toHaveBeenCalledWith("c1", { events: [{ pid: "p1", fix: "scope:camera" }] });
    expect(c.text()).not.toContain(BLEED);
    expect(c.findAll('[data-test="ai-chat-fix"]').map((b) => b.text())).toEqual(["Merge the repeats"]);
    expect(c.find('[data-test="ai-chat-fix-all"]').exists()).toBe(false);

    // The next message tells the model what the card did.
    await w.get('[data-test="ai-chat-input"]').setValue("ok");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[1][0]).toMatchObject({
      events: [{ pid: "p1", fix: "scope:camera", label: "Remove camera words" }],
    });
    w.unmount();
  });

  it("asks the model to fix a warning the card can't fix", async () => {
    const w = await start(card());
    await w.get('[data-test="ai-chat-ask-fix"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[1][0]).toMatchObject({
      message: `Fix card p1 ("Create wildcard Outfit"): ${MODEL_ONLY}`,
    });
    w.unmount();
  });

  it("opens the whole card in the magnifier and applies from there", async () => {
    vi.mocked(api.modules.create).mockReset().mockImplementation(
      async (body) => ({ id: "new1", ...body }) as never);
    const w = await start(card());
    await w.get('[data-test="ai-chat-zoom"]').trigger("click");
    await flushPromises();
    const modal = document.querySelector('[data-test="ai-card-preview"]');
    expect(modal).not.toBeNull();
    expect(modal!.querySelectorAll("ol > li")).toHaveLength(150);
    expect(modal!.textContent).toContain("#tag39");
    expect(modal!.textContent).toContain("w5");
    // Esc closes the preview, not the chat.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(document.querySelector('[data-test="ai-card-preview"]')).toBeNull();
    await w.get('[data-test="ai-chat-zoom"]').trigger("click");
    await flushPromises();
    (document.querySelector('[data-test="ai-preview-apply"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(api.modules.create).toHaveBeenCalled();
    expect(document.querySelector('[data-test="ai-card-preview"]')).toBeNull();
    expect(w.get('[data-test="ai-chat-proposal"]').attributes("data-status")).toBe("applied");
    w.unmount();
  });

  it("copies an answer as text and offers to edit the last message", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const w = await start(card({ }));
    await w.get('[data-test="ai-chat-copy"]').trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith("Here it is.");
    expect(w.get('[data-test="ai-chat-copy"]').attributes("aria-label")).toBe("Copied");
    await w.get('[data-test="ai-chat-edit"]').trigger("click");
    expect((w.get('[data-test="ai-chat-input"]').element as HTMLTextAreaElement).value).toBe("make outfits");
    expect(w.find('[data-test="ai-chat-editing"]').exists()).toBe(true);
    await w.get('[data-test="ai-chat-edit-cancel"]').trigger("click");
    expect(w.find('[data-test="ai-chat-editing"]').exists()).toBe(false);
    w.unmount();
  });
});
