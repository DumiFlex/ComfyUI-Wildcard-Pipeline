import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import AiChatDrawer from "../AiChatDrawer.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { _resetAiChatForTests, useAiChat } from "../../../composables/useAiChat";
import { _resetPackBuilderForTests, usePackBuilder } from "../../../composables/usePackBuilder";
import type { AiChatRequest, AiChatResult, AiConfig } from "../../../api/types";
import { defineComponent, ref } from "vue";
import {
  _resetOpenEditorForTests, registerOpenEditor, registerPageNote,
} from "../../../composables/useOpenEditor";
import { _resetAiActionsForTests, pointers, registerAiAction } from "../../../composables/useAiActions";

vi.mock("../../../utils/chat-image", async (orig) => ({
  ...(await orig<typeof import("../../../utils/chat-image")>()),
  // jsdom has no canvas: hand back a fixed shrunk image.
  prepareImage: vi.fn(async (_f: Blob, name: string) => ({
    url: "data:image/jpeg;base64,QUJD", w: 640, h: 480, name })),
}));

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60, context_max: 16384, model_size: "auto", model_size_auto: "small",
  key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "" } },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => {
  const chat = vi.fn();
  return {
    api: {
      ai: {
        config: vi.fn(), chat,
        // The drawer streams; the tests answer through `chat`.
        chatStream: vi.fn((body: unknown, _on: unknown, signal?: AbortSignal) => chat(body, signal)),
        patchChat: vi.fn(() => Promise.resolve({})), chats: vi.fn(), getChat: vi.fn(),
        deleteChat: vi.fn(), compactChat: vi.fn(), vision: vi.fn(), packPlan: vi.fn(), models: vi.fn(), saveConfig: vi.fn(),
      },
      modules: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), get: vi.fn() },
      bundles: { update: vi.fn() },
      categories: { create: vi.fn() },
    },
    ApiError: class ApiError extends Error {
      constructor(public status: number, message: string) { super(message); }
    },
  };
});

const RESULT: AiChatResult = {
  chat_id: "c1",
  message: "Here is a weather wildcard and two more outfits.",
  model: "m",
  steps: [
    { tool: "think", note: "Look for outfits first.", ok: true, think: true },
    { tool: "search", note: 'Searched "outfit"', ok: true },
  ],
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

const SettingsPage = defineComponent({
  template: `<div><div data-setting="ai-context"><span class="wp-set-row__label">Context size</span></div>
    <button data-ai-anchor="save" data-ai-label="Save button">Save</button></div>`,
});
const TestPage = defineComponent({
  setup() {
    registerAiAction("show_test", async (args) => `ran ${JSON.stringify(args.stack)}`);
    return {};
  },
  template: "<div />",
});

function makeRouter() {
  const r = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "dashboard", component: { template: "<div />" } },
      { path: "/wildcards/:id/edit", name: "wildcards-edit", component: { template: "<div />" } },
      { path: "/docs/:page", name: "documentation-page", component: { template: "<div />" } },
      { path: "/settings/:section?", name: "settings", component: SettingsPage },
      { path: "/test", name: "test", component: TestPage },
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
    _resetAiActionsForTests();
    vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
    vi.mocked(api.ai.chat).mockReset().mockResolvedValue(RESULT);
    vi.mocked(api.ai.patchChat).mockClear();
    vi.mocked(api.ai.vision).mockReset().mockResolvedValue({ vision: true, model: "m" });
    vi.mocked(api.ai.models).mockReset().mockResolvedValue({ models: ["m", "big-27b", "nomic-embed-text"] });
    vi.mocked(api.ai.saveConfig).mockReset().mockImplementation(
      async (patch) => ({ ...CONFIG, ...patch }) as AiConfig);
    vi.mocked(api.modules.create).mockReset().mockImplementation(
      async (body) => ({ id: "new1", ...body }) as never);
    vi.mocked(api.modules.update).mockReset().mockImplementation(
      async (id, body) => ({ id, ...body }) as never);
    vi.mocked(api.modules.delete).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(api.modules.get).mockReset().mockResolvedValue(undefined as never);
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

  it("shows many cards of one kind as one group card that applies them all", async () => {
    const make = (n: number) => ({
      pid: `g${n}`, tool: "create_wildcard", title: `Create wildcard W${n}`, summary: `$w${n} with 2 options`,
      preview: ["a", "b"], warnings: n === 2 ? ["W2 names what W1 picks"] : [], after: null,
      op: { op: "create" as const, kind: "module" as const, new_category: "",
        body: { type: "wildcard" as const, name: `W${n}`, category_id: null, tags: [], payload: {} } },
    });
    vi.mocked(api.ai.chat).mockResolvedValueOnce({ ...RESULT, proposals: [1, 2, 3, 4].map(make) });
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("make four wildcards");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    const group = w.get('[data-test="ai-chat-group"]');
    expect(group.text()).toContain("Create 4 wildcards");
    expect(group.findAll('[data-test="ai-group-row"]')).toHaveLength(4);
    // The full cards stay folded until a row opens one.
    expect(w.findAll('[data-test="ai-chat-proposal"]')).toHaveLength(0);
    await group.findAll('[data-test="ai-group-open"]')[1].trigger("click");
    const opened = w.findAll('[data-test="ai-chat-proposal"]');
    expect(opened).toHaveLength(1);
    expect(opened[0].attributes("data-in-group")).toBe("true");
    expect(opened[0].text()).toContain("W2 names what W1 picks");
    // It opens in place, under its own row, with no Apply / Dismiss of its own.
    const rows = group.findAll('[data-test="ai-group-row"]');
    expect(rows[1].find('[data-test="ai-chat-proposal"]').exists()).toBe(true);
    expect(opened[0].find('[data-test="ai-chat-apply"]').exists()).toBe(false);
    expect(opened[0].find('[data-test="ai-chat-dismiss"]').exists()).toBe(false);
    // One row open at a time.
    await group.findAll('[data-test="ai-group-open"]')[2].trigger("click");
    await flushPromises();
    expect(w.findAll('[data-test="ai-chat-proposal"]')).toHaveLength(1);
    expect(rows[2].find('[data-test="ai-chat-proposal"]').exists()).toBe(true);
    await group.get('[data-test="ai-group-apply"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.modules.create).mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(["W1", "W2", "W3", "W4"]);
    expect(w.get('[data-test="ai-group-counts"]').text()).toContain("4 applied");
    expect(w.get('[data-test="ai-group-undo"]').text()).toContain("Undo all 4");
  });

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
    // What it thought is folded under the steps, not shown as the answer.
    const thought = w.get('[data-test="ai-chat-thought"] details');
    expect(thought.find("summary").text()).toBe("Thinking");
    expect((thought.element as HTMLDetailsElement).open).toBe(false);
    expect(thought.text()).toContain("Look for outfits first.");
    const cards = w.findAll('[data-test="ai-chat-proposal"]');
    expect(cards).toHaveLength(3);
    // The third builds on the second, so it waits.
    expect(cards[2].find('[data-test="ai-chat-apply"]').exists()).toBe(false);
    expect(cards[2].get('[data-test="ai-chat-apply-all"]').text()).toBe("Apply all 2");
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
        { pid: "p1", status: "applied", created: "new1" }, { pid: "p2", status: "undone" },
        { pid: "p3", status: "dismissed" },
      ],
    });
    // Each card action is saved with the chat at once, for reopening it.
    expect(api.ai.patchChat).toHaveBeenCalledWith("c1", {
      events: [{ pid: "p1", status: "applied", created: "new1" }],
    });
    await w.get('[data-test="ai-chat-input"]').setValue("again");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect((vi.mocked(api.ai.chat).mock.calls[2][0] as AiChatRequest).events).toBeUndefined();
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
    expect((vi.mocked(api.ai.chat).mock.calls[1][0] as AiChatRequest).message).toBe("hello");
    expect((vi.mocked(api.ai.chat).mock.calls[1][0] as AiChatRequest).chat_id).toBeUndefined();
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
    expect((vi.mocked(api.ai.chat).mock.calls[0][0] as AiChatRequest).page).toEqual({
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

  it("shows a change saved behind the open editor there, clean or not", async () => {
    const options = ref<unknown[]>([1, 2]);
    const dirty = ref(false);
    const rebase = vi.fn(() => { dirty.value = false; });
    const host = defineComponent({
      setup() {
        registerOpenEditor({
          id: "m1", type: "wildcard", dirty: () => dirty.value,
          name: ref("Outfit"), description: ref(""), tags: ref<string[]>([]),
          categoryId: ref<string | null>(null), contentRating: ref<"safe" | "nsfw">("safe"),
          payload: () => ({ options: options.value }),
          setPayload: (p) => { options.value = p.options as unknown[]; },
          rebase,
        });
        return {};
      },
      template: "<div />",
    });
    const editorHost = mount(host);
    // The card was made before the editor opened: it writes the saved row
    // (still the version it was made from), then the editor shows it.
    const row = (options: unknown[]) =>
      ({ id: "m1", name: "Outfit", type: "wildcard", tags: ["warm"], payload: { options, history: [{ at: 1 }] } }) as never;
    vi.mocked(api.modules.get).mockResolvedValueOnce(row([1, 2])).mockResolvedValue(row([1, 2, 3]));
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("add a parka");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    const cards = w.findAll('[data-test="ai-chat-proposal"]');
    await cards[1].get('[data-test="ai-chat-apply"]').trigger("click");
    await flushPromises();
    expect(api.modules.update).toHaveBeenCalledWith("m1", { payload: { options: [1, 2, 3] } });
    expect(options.value).toEqual([1, 2, 3]);
    expect(rebase).toHaveBeenCalledOnce();
    // Unsaved work in the editor: Undo would write over it, so it waits.
    dirty.value = true;
    options.value = [1, 2, 3, "mine"];
    await cards[1].get('[data-test="ai-chat-undo"]').trigger("click");
    await flushPromises();
    expect(options.value).toEqual([1, 2, 3, "mine"]);
    expect(cards[1].text()).toContain("unsaved changes in its editor");
    // Saved since by someone else: Undo would throw that away.
    dirty.value = false;
    vi.mocked(api.modules.get).mockResolvedValue(row([1, 2, 3, 4]));
    vi.mocked(api.modules.update).mockClear();
    await cards[1].get('[data-test="ai-chat-undo"]').trigger("click");
    await flushPromises();
    expect(api.modules.update).not.toHaveBeenCalled();
    expect(cards[1].text()).toContain("changed since this card was applied");
    w.unmount();
    editorHost.unmount();
  });

  it("won't apply a card whose item changed since it was made", async () => {
    vi.mocked(api.modules.get).mockResolvedValue(
      { id: "m1", name: "Outfit", type: "wildcard", tags: [], payload: { options: [1, 2, 9] } } as never);
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("add a parka");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    const card = w.findAll('[data-test="ai-chat-proposal"]')[1];
    await card.get('[data-test="ai-chat-apply"]').trigger("click");
    await flushPromises();
    expect(api.modules.update).not.toHaveBeenCalled();
    expect(card.text()).toContain("Outfit changed since this card was made (its content)");
    w.unmount();
  });

  it("starts a new chat with an empty box", async () => {
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("hello");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    useAiChat().input.value = "Explain this page in simpler words";
    await w.get('[data-test="ai-chat-new"]').trigger("click");
    await flushPromises();
    expect(useAiChat().input.value).toBe("");
    expect((w.get('[data-test="ai-chat-input"]').element as HTMLTextAreaElement).value).toBe("");
    w.unmount();
  });

  it("shows reactions under the user's message, with no empty reply", async () => {
    const { w } = await mountIt();
    vi.mocked(api.ai.chat).mockResolvedValueOnce({
      ...RESULT, message: "", steps: [], proposals: [], reaction: "🎉",
    });
    await w.get('[data-test="ai-chat-input"]').setValue("it finally renders!");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-test="ai-chat-reaction"]').text()).toBe("🎉");
    expect(w.find('[data-test="ai-chat-reply"]').exists()).toBe(false);

    vi.mocked(api.ai.chat).mockResolvedValueOnce({
      chat_id: "c1", aside: true, reaction: "❤️", message: "", proposals: [], steps: [], model: "m",
    });
    await w.get('[data-test="ai-chat-input"]').setValue("thanks!");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    const users = w.findAll('[data-test="ai-chat-user"]');
    expect(users).toHaveLength(2);
    expect(users[1].get('[data-test="ai-chat-reaction"]').text()).toBe("❤️");
    // Edit and Try again stay on the message that got an answer.
    expect(users[1].find('[data-test="ai-chat-edit"]').exists()).toBe(false);
    expect(users[0].find('[data-test="ai-chat-edit"]').exists()).toBe(true);
    w.unmount();
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
    expect((vi.mocked(api.ai.chat).mock.calls[0][0] as AiChatRequest).page).toEqual({
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

  describe("page tools and web search", () => {
    const DONE: AiChatResult = { chat_id: "c1", message: "There it is.", model: "m", steps: [], proposals: [] };

    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn();
      vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    });

    /** The drawer beside the page, so page tools find what the page shows. */
    async function mountWithPage() {
      const router = makeRouter();
      await router.push("/");
      const Shell = defineComponent({
        components: { AiChatDrawer, RouterView },
        template: "<div><RouterView /><AiChatDrawer /></div>",
      });
      const w = mount(Shell, { global: { plugins: [router] }, attachTo: document.body });
      await flushPromises();
      return { w, router };
    }

    async function ask(w: Awaited<ReturnType<typeof mountWithPage>>["w"], text: string) {
      await w.get('[data-test="ai-chat-input"]').setValue(text);
      await w.get('[data-test="ai-chat-send"]').trigger("click");
      await flushPromises();
      await new Promise((r) => setTimeout(r, 60));
      await flushPromises();
    }

    it("opens a page, reads it, points at a part and carries the turn on", async () => {
      vi.mocked(api.ai.chat).mockReset()
        .mockResolvedValueOnce({
          ...DONE, message: "Let me show you.",
          steps: [{ tool: "open", note: "Opened settings › ai", ok: true }],
          pending: [
            { id: "k1", tool: "open", label: "Opened settings › ai", args: { page: "settings", section: "ai" } },
            { id: "k2", tool: "read_page", label: "Read the page", args: {} },
            { id: "k3", tool: "highlight", label: "Pointed at it", args: { anchor: "ai-context", caption: "Set it here" } },
          ],
        })
        .mockResolvedValueOnce(DONE);
      const { w, router } = await mountWithPage();
      useAiChat().open.value = true;
      await ask(w, "where do I set the context size?");
      await vi.waitFor(() => expect(api.ai.chat).toHaveBeenCalledTimes(2), { timeout: 4000 });
      await flushPromises();
      expect(router.currentRoute.value.fullPath).toBe("/settings/ai");
      const resume = vi.mocked(api.ai.chat).mock.calls[1][0];
      expect(resume).toMatchObject({ chat_id: "c1", page: { route: "settings" } });
      const results = "results" in resume ? resume.results : [];
      expect(results[0]).toEqual({ id: "k1", text: "opened" });
      const read = results[1] as { text: string };
      expect(read.text).toContain("[ai-context] Context size");
      expect(read.text).toContain("[save] Save button");
      expect(results[2]).toEqual({ id: "k3", text: "pointed at Context size" });
      expect(w.findAll('[data-test="ai-chat-reply"]')).toHaveLength(2);
      expect(w.text()).toContain("There it is.");
      expect(pointers.value[0]?.caption).toBe("Set it here");
      await flushPromises();
      expect(document.querySelector('[data-test="ai-pointer"]')?.textContent).toContain("Set it here");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(pointers.value).toEqual([]);
      // That Esc closed only the pointer.
      expect(useAiChat().open.value).toBe(true);
      w.unmount();
    });

    it("hands work to a page and reports what it said", async () => {
      vi.mocked(api.ai.chat).mockReset()
        .mockResolvedValueOnce({
          ...DONE, message: "",
          pending: [{ id: "t1", tool: "show_test", label: "Ran 1 item", args: { stack: [{ module: "m1" }], seeds: 20 } }],
        })
        .mockResolvedValueOnce(DONE);
      const { w, router } = await mountWithPage();
      await ask(w, "test the outfit wildcard");
      await vi.waitFor(() => expect(api.ai.chat).toHaveBeenCalledTimes(2), { timeout: 4000 });
      expect(router.currentRoute.value.name).toBe("test");
      const resume = vi.mocked(api.ai.chat).mock.calls[1][0];
      expect("results" in resume && resume.results).toEqual([{ id: "t1", text: 'ran [{"module":"m1"}]' }]);
      w.unmount();
    });

    it("asks before a web search and sends the user's answer", async () => {
      vi.mocked(api.ai.chat).mockReset()
        .mockResolvedValueOnce({
          ...DONE, message: "I'll look that up.",
          pending: [{ id: "s1", tool: "web_search", label: "Web search: bustle", args: { query: "victorian bustle styles" } }],
        })
        .mockResolvedValueOnce(DONE);
      const { w } = await mountWithPage();
      await ask(w, "find victorian outfit words");
      const card = w.get('[data-test="ai-chat-search"]');
      expect(card.get('[data-test="ai-chat-search-query"]').text()).toBe("victorian bustle styles");
      expect(api.ai.chat).toHaveBeenCalledTimes(1);
      expect(w.find('[data-test="ai-chat-loading"]').exists()).toBe(false);
      await card.get('[data-test="ai-chat-search-chat"]').trigger("click");
      await flushPromises();
      expect(vi.mocked(api.ai.chat).mock.calls[1][0]).toMatchObject({
        chat_id: "c1", results: [{ id: "s1", approve: "chat" }],
      });
      expect(w.get('[data-test="ai-chat-search"]').text()).toContain("Allowed for this chat");
      w.unmount();
    });

    it("Stop leaves a waiting search unanswered", async () => {
      vi.mocked(api.ai.chat).mockReset().mockResolvedValueOnce({
        ...DONE, message: "",
        pending: [{ id: "s1", tool: "web_search", label: "Web search: x", args: { query: "x y" } }],
      });
      const { w } = await mountWithPage();
      await ask(w, "search it");
      useAiChat().stop();
      await flushPromises();
      expect(api.ai.chat).toHaveBeenCalledTimes(1);
      expect(useAiChat().loading.value).toBe(false);
      expect(w.get('[data-test="ai-chat-search"]').text()).toContain("Not answered");
      w.unmount();
    });
  });

  it("switches the model from the header, and says the next answer reads the chat again", async () => {
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-model"] [data-test="select-trigger"]').trigger("click");
    await flushPromises();
    const rows = [...document.querySelectorAll<HTMLElement>("[role='option']")];
    // Embedding models can't chat, so they aren't offered.
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["m", "big-27b"]);
    // Before any message, switching says nothing.
    rows[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();
    expect(api.ai.saveConfig).toHaveBeenCalledWith({ model: "big-27b" });
    expect(w.find('[data-test="ai-chat-model-note"]').exists()).toBe(false);
    await w.get('[data-test="ai-chat-input"]').setValue("hi");
    await w.get('[data-test="ai-chat-input"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    await w.get('[data-test="ai-chat-model"] [data-test="select-trigger"]').trigger("click");
    await flushPromises();
    [...document.querySelectorAll<HTMLElement>("[role='option']")][0]
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();
    expect(w.get('[data-test="ai-chat-model-note"]').text()).toContain("reads this chat again");
    w.unmount();
  });

  it("applies a card and the cards it needs, in order", async () => {
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("make weather and more outfits");
    await w.get('[data-test="ai-chat-input"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    const cards = w.findAll('[data-test="ai-chat-proposal"]');
    await cards[2].get('[data-test="ai-chat-apply-all"]').trigger("click");
    await flushPromises();
    expect(cards[1].attributes("data-status")).toBe("applied");
    expect(cards[2].attributes("data-status")).toBe("applied");
    expect(cards[0].attributes("data-status")).toBe("pending");
    w.unmount();
  });

  it("resizes from its left edge", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1600, configurable: true });
    const { w } = await mountIt();
    const grip = w.get('[data-test="ai-chat-grip"]');
    expect(grip.attributes("role")).toBe("separator");
    expect(grip.attributes("aria-valuenow")).toBe("440");
    await grip.trigger("keydown", { key: "ArrowLeft" });
    expect(grip.attributes("aria-valuenow")).toBe("456");
    expect(document.documentElement.style.getPropertyValue("--wp-ai-chat-w")).toBe("456px");
    await grip.trigger("dblclick");
    expect(grip.attributes("aria-valuenow")).toBe("440");
    w.unmount();
  });

  it("shows the answer while it is written", async () => {
    let finish: (r: AiChatResult) => void = () => undefined;
    vi.mocked(api.ai.chatStream).mockImplementationOnce(async (_body, onEvent) => {
      onEvent({ type: "step", n: 1 });
      onEvent({ type: "thinking" });
      onEvent({ type: "tool", step: { tool: "read", note: "Read Weather", ok: true } });
      onEvent({ type: "text", v: "Weather has **two** options" });
      return new Promise<AiChatResult>((resolve) => { finish = resolve; });
    });
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("what is in Weather?");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    const live = w.get('[data-test="ai-chat-live"]');
    expect(live.text()).toContain("Read Weather");
    expect(live.get("strong").text()).toBe("two");
    expect(live.get('[data-test="ai-working-detail"]').text()).toBe("Writing…");
    expect(live.get('[data-test="ai-chat-loading"]').attributes("data-tempo")).toBe("fast");
    finish({ ...RESULT, proposals: [], message: "Weather has two options." });
    await flushPromises();
    expect(w.find('[data-test="ai-chat-live"]').exists()).toBe(false);
    expect(w.get('[data-test="ai-chat-reply"]').text()).toContain("Weather has two options.");
    w.unmount();
  });

  it("runs the last message again, unless a change from it was applied", async () => {
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("make weather");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    vi.mocked(api.ai.chat).mockResolvedValueOnce({ ...RESULT, proposals: [], message: "Second try." });
    await w.get('[data-test="ai-chat-retry"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[1][0]).toEqual({
      chat_id: "c1", retry: true, message: "", page: { route: "dashboard" },
    });
    const replies = w.findAll('[data-test="ai-chat-reply"]');
    expect(replies).toHaveLength(1);
    expect(replies[0].text()).toContain("Second try.");

    vi.mocked(api.ai.chat).mockResolvedValueOnce(RESULT);
    await w.get('[data-test="ai-chat-retry"]').trigger("click");
    await flushPromises();
    await w.get('[data-test="ai-chat-apply"]').trigger("click");
    await flushPromises();
    const again = w.get('[data-test="ai-chat-retry"]');
    expect(again.attributes("disabled")).toBeDefined();
    expect(again.attributes("title")).toContain("Undo the changes");
    w.unmount();
  });

  it("puts the old answer back when a retry fails", async () => {
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').setValue("make weather");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    vi.mocked(api.ai.chat).mockRejectedValueOnce(new Error("undo the changes you applied from that answer first"));
    await w.get('[data-test="ai-chat-retry"]').trigger("click");
    await flushPromises();
    expect(w.findAll('[data-test="ai-chat-proposal"]')).toHaveLength(3);
    expect(w.get('[data-test="ai-chat-error"]').text()).toContain("undo the changes");
    w.unmount();
  });

  it("lists saved chats, reopens one, pins, renames and deletes", async () => {
    const today = new Date().toISOString();
    vi.mocked(api.ai.chats).mockResolvedValue({ chats: [
      { id: "c7", title: "Hair colours", pinned: true, turns: 2, created_at: today, updated_at: today },
      { id: "c8", title: "Cyberpunk pack", pinned: false, turns: 1, created_at: today, updated_at: today },
    ] });
    vi.mocked(api.ai.getChat).mockResolvedValue({
      id: "c7", title: "Hair colours", pinned: true, updated_at: today, waiting: false,
      context: { used: 2000, window: 8192, estimated: false, about: false, compactions: 0 },
      turns: [
        { role: "user", text: "make weather" },
        { role: "assistant", view: { ...RESULT, chat_id: undefined } as never,
          status: { p1: "applied" }, created: { p1: "w1" } },
      ],
    });
    vi.mocked(api.ai.deleteChat).mockResolvedValue({ deleted: true });
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-list"]').trigger("click");
    await flushPromises();
    expect(w.findAll(".wp-ai-chats__label").map((h) => h.text())).toEqual(["Pinned", "Today"]);
    const rows = w.findAll('[data-test="ai-chats-row"]');
    expect(rows.map((r) => r.get('[data-test="ai-chats-open"]').text())).toEqual([
      "Hair colours2 messages", "Cyberpunk pack1 message"]);

    await rows[1].get('[data-test="ai-chats-pin"]').trigger("click");
    await flushPromises();
    expect(api.ai.patchChat).toHaveBeenCalledWith("c8", { pinned: true });

    await rows[1].get('[data-test="ai-chats-rename"]').trigger("click");
    const box = w.get('[data-test="ai-chats-rename-input"]');
    await box.setValue("Neon city");
    await box.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(api.ai.patchChat).toHaveBeenCalledWith("c8", { title: "Neon city" });

    await w.findAll('[data-test="ai-chats-row"]')[1].get('[data-test="ai-chats-delete"]').trigger("click");
    await w.get('[data-test="ai-chats-confirm"]').trigger("click");
    await flushPromises();
    expect(api.ai.deleteChat).toHaveBeenCalledWith("c8");
    expect(w.findAll('[data-test="ai-chats-row"]')).toHaveLength(1);

    await w.get('[data-test="ai-chats-open"]').trigger("click");
    await flushPromises();
    expect(api.ai.getChat).toHaveBeenCalledWith("c7");
    expect(useAiChat().chatId.value).toBe("c7");
    expect(w.get('[data-test="ai-chat-user"]').text()).toBe("make weather");
    const cards = w.findAll('[data-test="ai-chat-proposal"]');
    expect(cards[0].attributes("data-status")).toBe("applied");
    expect(w.get('[data-test="ai-chat-meter"]').text()).toContain("2.0k of 8.2k tokens");
    w.unmount();
  });

  it("shows how full the window is and compacts on request", async () => {
    vi.mocked(api.ai.chat).mockResolvedValue({ ...RESULT, proposals: [],
      context: { used: 6400, window: 8192, estimated: true, about: false, compactions: 0 } });
    vi.mocked(api.ai.compactChat).mockResolvedValue({ compacted: true,
      context: { used: 2100, window: 8192, estimated: true, about: false, compactions: 1 } });
    const { w } = await mountIt();
    expect(w.find('[data-test="ai-chat-meter"]').exists()).toBe(false);
    await w.get('[data-test="ai-chat-input"]').setValue("hi");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    const meter = w.get('[data-test="ai-chat-meter"]');
    expect(meter.text()).toContain("~6.4k of 8.2k tokens");
    expect(meter.attributes("data-high")).toBeDefined();
    expect(meter.attributes("title")).toContain("(estimated)");
    await w.get('[data-test="ai-chat-compact"]').trigger("click");
    await flushPromises();
    expect(api.ai.compactChat).toHaveBeenCalledWith("c1");
    expect(w.get('[data-test="ai-chat-meter"]').text()).toContain("~2.1k");
    expect(w.find('[data-test="ai-chat-compact"]').exists()).toBe(false);
    w.unmount();
  });

  it("attaches images by paste or drop and sends them", async () => {
    const { w } = await mountIt();
    const png = new File(["x"], "cat.png", { type: "image/png" });
    await w.get('[data-test="ai-chat-input"]').trigger("paste", { clipboardData: { files: [png] } });
    await flushPromises();
    expect(w.findAll(".wp-ai-chat__thumb")).toHaveLength(1);
    await w.get('[data-test="ai-chat"]').trigger("dragover", { dataTransfer: { types: ["Files"], files: [] } });
    expect(w.find('[data-test="ai-chat-drop"]').exists()).toBe(true);
    await w.get('[data-test="ai-chat"]').trigger("drop", {
      dataTransfer: { types: ["Files"], files: [new File(["y"], "dog.jpg", { type: "image/jpeg" })] } });
    await flushPromises();
    expect(w.find('[data-test="ai-chat-drop"]').exists()).toBe(false);
    expect(w.findAll(".wp-ai-chat__thumb")).toHaveLength(2);
    await w.findAll('[data-test="ai-chat-unattach"]')[1].trigger("click");
    // With an image and no text, Send is on and image ideas show.
    expect(w.get('[data-test="ai-chat-send"]').attributes("disabled")).toBeUndefined();
    await w.get('[data-test="ai-chat-image-idea"]').trigger("click");
    expect((w.get('[data-test="ai-chat-input"]').element as HTMLTextAreaElement).value)
      .toBe("Make wildcards from this image");
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[0][0]).toMatchObject({
      message: "Make wildcards from this image", images: [{ data: "data:image/jpeg;base64,QUJD" }] });
    expect(w.findAll('[data-test="ai-chat-user-image"]')).toHaveLength(1);
    expect(w.find(".wp-ai-chat__thumb").exists()).toBe(false);
    w.unmount();
  });

  it("says a model can't see images instead of attaching them", async () => {
    vi.mocked(api.ai.vision).mockResolvedValue({ vision: false, model: "rocinante" });
    const { w } = await mountIt();
    expect(w.get('[data-test="ai-chat-attach"]').attributes("disabled")).toBeDefined();
    await w.get('[data-test="ai-chat-input"]').trigger("paste", {
      clipboardData: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await flushPromises();
    expect(w.find(".wp-ai-chat__thumb").exists()).toBe(false);
    expect(w.get('[data-test="ai-chat-error"]').text()).toContain("rocinante can't see images");
    w.unmount();
  });

  it("puts the images back when the message fails", async () => {
    vi.mocked(api.ai.chat).mockRejectedValueOnce(new Error("server down"));
    const { w } = await mountIt();
    await w.get('[data-test="ai-chat-input"]').trigger("paste", {
      clipboardData: { files: [new File(["x"], "a.png", { type: "image/png" })] } });
    await flushPromises();
    await w.get('[data-test="ai-chat-send"]').trigger("click");
    await flushPromises();
    expect(w.findAll(".wp-ai-chat__thumb")).toHaveLength(1);
    expect(w.find('[data-test="ai-chat-user"]').exists()).toBe(false);
    w.unmount();
  });
});
