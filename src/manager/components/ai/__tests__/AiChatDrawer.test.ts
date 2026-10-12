import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AiChatDrawer from "../AiChatDrawer.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { _resetAiChatForTests, chatMessages, useAiChat } from "../../../composables/useAiChat";
import type { AiChatResult, AiConfig } from "../../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60,
  key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => ({
  api: {
    ai: { config: vi.fn(), chat: vi.fn() },
    modules: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    bundles: { update: vi.fn() },
    categories: { create: vi.fn() },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const RESULT: AiChatResult = {
  message: "Here is a weather wildcard and two more outfits.",
  model: "m",
  steps: [{ tool: "search", note: 'Searched "outfit"', ok: true }],
  proposals: [
    {
      pid: "p1", tool: "create_wildcard", title: "Create wildcard Weather",
      summary: "$weather with 2 options", preview: ["rain", "snow"], warnings: [], after: null,
      op: {
        op: "create", kind: "module", new_category: "Scenes",
        body: { type: "wildcard", name: "Weather", category_id: null, tags: [], payload: {} },
      },
    },
    {
      pid: "p2", tool: "add_options", title: "Add 1 options to Outfit", summary: "2 → 3 options",
      preview: ["parka"], warnings: [], after: null,
      op: {
        op: "update", kind: "module", type: "wildcard", id: "m1", name: "Outfit",
        body: { payload: { options: [1, 2, 3] } }, before: { payload: { options: [1, 2] } },
      },
    },
    {
      pid: "p3", tool: "add_options", title: "Add 1 options to Outfit", summary: "3 → 4 options",
      preview: ["scarf"], warnings: ["Builds on the earlier change to Outfit; apply that one first"],
      after: "p2",
      op: {
        op: "update", kind: "module", type: "wildcard", id: "m1", name: "Outfit",
        body: { payload: { options: [1, 2, 3, 4] } }, before: { payload: { options: [1, 2, 3] } },
      },
    },
  ],
};

function makeRouter() {
  const r = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "dashboard", component: { template: "<div />" } },
      { path: "/wildcards/:id/edit", name: "wildcards-edit", component: { template: "<div />" } },
    ],
  });
  return r;
}

describe("AiChatDrawer", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    _resetAiChatForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.chat).mockReset().mockResolvedValue(RESULT);
    vi.mocked(api.modules.create).mockReset().mockImplementation(
      async (body) => ({ id: "new1", ...body }) as never);
    vi.mocked(api.modules.update).mockReset().mockImplementation(
      async (id, body) => ({ id, ...body }) as never);
    vi.mocked(api.modules.delete).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(api.categories.create).mockReset().mockResolvedValue({
      id: "c9", name: "Scenes", color: null, icon: null, sort_order: 0,
    });
  });

  async function mountIt() {
    const router = makeRouter();
    await router.push("/");
    const w = mount(AiChatDrawer, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    return { w, router };
  }

  it("sends the chat, shows steps and proposal cards, applies in order", async () => {
    const { w, router } = await mountIt();
    expect(w.find('[data-test="ai-chat-empty"]').exists()).toBe(true);
    await w.get('[data-test="ai-chat-suggestion"]').trigger("click");
    await w.get('[data-test="ai-chat-input"]').setValue("make weather and more outfits");
    await w.get('[data-test="ai-chat-input"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[0][0]).toEqual({
      messages: [{ role: "user", content: "make weather and more outfits" }],
      page: { route: "dashboard" },
    });
    expect(w.get('[data-test="ai-chat-user"]').text()).toBe("make weather and more outfits");
    expect(w.get('[data-test="ai-chat-steps"]').text()).toContain('Searched "outfit"');
    const cards = w.findAll('[data-test="ai-chat-proposal"]');
    expect(cards).toHaveLength(3);
    // The third builds on the second, so it waits.
    expect(cards[2].get('[data-test="ai-chat-apply"]').attributes("disabled")).toBeDefined();
    expect(cards[2].text()).toContain('Apply "Add 1 options to Outfit" first');

    await cards[0].get('[data-test="ai-chat-apply"]').trigger("click");
    await flushPromises();
    expect(api.categories.create).toHaveBeenCalledWith({ name: "Scenes" });
    expect(vi.mocked(api.modules.create).mock.calls[0][0]).toMatchObject({
      type: "wildcard", name: "Weather", category_id: "c9",
    });
    expect(cards[0].attributes("data-status")).toBe("applied");

    await cards[1].get('[data-test="ai-chat-apply"]').trigger("click");
    await flushPromises();
    expect(api.modules.update).toHaveBeenCalledWith("m1", { payload: { options: [1, 2, 3] } });
    expect(cards[2].get('[data-test="ai-chat-apply"]').attributes("disabled")).toBeUndefined();

    await cards[0].get('[data-test="ai-chat-open"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/wildcards/new1/edit");

    await cards[1].get('[data-test="ai-chat-undo"]').trigger("click");
    await flushPromises();
    expect(api.modules.update).toHaveBeenLastCalledWith("m1", { payload: { options: [1, 2] } });
    expect(cards[1].attributes("data-status")).toBe("pending");

    await cards[2].get('[data-test="ai-chat-dismiss"]').trigger("click");
    const chat = useAiChat();
    expect(chatMessages(chat.entries.value)[1].content).toBe([
      "Here is a weather wildcard and two more outfits.",
      '[Proposal p1 "Create wildcard Weather": applied]',
      '[Proposal p2 "Add 1 options to Outfit": not applied yet]',
      '[Proposal p3 "Add 1 options to Outfit": dismissed]',
    ].join("\n"));
    w.unmount();
  });

  it("puts the message back on an error and resets with New chat", async () => {
    vi.mocked(api.ai.chat).mockRejectedValueOnce(new Error("model is down"));
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("hello");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-chat-error"]').text()).toBe("model is down");
    expect((w.get('[data-test="ai-chat-input"]').element as HTMLTextAreaElement).value).toBe("hello");
    expect(w.find('[data-test="ai-chat-user"]').exists()).toBe(false);
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(w.findAll('[data-test="ai-chat-reply"]')).toHaveLength(1);
    const history = vi.mocked(api.ai.chat).mock.calls[1][0].messages;
    expect(history).toEqual([{ role: "user", content: "hello" }]);
    await w.get('[data-test="ai-chat-new"]').trigger("click");
    expect(w.find('[data-test="ai-chat-empty"]').exists()).toBe(true);
    w.unmount();
  });
});
