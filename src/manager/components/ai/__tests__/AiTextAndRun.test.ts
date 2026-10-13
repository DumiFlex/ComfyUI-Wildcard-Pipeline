import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AiTextPanel from "../AiTextPanel.vue";
import AiChatDrawer from "../AiChatDrawer.vue";
import AiRunBar from "../../test-runner/AiRunBar.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { _resetAiChatForTests, useAiChat } from "../../../composables/useAiChat";
import { _resetOpenEditorForTests } from "../../../composables/useOpenEditor";
import type { AiChatRequest, AiChatResult, AiConfig, ScenarioRunResponse } from "../../../api/types";

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
        deleteChat: vi.fn(), compactChat: vi.fn(), draftText: vi.fn(),
      },
      modules: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      bundles: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      templates: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      categories: { create: vi.fn() },
    },
    ApiError: class ApiError extends Error {
      constructor(public status: number, message: string) { super(message); }
    },
  };
});

beforeEach(() => {
  setActivePinia(createPinia());
  _resetAiConfigForTests();
  _resetAiChatForTests();
  _resetOpenEditorForTests();
  vi.mocked(api.ai.config).mockResolvedValue(CONFIG);
  vi.mocked(api.ai.draftText).mockReset();
  vi.mocked(api.ai.chat).mockReset();
});

describe("AiTextPanel", () => {
  it("sends the editor's values and hands back the answer", async () => {
    vi.mocked(api.ai.draftText).mockResolvedValue({
      payload: { values: [{ id: "v1", name: "quality", value: "best quality", negative: "lowres" }] },
      preview: ["$quality = best quality  (negative: lowres)"],
      warnings: ["Left out bad name: not a variable name"], model: "m", answer: {},
    });
    const item = { name: "Quality", payload: { values: [{ id: "v1", name: "quality", value: "masterpiece" }] } };
    const w = mount(AiTextPanel, { props: { kind: "fixed_values", item } });
    await flushPromises();
    await w.get('[data-test="ai-instruction"]').setValue("quality tags with negatives");
    await w.get('[data-test="ai-run"]').trigger("click");
    await flushPromises();
    expect(api.ai.draftText).toHaveBeenCalledWith(
      { kind: "fixed_values", instruction: "quality tags with negatives", item },
      expect.any(AbortSignal),
    );
    expect(w.get('[data-test="ai-text-results"]').text()).toContain("$quality = best quality");
    expect(w.get('[data-test="ai-text-warning"]').text()).toContain("bad name");
    expect(w.get('[data-test="ai-apply"]').text()).toBe("Use these values");
    await w.get('[data-test="ai-apply"]').trigger("click");
    expect(w.emitted("use")?.[0]?.[0]).toEqual({
      values: [{ id: "v1", name: "quality", value: "best quality", negative: "lowres" }],
    });
    expect(w.find('[data-test="ai-text-results"]').exists()).toBe(false);
  });
});

const RUN = {
  runs: 100, failed: 0, elapsed_ms: 12, missing: [], variables: {}, picks: {}, samples: [],
  warnings: [{ type: "constraint_never_applied", message: "x", count: 4, seeds: [1] }],
} as unknown as ScenarioRunResponse;

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/test", name: "test", component: { template: "<div />" } },
      { path: "/templates/:id/edit", name: "templates-edit", component: { template: "<div />" } },
      { path: "/bundles/:id/edit", name: "bundles-edit", component: { template: "<div />" } },
    ],
  });
}

describe("AiRunBar + chat", () => {
  it("asks about the run, and the drawer sends it with the page", async () => {
    const result: AiChatResult = { chat_id: "c1", message: "It picks winter most.", model: "m", steps: [], proposals: [] };
    vi.mocked(api.ai.chat).mockResolvedValue(result);
    const router = makeRouter();
    await router.push("/test");
    const bar = mount(AiRunBar, { props: { result: RUN } });
    expect(bar.find('[data-test="tr-ai-fix"]').exists()).toBe(true);
    await bar.get('[data-test="tr-ai-why"]').setValue("red scarf");
    await bar.get("form").trigger("submit");
    const chat = useAiChat();
    expect(chat.open.value).toBe(true);
    expect(chat.input.value).toContain('"red scarf"');
    const drawer = mount(AiChatDrawer, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    expect(api.ai.chat).toHaveBeenCalledTimes(1);
    const body = vi.mocked(api.ai.chat).mock.calls[0][0] as AiChatRequest;
    expect(body.message).toContain("red scarf");
    expect(body.page?.route).toBe("test");
    expect(drawer.text()).toContain("It picks winter most.");
    drawer.unmount();
  });

  it("applies and undoes template and bundle proposals", async () => {
    vi.mocked(api.templates.create).mockImplementation(async (b) => ({ id: "t9", ...b }) as never);
    vi.mocked(api.templates.delete).mockResolvedValue(undefined as never);
    vi.mocked(api.bundles.update).mockImplementation(async (id, b) => ({ id, ...b }) as never);
    vi.mocked(api.ai.chat).mockResolvedValue({
      chat_id: "c1", message: "Done.", model: "m", steps: [],
      proposals: [
        {
          pid: "p1", tool: "create_template", title: "Create template Full", summary: "", preview: [],
          warnings: [], after: null,
          op: { op: "create", kind: "template", new_category: "",
                body: { name: "Full", template_string: "$look", negative_template: "" } },
        },
        {
          pid: "p2", tool: "edit_bundle", title: "Change bundle Kit", summary: "", preview: [],
          warnings: [], after: null,
          op: { op: "update", kind: "bundle", type: "bundle", id: "b1", name: "Kit",
                body: { children: [{ id: "m1" }] }, before: { children: [] } },
        },
      ],
    });
    const router = makeRouter();
    await router.push("/test");
    const chat = useAiChat();
    chat.ask("make a template");
    const w = mount(AiChatDrawer, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    const cards = w.findAll('[data-test="ai-chat-proposal"]');
    await cards[0].get('[data-test="ai-chat-apply"]').trigger("click");
    await cards[1].get('[data-test="ai-chat-apply"]').trigger("click");
    await flushPromises();
    expect(api.templates.create).toHaveBeenCalledWith(
      { name: "Full", template_string: "$look", negative_template: "" });
    expect(api.bundles.update).toHaveBeenCalledWith("b1", { children: [{ id: "m1" }] });
    await w.findAll('[data-test="ai-chat-proposal"]')[0].get('[data-test="ai-chat-undo"]').trigger("click");
    await flushPromises();
    expect(api.templates.delete).toHaveBeenCalledWith("t9");
    w.unmount();
  });
});
