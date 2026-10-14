import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// "Open in editor" on a chat create card: the editor opens unsaved, filled
// from the staged draft; Save creates the item at the id the card reserved
// and tells the chat (onSaved).
vi.mock("../../api/client", () => ({
  api: {
    modules: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
    templates: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

import { api } from "../../api/client";
import { _resetOpenEditorForTests, stageDraft } from "../../composables/useOpenEditor";
import FixedEditor from "../FixedEditor.vue";
import CombineEditor from "../CombineEditor.vue";
import ConstraintEditor from "../ConstraintEditor.vue";
import TemplateEditor from "../TemplateEditor.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiTpl = api.templates as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  _resetOpenEditorForTests();
  Object.values(apiMod).forEach((fn) => fn.mockReset());
  Object.values(apiTpl).forEach((fn) => fn.mockReset());
  apiMod.list.mockResolvedValue({ items: [], total: 0 });
  apiTpl.list.mockResolvedValue({ items: [], total: 0 });
  apiCat.list.mockResolvedValue({ items: [] });
  // The create echoes the body back as the row, id included.
  apiMod.create.mockImplementation(async (body: Record<string, unknown>) => ({
    version: 1, created_at: "", updated_at: "", is_favorite: false, ...body,
  }));
  apiTpl.create.mockImplementation(async (body: Record<string, unknown>) => ({
    created_at: "", updated_at: "", is_favorite: false, ...body,
  }));
});
afterEach(() => {
  vi.clearAllMocks();
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/fixed-values", component: { template: "<div/>" } },
      { path: "/combines", component: { template: "<div/>" } },
      { path: "/constraints", component: { template: "<div/>" } },
      { path: "/templates", component: { template: "<div/>" } },
    ],
  });
}

function wildcard(id: string, name: string, subs: string[], values: string[]) {
  return {
    id, name, description: "", category_id: null, tags: [], type: "wildcard",
    payload: {
      sub_categories: subs,
      options: values.map((v, i) => ({ id: `${id}_o${i}`, value: v, weight: 1, sub_categories: [] })),
    },
    version: 1, created_at: "", updated_at: "", is_favorite: false,
  };
}

async function clickSave(w: ReturnType<typeof mount>): Promise<void> {
  await w.find('[data-test="save-btn"]').trigger("click");
  await flushPromises();
}

describe("FixedEditor with a chat draft", () => {
  it("fills the values, creates at the reserved id and reports the save", async () => {
    const onSaved = vi.fn();
    stageDraft({
      type: "fixed_values",
      id: "abcd1234",
      onSaved,
      body: {
        name: "Defaults",
        description: "from chat",
        tags: ["ai"],
        payload: {
          values: [
            { id: "v1", name: "first_name", value: "Alice" },
            { id: "v2", name: "mood", value: "calm", negative: "angry" },
          ],
        },
      },
    });
    const w = mount(FixedEditor, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    const n0 = w.find('[data-test="fv-row-0-name"]').element as HTMLInputElement;
    const n1 = w.find('[data-test="fv-row-1-name"]').element as HTMLInputElement;
    expect(n0.value).toBe("first_name");
    expect(n1.value).toBe("mood");

    await clickSave(w);
    expect(apiMod.create).toHaveBeenCalledTimes(1);
    const body = apiMod.create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.id).toBe("abcd1234");
    expect(body.name).toBe("Defaults");
    expect(body.description).toBe("from chat");
    expect(body.tags).toEqual(["ai"]);
    expect((body.payload as { values: unknown[] }).values).toEqual([
      { id: "v1", name: "first_name", value: "Alice" },
      { id: "v2", name: "mood", value: "calm", negative: "angry" },
    ]);
    expect(onSaved).toHaveBeenCalledWith("abcd1234");
  });

  it("ignores a draft staged for another type", async () => {
    stageDraft({ type: "combine", body: { name: "nope", payload: { template: "x" } } });
    const w = mount(FixedEditor, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    await clickSave(w);
    expect(apiMod.create).not.toHaveBeenCalled(); // still blank: no name
  });

  it("without a reserved id creates as before (no id sent)", async () => {
    const onSaved = vi.fn();
    stageDraft({
      type: "fixed_values", onSaved,
      body: { name: "Plain", payload: { values: [{ id: "v1", name: "a", value: "b" }] } },
    });
    apiMod.create.mockImplementation(async (body: Record<string, unknown>) => ({ ...body, id: "new00001" }));
    const w = mount(FixedEditor, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    await clickSave(w);
    const body = apiMod.create.mock.calls[0][0] as Record<string, unknown>;
    expect("id" in body).toBe(false);
    expect(onSaved).toHaveBeenCalledWith("new00001");
  });
});

describe("CombineEditor with a chat draft", () => {
  it("fills template, negative and output var, then creates at the reserved id", async () => {
    const onSaved = vi.fn();
    stageDraft({
      type: "combine",
      id: "c0mb1ne0",
      onSaved,
      body: {
        name: "Scene",
        payload: { template: "$subject in $place", output_var: "scene_text", negative: "blurry" },
      },
    });
    const w = mount(CombineEditor, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    const tpl = w.findAll("textarea, input").map((e) => (e.element as HTMLInputElement).value);
    expect(tpl).toContain("Scene");

    await clickSave(w);
    expect(apiMod.create).toHaveBeenCalledTimes(1);
    const body = apiMod.create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.id).toBe("c0mb1ne0");
    expect(body.type).toBe("combine");
    const p = body.payload as Record<string, unknown>;
    expect(p.template).toBe("$subject in $place");
    expect(p.output_var).toBe("scene_text");
    expect(p.negative).toBe("blurry");
    expect(p.input_vars).toEqual(["subject", "place"]);
    expect(onSaved).toHaveBeenCalledWith("c0mb1ne0");
  });
});

describe("ConstraintEditor with a chat draft", () => {
  const payload = {
    source_wildcard_id: "aaaa0001",
    target_wildcard_id: "bbbb0002",
    matrix: { warm: { rough: { mode: "exclude", factor: 0 } } },
    exceptions: [{ source: "red", target: "matte", mode: "boost", factor: 2 }],
    target_select: { mode: "next", count: 2 },
  };

  it("keeps everything when both wildcards exist and creates at the reserved id", async () => {
    const lib = [
      wildcard("aaaa0001", "colour", ["warm", "cold"], ["red", "blue"]),
      wildcard("bbbb0002", "texture", ["rough"], ["matte"]),
    ];
    apiMod.list.mockResolvedValue({ items: lib, total: lib.length });
    const onSaved = vi.fn();
    stageDraft({ type: "constraint", id: "c0n57a1n", onSaved, body: { name: "warm-rough", payload } });
    const w = mount(ConstraintEditor, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    const vm = w.vm as unknown as {
      sourceWildcardId: string | null; targetWildcardId: string | null;
      matrix: Record<string, unknown>; targetSelect: Record<string, unknown>;
      exceptions: Array<Record<string, unknown>>;
    };
    expect(vm.sourceWildcardId).toBe("aaaa0001");
    expect(vm.targetWildcardId).toBe("bbbb0002");
    expect(vm.matrix).toEqual(payload.matrix);
    expect(vm.targetSelect).toEqual({ mode: "next", count: 2 });
    expect(vm.exceptions[0]).toMatchObject({ source: "red", target: "matte", mode: "boost", factor: 2 });

    await clickSave(w);
    expect(apiMod.create).toHaveBeenCalledTimes(1);
    const body = apiMod.create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.id).toBe("c0n57a1n");
    const p = body.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("aaaa0001");
    expect(p.target_wildcard_id).toBe("bbbb0002");
    expect(p.matrix).toEqual(payload.matrix);
    expect(p.target_select).toEqual({ mode: "next", count: 2 });
    expect(onSaved).toHaveBeenCalledWith("c0n57a1n");
  });

  it("keeps ids of wildcards not created yet, refuses Save, then saves once they exist", async () => {
    const onSaved = vi.fn();
    stageDraft({ type: "constraint", id: "c0n57a1n", onSaved, body: { name: "warm-rough", payload } });
    const w = mount(ConstraintEditor, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    const vm = w.vm as unknown as {
      sourceWildcardId: string | null; targetWildcardId: string | null;
      matrix: Record<string, unknown>; targetSelect: Record<string, unknown>;
      exceptions: unknown[];
    };
    expect(vm.sourceWildcardId).toBe("aaaa0001");
    expect(vm.targetWildcardId).toBe("bbbb0002");
    expect(vm.matrix).toEqual(payload.matrix);
    expect(vm.exceptions).toHaveLength(1);
    expect(w.find('[data-test="source-pending"]').text()).toContain("aaaa0001");
    expect(w.find('[data-test="source-pending"]').text()).toContain("Not created yet: apply its card first");
    expect(w.find('[data-test="target-pending"]').exists()).toBe(true);

    await clickSave(w);
    expect(apiMod.create).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(w.text()).toContain("Not created yet: apply its card first");

    // The wildcards' cards get applied: they appear in the library. Nothing
    // in the editor resets, and Save (which refreshes the library) goes on.
    const lib = [
      wildcard("aaaa0001", "colour", ["warm", "cold"], ["red", "blue"]),
      wildcard("bbbb0002", "texture", ["rough"], ["matte"]),
    ];
    apiMod.list.mockResolvedValue({ items: lib, total: lib.length });
    await clickSave(w);
    expect(apiMod.create).toHaveBeenCalledTimes(1);
    const body = apiMod.create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.id).toBe("c0n57a1n");
    const p = body.payload as Record<string, unknown>;
    expect(p.source_wildcard_id).toBe("aaaa0001");
    expect(p.target_wildcard_id).toBe("bbbb0002");
    expect(p.matrix).toEqual(payload.matrix);
    expect(p.target_select).toEqual({ mode: "next", count: 2 });
    expect((p.exceptions as unknown[])).toHaveLength(1);
    expect(onSaved).toHaveBeenCalledWith("c0n57a1n");
  });
});

describe("TemplateEditor with a chat draft", () => {
  it("fills the text from the top-level body and reports the save", async () => {
    const onSaved = vi.fn();
    stageDraft({
      type: "template",
      id: "7e3p1a7e",
      onSaved,
      body: {
        name: "Portrait",
        tags: ["ai"],
        ...({ template_string: "$subject, $style", negative_template: "$negatives, blurry" } as Record<string, unknown>),
      },
    });
    const w = mount(TemplateEditor, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    await clickSave(w);
    expect(apiTpl.create).toHaveBeenCalledTimes(1);
    const body = apiTpl.create.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({
      id: "7e3p1a7e", name: "Portrait", tags: ["ai"],
      template_string: "$subject, $style", negative_template: "$negatives, blurry",
    });
    expect(onSaved).toHaveBeenCalledWith("7e3p1a7e");
  });
});
