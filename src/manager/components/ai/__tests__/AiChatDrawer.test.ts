import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AiChatDrawer from "../AiChatDrawer.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { _resetAiChatForTests, useAiChat } from "../../../composables/useAiChat";
import { _resetPackBuilderForTests, usePackBuilder } from "../../../composables/usePackBuilder";
import type { AiChatResult, AiConfig } from "../../../api/types";
import { defineComponent, ref } from "vue";
import {
  _resetOpenEditorForTests, registerOpenEditor, registerPageNote,
} from "../../../composables/useOpenEditor";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60, context_max: 16384, model_size: "auto", model_size_auto: "small",
  key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => ({
  api: {
    ai: { config: vi.fn(), chat: vi.fn(), packPlan: vi.fn() },
    modules: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    bundles: { update: vi.fn() },
    categories: { create: vi.fn() },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const RESULT: AiChatResult = {
  chat_id: "c1",
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
      { path: "/docs/:page", name: "documentation-page", component: { template: "<div />" } },
      { path: "/settings/:section?", name: "settings", component: { template: "<div />" } },
      { path: "/test", name: "test", component: { template: "<div />" } },
      { path: "/pack-builder", name: "pack-builder", component: { template: "<div />" } },
    ],
  });
  return r;
}

describe("AiChatDrawer", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    _resetAiChatForTests();
    _resetOpenEditorForTests();
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
      message: "make weather and more outfits",
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
    // The next message says what happened to each card, once.
    await w.get('[data-test="ai-chat-input"]').setValue("thanks");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[1][0]).toEqual({
      message: "thanks", chat_id: "c1", page: { route: "wildcards-edit", id: "new1" },
      events: [
        { pid: "p1", status: "applied" }, { pid: "p2", status: "undone" },
        { pid: "p3", status: "dismissed" },
      ],
    });
    await w.get('[data-test="ai-chat-input"]').setValue("again");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[2][0].events).toBeUndefined();
    expect(useAiChat().chatId.value).toBe("c1");
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
    expect(vi.mocked(api.ai.chat).mock.calls[1][0].message).toBe("hello");
    expect(vi.mocked(api.ai.chat).mock.calls[1][0].chat_id).toBeUndefined();
    expect(useAiChat().chatId.value).toBe("c1");
    await w.get('[data-test="ai-chat-new"]').trigger("click");
    expect(w.find('[data-test="ai-chat-empty"]').exists()).toBe(true);
    expect(useAiChat().chatId.value).toBeNull();
    w.unmount();
  });

  it("sends the open editor and the page note, and puts changes into the editor", async () => {
    const options = ref<unknown[]>([1, 2]);
    const name = ref("Outfit");
    const host = defineComponent({
      setup() {
        registerOpenEditor({
          id: "m1", type: "wildcard", dirty: () => true,
          name, description: ref(""), tags: ref<string[]>([]), categoryId: ref<string | null>(null),
          contentRating: ref<"safe" | "nsfw">("safe"),
          payload: () => ({ options: options.value }),
          setPayload: (p) => { options.value = p.options as unknown[]; },
        });
        registerPageNote(() => "Wildcard editor with 2 options");
        return {};
      },
      template: "<div />",
    });
    const editorHost = mount(host);
    const toEditor = (pid: string, after: string | null, from: unknown[], to: unknown[]) => ({
      pid, tool: "edit_options", title: `Change ${pid}`, summary: "", preview: [], warnings: [], after,
      op: {
        op: "update" as const, kind: "module" as const, type: "wildcard", id: "m1", name: "Outfit",
        basis: "editor" as const, body: { payload: { options: to } }, before: { payload: { options: from } },
      },
    });
    vi.mocked(api.ai.chat).mockResolvedValueOnce({
      chat_id: "c1",
      message: "Here.", model: "m", steps: [],
      proposals: [
        toEditor("p1", null, [1, 2], [1, 2, 3]),
        toEditor("p2", "p1", [1, 2, 3], [2, 3]),
        { pid: "p3", tool: "open", title: "Open the docs: Combine", summary: "docs", preview: [],
          warnings: [], after: null, op: { op: "open", kind: "doc", type: "doc", id: "combine" } },
        { pid: "p4", tool: "open", title: "Go to Settings › ai", summary: "page", preview: [],
          warnings: [], after: null,
          op: { op: "open", kind: "page", type: "page", id: "settings", section: "ai" } },
      ],
    });
    const router = makeRouter();
    await router.push("/wildcards/m1/edit");
    const w = mount(AiChatDrawer, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    expect(w.findAll('[data-test="ai-chat-suggestion"]')[0].text()).toBe("What could make this better?");
    await w.get('[data-test="ai-chat-input"]').setValue("tidy this");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[0][0].page).toEqual({
      route: "wildcards-edit", id: "m1", note: "Wildcard editor with 2 options",
      editor: {
        id: "m1", name: "Outfit", description: "", tags: [], category_id: null,
        content_rating: "safe", payload: { options: [1, 2] }, dirty: true,
      },
    });
    const cards = w.findAll('[data-test="ai-chat-proposal"]');
    expect(cards[0].text()).toContain("Goes into the open editor");
    await cards[0].get('[data-test="ai-chat-apply"]').trigger("click");
    await flushPromises();
    expect(api.modules.update).not.toHaveBeenCalled();
    expect(options.value).toEqual([1, 2, 3]);
    expect(cards[0].attributes("data-status")).toBe("editor");
    expect(cards[0].get('[data-test="ai-chat-in-editor"]').text()).toContain("Save there");
    // The second builds on the first, which is now in the editor.
    expect(cards[1].get('[data-test="ai-chat-apply"]').attributes("disabled")).toBeUndefined();
    await cards[0].get('[data-test="ai-chat-undo"]').trigger("click");
    await flushPromises();
    expect(options.value).toEqual([1, 2]);
    // An edit made in the editor after asking makes the suggestion stale.
    await cards[0].get('[data-test="ai-chat-apply"]').trigger("click");
    await flushPromises();
    options.value = [9];
    await flushPromises();
    expect(cards[1].text()).toContain("The editor changed since; ask again");

    await cards[2].get('[data-test="ai-chat-open"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/docs/combine");
    await cards[3].get('[data-test="ai-chat-open"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/settings/ai");
    w.unmount();
    editorHost.unmount();
  });

  it("names the docs page being read", async () => {
    const router = makeRouter();
    await router.push("/docs/combine");
    const w = mount(AiChatDrawer, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    expect(w.findAll('[data-test="ai-chat-suggestion"]')[0].text()).toBe("Explain this page in simpler words");
    await w.get('[data-test="ai-chat-input"]').setValue("explain");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[0][0].page).toEqual({
      route: "documentation-page", doc: "combine",
    });
    w.unmount();
  });

  it("hands a pack to the Pack builder and starts the plan", async () => {
    _resetPackBuilderForTests();
    vi.mocked(api.ai.packPlan).mockReset().mockReturnValue(new Promise(() => {}));
    vi.mocked(api.ai.chat).mockResolvedValueOnce({
      chat_id: "c1",
      message: "Here it is.", model: "m", steps: [],
      proposals: [{
        pid: "p1", tool: "plan_pack", title: "Plan this pack in the Pack builder", summary: "pack",
        preview: ["Medieval character"], warnings: [], after: null,
        op: { op: "open", kind: "pack", type: "pack", id: "pack-builder", description: "Medieval character" },
      }],
    });
    const { w, router } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("yes");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    const open = w.get('[data-test="ai-chat-open"]');
    expect(open.text()).toBe("Plan it");
    await open.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("pack-builder");
    expect(usePackBuilder().convo.instruction.value).toBe("Medieval character");
    expect(vi.mocked(api.ai.packPlan).mock.calls[0][0]).toMatchObject({ instruction: "Medieval character" });
    w.unmount();
  });

  it("renders Markdown and opens mentioned items from their chips", async () => {
    vi.mocked(api.ai.chat).mockResolvedValueOnce({
      chat_id: "c1",
      message: "**Characters:**\n- [[Hair Color]] sets `$hair`\n- [[Gone]]", model: "m", steps: [], proposals: [],
      refs: { "Hair Color": { id: "w1", type: "wildcard", name: "Hair Color" } },
    });
    const { w, router } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("characters?");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    const msg = w.get('[data-test="ai-msg"]');
    expect(msg.find("ul").exists()).toBe(true);
    expect(msg.find("code").text()).toBe("$hair");
    const chips = msg.findAll(".wp-ai-msg__chip");
    expect(chips.map((c) => c.text())).toEqual(["Hair Color", "Gone"]);
    await chips[0].trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/wildcards/w1/edit");
    w.unmount();
  });
});
