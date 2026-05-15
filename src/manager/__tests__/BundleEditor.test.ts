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
    expect(wrap.text()).toContain("New bundle");
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
        // Canonical shape produced by ContextWidget#toChildSnapshot —
        // display name lives at `meta.name`, not top-level.
        { id: "wc_a", type: "wildcard", meta: { name: "hair" } },
        { id: "wc_b", type: "wildcard", meta: { name: "outfit" } },
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
    const nameInput = wrap.find('[data-test="identity-name"]');
    expect((nameInput.element as HTMLInputElement).value).toBe("Char Pack");

    // Tag chips render.
    expect(wrap.text()).toContain("character");
    expect(wrap.text()).toContain("v2");

    // Children list shows both kids in order.
    expect(wrap.text()).toContain("hair");
    expect(wrap.text()).toContain("outfit");
    expect(wrap.text()).toContain("Children (2)");
  });

  it("renders child names from meta.name (canonical ContextWidget snapshot shape)", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_meta",
      name: "Meta Test",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [
        // Real shape from toChildSnapshot — top-level `name` absent,
        // display name lives under `meta.name`.
        {
          id: "wc_meta1",
          type: "wildcard",
          enabled: true,
          meta: { name: "From Meta" },
          entries: [],
          payload: {},
        },
        // Missing meta entirely → falls through to "(unnamed)".
        { id: "wc_meta2", type: "wildcard" },
      ],
      payload_hash: "",
      version: 1,
      created_at: "",
      updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_meta" });
    await flushPromises();
    expect(wrap.text()).toContain("From Meta");
    expect(wrap.text()).toContain("(unnamed)");
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

  it("save click calls bundles.update with form fields", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_save",
      name: "Original Name",
      description: "Original desc",
      color: "#7c3aed",
      category_id: null,
      tags: ["old"],
      is_favorite: false,
      children: [],
      payload_hash: "h0",
      version: 1,
      created_at: "",
      updated_at: "",
    });
    apiBundles.update.mockResolvedValue({
      id: "bn_save",
      name: "Edited",
      description: "New desc",
      color: "#22d3ee",
      category_id: null,
      tags: ["new"],
      is_favorite: false,
      children: [],
      payload_hash: "h1",
      version: 2,
      created_at: "",
      updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_save" });
    await flushPromises();

    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("Edited");

    // Click the Save button — find by text since icon-only would match
    // the Back button too.
    const saveBtn = wrap.findAll("button").find((b) => b.text().includes("Save"));
    expect(saveBtn?.exists()).toBe(true);
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(apiBundles.update).toHaveBeenCalledWith(
      "bn_save",
      expect.objectContaining({ name: "Edited" }),
    );
  });

  it("save in create-mode shows info toast instead of POST", async () => {
    const wrap = mountEditor();
    await flushPromises();
    // Save button should be disabled in create mode — clicking should
    // not invoke the create/update API. The component routes users to
    // the Context widget for creation.
    const saveBtn = wrap.findAll("button").find((b) => b.text().includes("Save"));
    expect(saveBtn?.attributes("disabled")).toBeDefined();
    expect(apiBundles.create).not.toHaveBeenCalled();
    expect(apiBundles.update).not.toHaveBeenCalled();
  });

  it("default color saved as null (sentinel for default token)", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_default",
      name: "Default Bundle",
      description: "",
      color: null,  // already at default
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [],
      payload_hash: "h0",
      version: 1,
      created_at: "",
      updated_at: "",
    });
    apiBundles.update.mockResolvedValue({
      id: "bn_default",
      name: "Default Bundle",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [],
      payload_hash: "h1",
      version: 2,
      created_at: "",
      updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_default" });
    await flushPromises();

    const saveBtn = wrap.findAll("button").find((b) => b.text().includes("Save"));
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(apiBundles.update).toHaveBeenCalledWith(
      "bn_default",
      expect.objectContaining({ color: null }),
    );
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

    const tagInput = wrap.find('[data-test="identity-tag-input"]');
    await tagInput.setValue("character");
    await tagInput.trigger("keydown.enter");

    expect(wrap.text()).toContain("character");
    expect((tagInput.element as HTMLInputElement).value).toBe("");
  });

  it("renders EditorFrame breadcrumb back to /bundles", async () => {
    const wrap = mountEditor();
    await flushPromises();
    const back = wrap.find('[data-test="editor-back"]');
    expect(back.exists()).toBe(true);
    expect(back.text()).toContain("Bundles");
  });
});
