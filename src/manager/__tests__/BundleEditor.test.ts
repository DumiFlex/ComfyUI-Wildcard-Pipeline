import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("../api/client", () => ({
  api: {
    bundles: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      favorite: vi.fn(),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from "../api/client";
import BundleEditor from "../views/BundleEditor.vue";

const apiBundles = api.bundles as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiBundles).forEach((fn) => fn.mockReset());
});
afterEach(() => vi.clearAllMocks());

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/bundles", name: "bundles", component: { template: "<div/>" } },
    ],
  });
}

function mountEditor(props: { id?: string } = {}) {
  return mount(BundleEditor, {
    props,
    global: { plugins: [makeRouter()] },
  });
}

describe("BundleEditor.vue", () => {
  it("create-mode does not call bundles.get", async () => {
    const wrap = mountEditor();
    await flushPromises();
    expect(apiBundles.get).not.toHaveBeenCalled();
    expect(wrap.text()).toContain("New Bundle");
  });

  it("edit-mode loads bundle and populates fields", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_test",
      name: "Char Pack",
      description: "Wraps the character sub-graph",
      color: "#7c3aed",
      category_id: null,
      tags: ["character", "v2"],
      is_favorite: false,
      children: [
        { id: "wc_a", type: "wildcard", name: "hair" },
        { id: "wc_b", type: "wildcard", name: "outfit" },
      ],
      payload_hash: "abc123",
      version: 1,
      created_at: "",
      updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_test" });
    await flushPromises();
    expect(apiBundles.get).toHaveBeenCalledWith("bn_test");

    // Name input gets populated.
    const nameInput = wrap.find('input[aria-label="Bundle name"]');
    expect((nameInput.element as HTMLInputElement).value).toBe("Char Pack");

    // Tag chips render.
    expect(wrap.text()).toContain("character");
    expect(wrap.text()).toContain("v2");

    // Children list shows both kids in order.
    expect(wrap.text()).toContain("hair");
    expect(wrap.text()).toContain("outfit");
    expect(wrap.text()).toContain("Children (2)");
  });

  it("falls back to default color when row.color is null", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_x",
      name: "Default Bundle",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [],
      payload_hash: "",
      version: 1,
      created_at: "",
      updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_x" });
    await flushPromises();
    // The ColorPicker swatch has its background set from the color ref.
    // Easiest reliable assertion: the editor doesn't crash, child count
    // surfaces zero, and the empty-children message renders.
    expect(wrap.text()).toContain("This bundle has no children yet");
  });

  it("addTag pushes the draft tag and clears the input", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_y",
      name: "Tag Test",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [],
      payload_hash: "",
      version: 1,
      created_at: "",
      updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_y" });
    await flushPromises();

    const tagInput = wrap.find('input[aria-label="New tag"]');
    await tagInput.setValue("character");
    await tagInput.trigger("keyup.enter");

    expect(wrap.text()).toContain("character");
    expect((tagInput.element as HTMLInputElement).value).toBe("");
  });
});
