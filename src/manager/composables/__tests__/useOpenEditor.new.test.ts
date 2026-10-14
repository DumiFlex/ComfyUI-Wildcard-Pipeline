import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h, ref } from "vue";

// A new, never-saved item open in its editor: registered under a reserved
// id so the chat can read and fill it; Save creates it at that id once the
// chat has read it, and the chat alone creates nothing.
vi.mock("../../api/client", () => ({
  api: {
    modules: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

import { api } from "../../api/client";
import {
  _resetOpenEditorForTests, draftCreateId, editorForPage, openEditor, registerOpenEditor, stageDraft,
} from "../useOpenEditor";
import FixedEditor from "../../views/FixedEditor.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  _resetOpenEditorForTests();
  apiMod.create.mockReset().mockImplementation(async (body: Record<string, unknown>) => ({
    version: 1, created_at: "", updated_at: "", is_favorite: false, id: "srv00001", ...body,
  }));
  apiMod.update.mockReset();
});
afterEach(() => vi.clearAllMocks());

function host(id: string | undefined, fill?: (f: () => unknown) => void) {
  return defineComponent({
    setup() {
      const name = ref("Draft");
      const f = registerOpenEditor({
        id, type: "wildcard", dirty: () => true,
        name, description: ref(""), tags: ref<string[]>([]),
        categoryId: ref<string | null>(null), contentRating: ref<"safe" | "nsfw">("safe"),
        payload: () => ({ options: [] }),
      });
      fill?.(f);
      return () => h("div", name.value);
    },
  });
}

describe("registerOpenEditor for a new item", () => {
  it("registers under a reserved 8-hex id and is sent with new + type", () => {
    const w = mount(host(undefined));
    const ed = openEditor();
    expect(ed?.isNew).toBe(true);
    expect(ed?.id).toMatch(/^[0-9a-f]{8}$/);
    // Not sent for a page that shows a saved item; sent where no item id is.
    expect(editorForPage("aaaa0001")).toBeUndefined();
    const state = editorForPage(undefined);
    expect(state).toMatchObject({ id: ed?.id, new: true, type: "wildcard", name: "Draft", dirty: true });
    w.unmount();
    expect(openEditor()).toBeNull();
    expect(draftCreateId(null)).toEqual({});
  });

  it("a saved item is sent only on its own page and is not new", () => {
    mount(host("aaaa0001"));
    expect(openEditor()?.isNew).toBeUndefined();
    expect(editorForPage(undefined)).toBeUndefined();
    const state = editorForPage("aaaa0001");
    expect(state?.id).toBe("aaaa0001");
    expect(state && "new" in state).toBe(false);
  });

  it("takes the id a chat card reserved when it opens with that draft", () => {
    stageDraft({ type: "wildcard", id: "abcd1234", body: { name: "From card" } });
    let fill: (() => unknown) | null = null;
    mount(host(undefined, (f) => { fill = f; }));
    expect(fill).not.toBeNull();
    (fill as unknown as () => unknown)();
    expect(openEditor()?.id).toBe("abcd1234");
  });

  it("only creates at the reserved id once the chat has read the item", () => {
    mount(host(undefined));
    expect(draftCreateId(null)).toEqual({});
    const id = editorForPage(undefined)?.id;
    expect(draftCreateId(null)).toEqual({ id });
    // A card's own reserved id still wins.
    expect(draftCreateId({ type: "wildcard", body: {}, id: "abcd1234" })).toEqual({ id: "abcd1234" });
  });
});

describe("a new editor the chat filled", () => {
  function makeRouter() {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { template: "<div/>" } },
        { path: "/fixed-values", component: { template: "<div/>" } },
        { path: "/fixed-values/:id/edit", component: { template: "<div/>" } },
      ],
    });
  }

  it("saves at the id the chat saw, and nothing was created before Save", async () => {
    // Opened from a card that reserved no id (its values fill the form).
    stageDraft({
      type: "fixed_values",
      body: { name: "Plain", payload: { values: [{ id: "v1", name: "a", value: "b" }] } },
    });
    const w = mount(FixedEditor, { global: { plugins: [makeRouter()] } });
    await flushPromises();
    const ed = openEditor();
    expect(ed?.isNew).toBe(true);
    const seen = editorForPage(undefined);
    expect(seen?.type).toBe("fixed_values");
    // The chat's change goes into the editor's draft only.
    ed?.write({ name: "Defaults", description: "from chat" });
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
    expect(apiMod.update).not.toHaveBeenCalled();
    expect(editorForPage(undefined)?.name).toBe("Defaults");

    await w.find('[data-test="save-btn"]').trigger("click");
    await flushPromises();
    expect(apiMod.create).toHaveBeenCalledTimes(1);
    const body = apiMod.create.mock.calls[0][0] as Record<string, unknown>;
    expect(body.id).toBe(seen?.id);
    expect(body.name).toBe("Defaults");
    expect(body.description).toBe("from chat");
  });
});
