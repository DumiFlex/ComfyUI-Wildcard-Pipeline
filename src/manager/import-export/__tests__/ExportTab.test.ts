import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/client", () => ({
  api: {
    modules: { list: vi.fn() },
    bundles: { list: vi.fn() },
    categories: { list: vi.fn() },
    importExport: { build: vi.fn() },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

vi.mock("../../composables/useToast", () => {
  const push = vi.fn();
  const dismiss = vi.fn();
  return {
    useToast: () => ({ toasts: { value: [] }, push, dismiss }),
    __pushMock: push,
  };
});

import ExportTab from "../ExportTab.vue";
import { api, ApiError } from "../../api/client";
import * as toastModule from "../../composables/useToast";
import type { ModuleRow, BundleRow, CategoryRow } from "../../api/types";

const apiAny = api as unknown as {
  modules: { list: ReturnType<typeof vi.fn> };
  bundles: { list: ReturnType<typeof vi.fn> };
  categories: { list: ReturnType<typeof vi.fn> };
  importExport: { build: ReturnType<typeof vi.fn> };
};

const pushMock = (toastModule as unknown as { __pushMock: ReturnType<typeof vi.fn> }).__pushMock;

function mkModule(over: Partial<ModuleRow> & Pick<ModuleRow, "id" | "type" | "name">): ModuleRow {
  return {
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {},
    payload_hash: "0".repeat(64),
    version: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...over,
  } as ModuleRow;
}

function mkBundle(over: Partial<BundleRow> & Pick<BundleRow, "id" | "name">): BundleRow {
  return {
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
    ...over,
  } as BundleRow;
}

function mkCategory(over: Partial<CategoryRow> & Pick<CategoryRow, "id" | "name">): CategoryRow {
  return { color: null, icon: null, sort_order: 0, ...over } as CategoryRow;
}

function seedLibrary() {
  apiAny.modules.list.mockResolvedValue({
    items: [
      mkModule({ id: "w1", type: "wildcard",     name: "$color" }),
      mkModule({ id: "fv1", type: "fixed_values", name: "fv1" }),
      mkModule({ id: "co1", type: "combine",      name: "co1" }),
      mkModule({ id: "dr1", type: "derivation",   name: "dr1" }),
      mkModule({ id: "cn1", type: "constraint",   name: "cn1" }),
    ],
    total: 5,
  });
  apiAny.bundles.list.mockResolvedValue({
    items: [mkBundle({ id: "b1", name: "B1" })],
    total: 1,
  });
  apiAny.categories.list.mockResolvedValue({
    items: [mkCategory({ id: "cat1", name: "Cat1" })],
  });
  apiAny.importExport.build.mockResolvedValue({
    schema_version: 1,
    exported_at: "2026-05-22T00:00:00Z",
    bundles: [], wildcards: [], fixed_values: [], combines: [],
    derivations: [], constraints: [], categories: [],
  });
}

beforeEach(() => {
  apiAny.modules.list.mockReset();
  apiAny.bundles.list.mockReset();
  apiAny.categories.list.mockReset();
  apiAny.importExport.build.mockReset();
  pushMock.mockReset();
  seedLibrary();
});

afterEach(() => vi.clearAllMocks());

describe("ExportTab.vue", () => {
  it("renders all 7 section headers", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    const text = wrap.text();
    for (const label of ["Bundles", "Wildcards", "Fixed values", "Combines", "Derivations", "Constraints", "Categories"]) {
      expect(text).toContain(label);
    }
  });

  it("export button is disabled with no selection", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    const btn = wrap.get('[data-test="export-tab-submit"]');
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("export button becomes enabled after a row is selected", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    // The wildcard row checkbox — Checkbox.vue renders <button role="checkbox">.
    const row = wrap.get('[data-test="export-tab-row-wildcard-w1"]');
    await row.get('button[role="checkbox"]').trigger("click");
    await flushPromises();
    const btn = wrap.get('[data-test="export-tab-submit"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("section toggle-all selects every row in that bucket", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({ id: "w1", type: "wildcard", name: "$one" }),
        mkModule({ id: "w2", type: "wildcard", name: "$two" }),
        mkModule({ id: "w3", type: "wildcard", name: "$three" }),
      ],
      total: 3,
    });
    apiAny.bundles.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });

    const wrap = mount(ExportTab);
    await flushPromises();
    // Section-checkbox is the FIRST role=checkbox inside the wildcard
    // section header. Click it to "select all in this bucket".
    const section = wrap.get('[data-test="export-tab-section-wildcard"]');
    await section.get('button[role="checkbox"]').trigger("click");
    await flushPromises();

    // After select-all, every row checkbox in the wildcard section is checked.
    const rowCheckboxes = section.findAll('.wp-picker-row button[role="checkbox"]');
    expect(rowCheckboxes.length).toBe(3);
    for (const cb of rowCheckboxes) {
      expect(cb.attributes("aria-checked")).toBe("true");
    }
  });

  it("export POSTs a 7-bucket body matching the picked uuids", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();

    // Pick wildcard w1.
    await wrap.get('[data-test="export-tab-row-wildcard-w1"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    await wrap.get('[data-test="export-tab-submit"]').trigger("click");
    await flushPromises();

    expect(apiAny.importExport.build).toHaveBeenCalledTimes(1);
    const body = apiAny.importExport.build.mock.calls[0]![0];
    // All 7 expected keys present, no `variable_uuids`.
    expect(Object.keys(body).sort()).toEqual([
      "bundle_uuids",
      "category_uuids",
      "combine_uuids",
      "constraint_uuids",
      "derivation_uuids",
      "fixed_values_uuids",
      "wildcard_uuids",
    ]);
    expect(body.wildcard_uuids).toEqual(["w1"]);
    expect(body.bundle_uuids).toEqual([]);
    expect(body.fixed_values_uuids).toEqual([]);
    expect(body.combine_uuids).toEqual([]);
    expect(body.derivation_uuids).toEqual([]);
    expect(body.constraint_uuids).toEqual([]);
    expect(body.category_uuids).toEqual([]);
    expect(body).not.toHaveProperty("variable_uuids");
  });

  it("triggers a browser download with Blob + createObjectURL + click + revoke", async () => {
    // jsdom doesn't ship URL.createObjectURL / revokeObjectURL by default,
    // so spyOn would fail. Stub them directly on the URL prototype-like
    // object via vi.stubGlobal-friendly assignment, capture invocations,
    // and restore at the end.
    const createMock = vi.fn(() => "blob:fake");
    const revokeMock = vi.fn();
    const originalCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    const originalRevoke = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    (URL as unknown as { createObjectURL: typeof createMock }).createObjectURL = createMock;
    (URL as unknown as { revokeObjectURL: typeof revokeMock }).revokeObjectURL = revokeMock;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
      const wrap = mount(ExportTab);
      await flushPromises();
      await wrap.get('[data-test="export-tab-row-wildcard-w1"] button[role="checkbox"]').trigger("click");
      await flushPromises();
      await wrap.get('[data-test="export-tab-submit"]').trigger("click");
      await flushPromises();

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeMock).toHaveBeenCalledWith("blob:fake");
    } finally {
      if (originalCreate === undefined) {
        delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      } else {
        (URL as unknown as { createObjectURL: unknown }).createObjectURL = originalCreate;
      }
      if (originalRevoke === undefined) {
        delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
      } else {
        (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = originalRevoke;
      }
      clickSpy.mockRestore();
    }
  });

  it("pushes an error toast when the API rejects", async () => {
    apiAny.importExport.build.mockRejectedValue(new ApiError(500, "boom"));
    const wrap = mount(ExportTab);
    await flushPromises();
    await wrap.get('[data-test="export-tab-row-wildcard-w1"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    await wrap.get('[data-test="export-tab-submit"]').trigger("click");
    await flushPromises();

    expect(pushMock).toHaveBeenCalled();
    const errorCall = pushMock.mock.calls.find(
      (c) => (c[0] as { severity?: string }).severity === "error",
    );
    expect(errorCall, "expected an error-severity toast.push call").toBeDefined();
    expect(errorCall![0]).toMatchObject({
      severity: "error",
      summary: "Export failed",
    });
    // Detail should mention either the message or the status code.
    expect(String((errorCall![0] as { detail?: string }).detail)).toContain("boom");

    // Button must be re-enabled (i.e. not latched into a broken state).
    const btn = wrap.get('[data-test="export-tab-submit"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });
});
