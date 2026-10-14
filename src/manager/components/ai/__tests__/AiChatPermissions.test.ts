import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AiChatDrawer from "../AiChatDrawer.vue";
import { api } from "../../../api/client";
import { _resetAiConfigForTests } from "../../../composables/useAiConfig";
import { _resetAiChatForTests, useAiChat } from "../../../composables/useAiChat";
import { applyManage, undoManage, type ManageOp } from "../../../composables/aiManageOps";
import { useCategoryStore } from "../../../stores/categoryStore";
import type { AiChatProposal, AiChatResult, AiConfig } from "../../../api/types";

const CONFIG = {
  enabled: true, provider: "ollama", base_url: "", model: "m", unload_after_s: 60, context_max: 16384,
  model_size: "auto", model_size_auto: "small", allow_delete: true, auto_apply: false,
  embed_key_set: false, embed_key_own: false, local: true, thinking: "auto",
  key_set: false, key_from_env: false, keys_saved: [],
  presets: { ollama: { label: "Ollama", api: "ollama", local: true, needs_key: false, base_url: "", embeds: true, embed_model: "", embed_note: "" } },
} as unknown as AiConfig;

vi.mock("../../../api/client", () => {
  const chat = vi.fn();
  const crud = () => ({
    create: vi.fn(async (body: Record<string, unknown>) => ({ id: "new1", ...body })),
    update: vi.fn(async (id: string, body: Record<string, unknown>) => ({ id, ...body })),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0 })),
  });
  return {
    api: {
      ai: {
        config: vi.fn(), chat,
        chatStream: vi.fn((body: unknown, _on: unknown, signal?: AbortSignal) => chat(body, signal)),
        patchChat: vi.fn(() => Promise.resolve({})), vision: vi.fn(async () => ({ vision: true, model: "m" })),
        models: vi.fn(async () => ({ models: ["m"] })), saveConfig: vi.fn(),
      },
      modules: crud(), bundles: crud(), templates: crud(), categories: crud(),
      libraryTags: { rename: vi.fn(async () => ({ updated: {} })), delete: vi.fn(async () => ({ updated: {} })) },
    },
    ApiError: class ApiError extends Error {
      constructor(public status: number, message: string) { super(message); }
    },
  };
});

const DELETE: ManageOp = {
  op: "delete", kind: "delete",
  items: [
    { kind: "module", type: "wildcard", id: "aaaa0001", name: "Outfit",
      row: { id: "aaaa0001", type: "wildcard", name: "Outfit", description: "d", tags: ["warm"],
             category_id: "clothes", payload: { options: [] }, content_rating: "nsfw" } },
    { kind: "template", type: "template", id: "cccc0001", name: "Portrait",
      row: { id: "cccc0001", name: "Portrait", template_string: "$outfit", tags: [], category_id: null } },
  ],
  categories: [{ id: "clothes", name: "Clothes", color: "#f00", icon: null, sort_order: 2,
                 members: [{ kind: "bundle", id: "bbbb0001" }] }],
  tags: [{ tag: "warm", members: [{ kind: "module", id: "aaaa0002", tags: ["warm", "x"] }] }],
};

function proposal(pid: string, op: AiChatProposal["op"], extra: Partial<AiChatProposal> = {}): AiChatProposal {
  return { pid, tool: "t", title: `Card ${pid}`, summary: "", preview: [], warnings: [], after: null, op, ...extra };
}

describe("aiManageOps", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("deletes items, categories and tags, and Undo brings them back at their ids", async () => {
    useCategoryStore().items = [{ id: "clothes", name: "Clothes", color: "#f00", icon: null, sort_order: 2 }];
    vi.mocked(api.categories.create).mockResolvedValue({
      id: "clothes", name: "Clothes", color: "#f00", icon: null, sort_order: 2 });
    await applyManage(DELETE);
    expect(api.modules.delete).toHaveBeenCalledWith("aaaa0001");
    expect(api.templates.delete).toHaveBeenCalledWith("cccc0001");
    expect(api.categories.delete).toHaveBeenCalledWith("clothes");
    expect(api.libraryTags.delete).toHaveBeenCalledWith("warm");
    expect(useCategoryStore().items).toEqual([]);

    await undoManage(DELETE);
    expect(api.categories.create).toHaveBeenCalledWith({ name: "Clothes", color: "#f00", icon: null, sort_order: 2 });
    expect(api.modules.create).toHaveBeenCalledWith(expect.objectContaining({
      id: "aaaa0001", type: "wildcard", name: "Outfit", category_id: "clothes", tags: ["warm"],
      content_rating: "nsfw", payload: { options: [] } }));
    expect(api.templates.create).toHaveBeenCalledWith(expect.objectContaining({
      id: "cccc0001", template_string: "$outfit", category_id: null }));
    expect(api.bundles.update).toHaveBeenCalledWith("bbbb0001", { category_id: "clothes" });
    expect(api.modules.update).toHaveBeenCalledWith("aaaa0002", { tags: ["warm", "x"] });
  });

  it("undoes what ran when a step fails, so a card is never half applied", async () => {
    vi.mocked(api.templates.delete).mockRejectedValueOnce(new Error("boom"));
    await expect(applyManage(DELETE)).rejects.toThrow("boom");
    expect(api.modules.delete).toHaveBeenCalledOnce();
    expect(api.modules.create).toHaveBeenCalledWith(expect.objectContaining({ id: "aaaa0001" }));
    expect(api.categories.delete).not.toHaveBeenCalled();
  });

  it("creates and renames categories, and renames tags with Undo", async () => {
    const cats = useCategoryStore();
    cats.items = [{ id: "places", name: "Places", color: null, icon: null, sort_order: 0 }];
    vi.mocked(api.categories.create).mockResolvedValue({ id: "weather", name: "Weather", color: null, icon: null, sort_order: 0 });
    const op: ManageOp = { op: "categories", kind: "categories", create: ["Weather", "places"],
                           rename: [{ id: "places", from: "Places", to: "Spots" }] };
    await applyManage(op);
    expect(api.categories.create).toHaveBeenCalledOnce();
    expect(api.categories.update).toHaveBeenCalledWith("places", { name: "Spots" });
    await undoManage(op);
    expect(api.categories.update).toHaveBeenLastCalledWith("places", { name: "Places" });
    expect(api.categories.delete).toHaveBeenCalledWith("weather");

    const tags: ManageOp = { op: "tags", kind: "tags", rename: [{ from: "warm", to: "hot", merge: false,
      members: [{ kind: "bundle", id: "b1", tags: ["warm"] }] }] };
    await applyManage(tags);
    expect(api.libraryTags.rename).toHaveBeenCalledWith("warm", "hot");
    await undoManage(tags);
    expect(api.bundles.update).toHaveBeenCalledWith("b1", { tags: ["warm"] });
  });
});

describe("AiChatDrawer permissions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    _resetAiConfigForTests();
    _resetAiChatForTests();
  });

  async function ask(config: AiConfig, result: AiChatResult) {
    vi.mocked(api.ai.config).mockResolvedValue(config);
    vi.mocked(api.ai.chat).mockResolvedValue(result);
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/", name: "dashboard", component: { template: "<div />" } }] });
    await router.push("/");
    const w = mount(AiChatDrawer, { global: { plugins: [router] }, attachTo: document.body });
    await flushPromises();
    const chat = useAiChat();
    chat.input.value = "go";
    await chat.send();
    await flushPromises();
    return w;
  }

  it("a delete card asks to confirm, deletes, and undoes", async () => {
    const w = await ask(CONFIG, { chat_id: "c1", message: "Ok.", model: "m", steps: [],
      proposals: [proposal("p1", DELETE, { title: "Delete 4 things" })] });
    expect(w.find('[data-test="ai-chat-apply"]').exists()).toBe(false);
    await w.get('[data-test="ai-chat-delete"]').trigger("click");
    expect(w.get('[data-test="ai-chat-delete-question"]').text()).toContain("Delete these 4?");
    await w.get('[data-test="ai-chat-delete-cancel"]').trigger("click");
    expect(api.modules.delete).not.toHaveBeenCalled();
    await w.get('[data-test="ai-chat-delete"]').trigger("click");
    await w.get('[data-test="ai-chat-delete-confirm"]').trigger("click");
    await flushPromises();
    expect(api.modules.delete).toHaveBeenCalledWith("aaaa0001");
    expect(w.text()).toContain("Deleted");
    await w.get('[data-test="ai-chat-undo"]').trigger("click");
    await flushPromises();
    expect(api.modules.create).toHaveBeenCalledWith(expect.objectContaining({ id: "aaaa0001" }));
    w.unmount();
  });

  it("a delete card can't be applied while deleting is off", async () => {
    const w = await ask({ ...CONFIG, allow_delete: false }, { chat_id: "c1", message: "Ok.", model: "m",
      steps: [], proposals: [proposal("p1", DELETE)] });
    expect(w.text()).toContain("Deleting is turned off in Settings");
    expect(w.get('[data-test="ai-chat-delete"]').attributes("disabled")).toBeDefined();
    w.unmount();
  });

  it("auto-apply applies only low-risk cards and keeps Undo", async () => {
    const info = proposal("p1", {
      op: "update", kind: "module", type: "wildcard", id: "m1", name: "Outfit",
      body: { tags: ["warm"] }, before: { tags: [] } }, { risk: "low" });
    const edit = proposal("p2", {
      op: "update", kind: "module", type: "wildcard", id: "m1", name: "Outfit",
      body: { payload: {} }, before: { payload: {} } });
    const w = await ask({ ...CONFIG, auto_apply: true }, { chat_id: "c1", message: "Ok.", model: "m",
      steps: [], proposals: [info, edit] });
    expect(api.modules.update).toHaveBeenCalledOnce();
    expect(api.modules.update).toHaveBeenCalledWith("m1", { tags: ["warm"] });
    expect(w.get('[data-test="ai-chat-auto-applied"]').text()).toContain("Applied automatically");
    expect(w.findAll('[data-test="ai-chat-apply"]')).toHaveLength(1);
    expect(api.ai.patchChat).toHaveBeenCalledWith("c1", { events: [{ pid: "p1", status: "applied" }] });
    await w.get('[data-test="ai-chat-undo"]').trigger("click");
    await flushPromises();
    expect(api.modules.update).toHaveBeenLastCalledWith("m1", { tags: [] });
    w.unmount();
  });

  it("auto-apply stays off unless the user turned it on", async () => {
    const info = proposal("p1", {
      op: "update", kind: "module", type: "wildcard", id: "m1", name: "Outfit",
      body: { tags: ["warm"] }, before: { tags: [] } }, { risk: "low" });
    const w = await ask(CONFIG, { chat_id: "c1", message: "Ok.", model: "m", steps: [], proposals: [info] });
    expect(api.modules.update).not.toHaveBeenCalled();
    w.unmount();
  });
});
