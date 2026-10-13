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
import { _resetAiActionsForTests, pointer, registerAiAction } from "../../../composables/useAiActions";

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
      expect(pointer.value?.caption).toBe("Set it here");
      await flushPromises();
      expect(document.querySelector('[data-test="ai-pointer"]')?.textContent).toContain("Set it here");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(pointer.value).toBeNull();
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
});
