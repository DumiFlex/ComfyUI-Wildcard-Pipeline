import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../api/client", () => ({
  api: {
    modules: {
      list: vi.fn(),
    },
    categories: {
      list: vi.fn(),
    },
    exportBundle: vi.fn(),
    importBundle: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import { api } from "../api/client";
import ImportExport from "../views/ImportExport.vue";
import type { CategoryRow, ModuleRow } from "../api/types";

const apiAny = api as unknown as {
  modules: { list: ReturnType<typeof vi.fn> };
  categories: { list: ReturnType<typeof vi.fn> };
  importBundle: ReturnType<typeof vi.fn>;
  exportBundle: ReturnType<typeof vi.fn>;
};

function mkModule(over: Partial<ModuleRow>): ModuleRow {
  return {
    id: "aabbccdd",
    type: "wildcard",
    name: "Sample",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: { options: [] },
    payload_hash: "0".repeat(64),
    version: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...over,
  };
}

function mkCategory(over: Partial<CategoryRow>): CategoryRow {
  return { id: "cat_a", name: "Style", color: "#a78bfa", icon: null, sort_order: 0, ...over };
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiAny.modules.list.mockReset();
  apiAny.categories.list.mockReset();
  apiAny.importBundle.mockReset();
});
afterEach(() => vi.clearAllMocks());

function mountView() {
  return mount(ImportExport, {
    global: { plugins: [] },
  });
}

describe("ImportExport.vue — Export tab", () => {
  it("renders both tabs and starts on Export", async () => {
    apiAny.modules.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.find('[data-test="io-tab-export"]').exists()).toBe(true);
    expect(wrap.find('[data-test="io-tab-import"]').exists()).toBe(true);
    expect(wrap.find('[data-test="io-export-pane"]').exists()).toBe(true);
  });

  it("disables 'Download bundle' when nothing is selected", async () => {
    apiAny.modules.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });
    const wrap = mountView();
    await flushPromises();
    const btn = wrap.find('[data-test="io-export-download"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("seeds the default selection to 'Full library' once data loads", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({ id: "wc_a", type: "wildcard", name: "Pose" }),
        mkModule({ id: "fv_a", type: "fixed_values", name: "Defaults" }),
      ],
      total: 2,
    });
    apiAny.categories.list.mockResolvedValue({
      items: [mkCategory({ id: "cat_a" })],
    });
    const wrap = mountView();
    await flushPromises();

    // Download button enabled because everything is checked by default.
    const btn = wrap.find('[data-test="io-export-download"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("'None' button clears all selections and disables download", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [mkModule({ id: "wc_a", type: "wildcard" })],
      total: 1,
    });
    apiAny.categories.list.mockResolvedValue({ items: [] });
    const wrap = mountView();
    await flushPromises();

    await wrap.find('[data-test="io-export-select-none"]').trigger("click");
    await flushPromises();

    const btn = wrap.find('[data-test="io-export-download"]');
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("'Wildcards only' preset selects only wildcard rows", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({ id: "wc_a", type: "wildcard" }),
        mkModule({ id: "fv_a", type: "fixed_values" }),
      ],
      total: 2,
    });
    apiAny.categories.list.mockResolvedValue({ items: [] });
    const wrap = mountView();
    await flushPromises();

    await wrap.find('[data-test="io-preset-wildcards"]').trigger("click");
    await flushPromises();

    const summary = wrap.find('[data-test="io-export-summary"]').text();
    // 1 wildcard, 0 fixed values, 1 total
    expect(summary).toMatch(/Wildcards\s*1/);
    expect(summary).toMatch(/Fixed values\s*0/);
  });
});

describe("ImportExport.vue — Import tab", () => {
  /**
   * jsdom doesn't expose `DragEvent` and `HTMLInputElement.files` is
   * read-only — both are facts of life for unit tests. We invoke the file
   * input's `change` handler with a manually-attached `files` array, which
   * routes through the same `handleFile()` path the dropzone uses.
   */
  async function feedBundle(wrap: ReturnType<typeof mountView>, bundle: unknown) {
    const file = new File([JSON.stringify(bundle)], "bundle.json", {
      type: "application/json",
    });
    const input = wrap.find<HTMLInputElement>('[data-test="io-file-input"]');
    Object.defineProperty(input.element, "files", {
      value: [file], configurable: true,
    });
    await input.trigger("change");
    await flushPromises();
  }

  it("switches to Import tab and shows the dropzone", async () => {
    apiAny.modules.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });
    const wrap = mountView();
    await flushPromises();

    await wrap.find('[data-test="io-tab-import"]').trigger("click");
    await flushPromises();

    expect(wrap.find('[data-test="io-import-pane"]').exists()).toBe(true);
    expect(wrap.find('[data-test="io-dropzone"]').exists()).toBe(true);
  });

  it("renders conflict badges for parsed bundle rows", async () => {
    // Local library has wc_a; incoming bundle re-imports wc_a (modified) plus a new one.
    apiAny.modules.list.mockResolvedValue({
      items: [mkModule({ id: "wc_a", payload: { options: [{ id: "o1", value: "x", weight: 1 }] } })],
      total: 1,
    });
    apiAny.categories.list.mockResolvedValue({ items: [] });
    const wrap = mountView();
    await flushPromises();

    await wrap.find('[data-test="io-tab-import"]').trigger("click");
    await flushPromises();

    await feedBundle(wrap, {
      version: 1,
      modules: [
        mkModule({ id: "wc_a", payload: { options: [{ id: "o1", value: "y", weight: 1 }] } }),
        mkModule({ id: "wc_b", name: "Brand New" }),
      ],
      categories: [],
    });

    expect(wrap.find('[data-test="io-import-badge-wc_a"]').exists()).toBe(true);
    expect(wrap.find('[data-test="io-import-badge-wc_b"]').exists()).toBe(true);
    expect(wrap.find('[data-test="io-import-badge-wc_a"]').text()).toBe("modified");
    expect(wrap.find('[data-test="io-import-badge-wc_b"]').text()).toBe("new");
  });

  it("ticking a group's select-all box ticks all leaf checkboxes", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({ id: "wc_a", type: "wildcard", name: "A" }),
        mkModule({ id: "wc_b", type: "wildcard", name: "B" }),
      ],
      total: 2,
    });
    apiAny.categories.list.mockResolvedValue({ items: [] });
    const wrap = mountView();
    await flushPromises();

    // Clear, then select all wildcards via the group checkbox.
    await wrap.find('[data-test="io-export-select-none"]').trigger("click");
    await flushPromises();

    // ui/Checkbox is a custom <button role="checkbox"> — click it to toggle on.
    const groupCheckEl = wrap.get('[data-test="io-export-group-check-wildcard"]');
    await groupCheckEl.trigger("click");
    await flushPromises();

    // Both rows should now be selected → download should be enabled.
    const btn = wrap.find('[data-test="io-export-download"]');
    expect(btn.attributes("disabled")).toBeUndefined();
    const summary = wrap.find('[data-test="io-export-summary"]').text();
    expect(summary).toMatch(/Wildcards\s*2/);
  });

  it("import button sends only the checked items to api.importBundle", async () => {
    apiAny.modules.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });
    apiAny.importBundle.mockResolvedValue({
      modules_imported: 1, categories_imported: 0, skipped: [],
    });

    const wrap = mountView();
    await flushPromises();
    await wrap.find('[data-test="io-tab-import"]').trigger("click");
    await flushPromises();

    await feedBundle(wrap, {
      version: 1,
      modules: [
        mkModule({ id: "wc_keep", name: "Keep me" }),
        mkModule({ id: "wc_drop", name: "Drop me" }),
      ],
      categories: [],
    });

    // Untick wc_drop by clicking its row (toggle off — was selected by default).
    const dropRow = wrap.find('[data-test="io-import-row-wc_drop"]');
    expect(dropRow.exists()).toBe(true);
    await dropRow.trigger("click");
    await flushPromises();

    // Hit the import button.
    const submit = wrap.find('[data-test="io-import-submit"]');
    expect(submit.exists()).toBe(true);
    await submit.trigger("click");
    await flushPromises();

    expect(apiAny.importBundle).toHaveBeenCalledTimes(1);
    const sent = apiAny.importBundle.mock.calls[0]![0];
    expect(sent.version).toBe(1);
    expect(sent.modules.map((m: ModuleRow) => m.id)).toEqual(["wc_keep"]);
  });
});
