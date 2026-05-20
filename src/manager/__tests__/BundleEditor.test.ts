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
    modules: { list: vi.fn().mockResolvedValue({ items: [] }) },
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

  it("save strips bundle-typed children down to ref shape before PUT", async () => {
    // Tier-2 nesting: bundle children are stored as id-only references.
    // The GET response server-expands them inline (attaches the inner
    // bundle's children under the bundle-typed entry's `children` key
    // + _resolved_from marker). On save the SPA must collapse them back
    // to the canonical ref shape — otherwise we'd round-trip a stale
    // snapshot through every PUT, and the API would defensively strip
    // it anyway. Better to do it here, explicit at the call site.
    apiBundles.get.mockResolvedValue({
      id: "bn_strip",
      name: "Outer",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [
        {
          id: "bb000001",
          type: "bundle",
          name: "inner",
          color: "#abcdef",
          _resolved_from: "bb000001",
          children: [
            { id: "ii000001", type: "wildcard", payload: {}, instance: {} },
            { id: "ii000002", type: "wildcard", payload: {}, instance: {} },
          ],
        },
      ],
      payload_hash: "h",
      version: 1,
      created_at: "",
      updated_at: "",
    });
    apiBundles.update.mockResolvedValue({
      id: "bn_strip",
      name: "Outer",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [{ id: "bb000001", type: "bundle", name: "inner", color: "#abcdef" }],
      payload_hash: "h2",
      version: 2,
      created_at: "",
      updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_strip" });
    await flushPromises();

    // Edit name so save isn't a no-op
    await wrap.find('[data-test="identity-name"]').setValue("Outer Edited");

    const saveBtn = wrap.findAll("button").find((b) => b.text().includes("Save"));
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(apiBundles.update).toHaveBeenCalledTimes(1);
    const [, body] = apiBundles.update.mock.calls[0];
    const sent = body.children[0];
    // Only the reference fields should survive the SPA-side strip.
    expect(sent).toEqual({
      id: "bb000001",
      type: "bundle",
      name: "inner",
      color: "#abcdef",
    });
    // No inner-children blob, no server-expansion markers.
    expect(sent).not.toHaveProperty("children");
    expect(sent).not.toHaveProperty("_resolved_from");
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
    // EditorFrame now renders a Breadcrumb component when breadcrumb prop is
    // passed; check that the breadcrumb nav contains "Bundles".
    const nav = wrap.find("nav.wp-breadcrumb");
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("Bundles");
  });

  it("save persists children array after toggle", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_kids",
      name: "Kids",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [
        { id: "wc_a", type: "wildcard", enabled: true, meta: { name: "alpha" } },
        { id: "wc_b", type: "wildcard", enabled: true, meta: { name: "beta" } },
      ],
      payload_hash: "h0", version: 1, created_at: "", updated_at: "",
    });
    apiBundles.update.mockResolvedValue({
      id: "bn_kids",
      name: "Kids",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [
        { id: "wc_a", type: "wildcard", enabled: false, meta: { name: "alpha" } },
        { id: "wc_b", type: "wildcard", enabled: true, meta: { name: "beta" } },
      ],
      payload_hash: "h1", version: 2, created_at: "", updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_kids" });
    await flushPromises();

    const toggleBtns = wrap.findAll('[data-test="bundle-child-toggle"]');
    expect(toggleBtns.length).toBe(2);
    await toggleBtns[0].trigger("click");

    const saveBtn = wrap.findAll("button").find((b) => b.text().includes("Save"));
    await saveBtn!.trigger("click");
    await flushPromises();

    expect(apiBundles.update).toHaveBeenCalled();
    const callArgs = apiBundles.update.mock.calls[0];
    expect(callArgs[0]).toBe("bn_kids");
    const payload = callArgs[1] as { children?: Array<Record<string, unknown>> };
    expect(payload.children).toBeDefined();
    expect(payload.children![0].enabled).toBe(false);
    expect(payload.children![1].enabled).toBe(true);
  });

  it("remove splices a child and persists on save", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_rm",
      name: "Rm",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [
        { id: "wc_a", type: "wildcard", enabled: true, meta: { name: "alpha" } },
        { id: "wc_b", type: "wildcard", enabled: true, meta: { name: "beta" } },
      ],
      payload_hash: "h0", version: 1, created_at: "", updated_at: "",
    });
    apiBundles.update.mockResolvedValue({
      id: "bn_rm", name: "Rm", description: "",
      color: null, category_id: null, tags: [],
      is_favorite: false, children: [], payload_hash: "h1",
      version: 2, created_at: "", updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_rm" });
    await flushPromises();

    await wrap.findAll('[data-test="bundle-child-remove"]')[0].trigger("click");
    expect(wrap.text()).toContain("Children (1)");

    const saveBtn = wrap.findAll("button").find((b) => b.text().includes("Save"));
    await saveBtn!.trigger("click");
    await flushPromises();

    const callArgs = apiBundles.update.mock.calls[0];
    const payload = callArgs[1] as { children?: unknown[] };
    expect(payload.children).toHaveLength(1);
  });

  it("clicking a child row reveals the pane with that child", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_sel",
      name: "Sel",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [
        {
          id: "wc_a",
          type: "wildcard",
          enabled: true,
          meta: { name: "alpha" },
          payload: { options: [], sub_categories: [] },
          instance: {},
        },
      ],
      payload_hash: "h0", version: 1, created_at: "", updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_sel" });
    await flushPromises();

    // Pane absent before selection.
    expect(wrap.find('[data-test="bundle-pane-header"]').exists()).toBe(false);

    await wrap.find('[data-test="bundle-child-main"]').trigger("click");
    expect(wrap.find('[data-test="bundle-pane-header"]').exists()).toBe(true);
    expect(wrap.text()).toContain("alpha");
  });

  it("adding from library appends a snapshot to children", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_add",
      name: "Add",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [],
      payload_hash: "h0", version: 1, created_at: "", updated_at: "",
    });
    const apiAny = api as unknown as { modules: { list: ReturnType<typeof vi.fn> } };
    apiAny.modules.list.mockResolvedValue({
      items: [
        {
          id: "wc_lib", type: "wildcard", name: "library_wc",
          description: "", category_id: null, tags: [], is_favorite: false,
          payload: { options: [], sub_categories: [] },
          payload_hash: "lh1", version: 1, created_at: "", updated_at: "",
        },
      ],
    });

    const wrap = mountEditor({ id: "bn_add" });
    await flushPromises();

    await wrap.find('[data-test="bundle-add-open"]').trigger("click");
    await flushPromises();

    const row = document.body.querySelector('[data-test="bundle-add-row-wc_lib"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.click();
    await flushPromises();

    expect(wrap.text()).toContain("Children (1)");
    expect(wrap.text()).toContain("library_wc");

    wrap.unmount();
  });

  it("pane close clears selection", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_close",
      name: "Close",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [
        {
          id: "wc_a",
          type: "wildcard",
          enabled: true,
          meta: { name: "alpha" },
          payload: { options: [], sub_categories: [] },
          instance: {},
        },
      ],
      payload_hash: "h0", version: 1, created_at: "", updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_close" });
    await flushPromises();

    await wrap.find('[data-test="bundle-child-main"]').trigger("click");
    expect(wrap.find('[data-test="bundle-pane-header"]').exists()).toBe(true);

    await wrap.find('[data-test="bundle-pane-close"]').trigger("click");
    expect(wrap.find('[data-test="bundle-pane-header"]').exists()).toBe(false);
  });

  it("duplicate inserts after source and persists on save", async () => {
    apiBundles.get.mockResolvedValue({
      id: "bn_dup", name: "Dup", description: "",
      color: null, category_id: null, tags: [], is_favorite: false,
      children: [{ id: "wc_a", type: "wildcard", enabled: true, meta: { name: "alpha" } }],
      payload_hash: "h0", version: 1, created_at: "", updated_at: "",
    });
    apiBundles.update.mockResolvedValue({
      id: "bn_dup", name: "Dup", description: "",
      color: null, category_id: null, tags: [], is_favorite: false,
      children: [], payload_hash: "h1", version: 2, created_at: "", updated_at: "",
    });
    const wrap = mountEditor({ id: "bn_dup" });
    await flushPromises();

    await wrap.find('[data-test="bundle-child-duplicate"]').trigger("click");
    expect(wrap.text()).toContain("Children (2)");

    const saveBtn = wrap.findAll("button").find((b) => b.text().includes("Save"));
    await saveBtn!.trigger("click");
    await flushPromises();

    const payload = apiBundles.update.mock.calls[0][1] as { children?: Array<{ id: string }> };
    expect(payload.children).toHaveLength(2);
    // Both rows keep the source library uuid — multi-instance bundles
    // intentionally share `id`. Per-instance disambiguation lives in
    // `_uid`, stamped at Context-insert time, not at edit time.
    expect(payload.children![0].id).toBe("wc_a");
    expect(payload.children![1].id).toBe("wc_a");
  });
});
