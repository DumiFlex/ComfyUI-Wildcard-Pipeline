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
import PickerRow from "../PickerRow.vue";
import { api, ApiError } from "../../api/client";
import * as toastModule from "../../composables/useToast";
import type { ModuleRow, BundleRow, CategoryRow } from "../../api/types";

/**
 * Expand a collapsed PickerSection so its rows render. Sections are
 * now collapsed by default; tests that interact with rows must open
 * the relevant section first. The toggle is the bare `▶ / ▼` button
 * inside the section header — clicking it flips `defaultOpen` state.
 */
async function expandSection(
  wrap: ReturnType<typeof mount>,
  bucketKey: string,
): Promise<void> {
  const section = wrap.get(`[data-test="export-tab-section-${bucketKey}"]`);
  const toggle = section.get(".wp-picker-section__toggle");
  await toggle.trigger("click");
  await flushPromises();
}

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
  // ---------- Phase 4: page-level chrome ----------

  it("does NOT render an outer 'Pick what to export' Card wrapper", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    // The legacy chrome rendered a Card titled "Pick what to export".
    // Phase-4 drops it; assert it's gone.
    expect(wrap.text()).not.toContain("Pick what to export");
    // And the legacy side-panel host class is absent too.
    expect(wrap.find(".wp-export-tab__side").exists()).toBe(false);
  });

  it("preset buttons have icons + an uppercase Quick select label without trailing colon", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    // Label text mirrors the prototype's "Quick select" (text-transform:
    // uppercase in CSS paints it as "QUICK SELECT" on the rendered page).
    const label = wrap.get(".wp-export-presets__label");
    expect(label.text()).toBe("Quick select");
    expect(label.text()).not.toContain(":");
    // Each preset button carries its expected pi icon.
    expect(
      wrap.get('[data-test="preset-full"]').find("i.pi.pi-database").exists(),
    ).toBe(true);
    expect(
      wrap.get('[data-test="preset-wildcards"]').find("i.pi.pi-sparkles").exists(),
    ).toBe(true);
    expect(
      wrap.get('[data-test="preset-favorites"]').find("i.pi.pi-star-fill").exists(),
    ).toBe(true);
  });

  it("renders a footer bar with all action buttons + counter", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    const footer = wrap.get('[data-test="export-tab-footer"]');
    expect(footer.find('[data-test="export-select-deps"]').exists()).toBe(true);
    expect(footer.find('[data-test="export-tab-clear"]').exists()).toBe(true);
    expect(footer.find('[data-test="export-tab-counter"]').exists()).toBe(true);
    expect(footer.find('[data-test="export-tab-submit"]').exists()).toBe(true);
  });

  it("footer counter shows 'N of M selected' with selected count", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    const counter = wrap.get('[data-test="export-tab-counter"]');
    // Library seed = 5 modules + 1 bundle + 1 category = 7 rows total.
    // Nothing selected at boot.
    expect(counter.text()).toMatch(/^\s*0\s+of\s+7\s+selected\s*$/);
    // Select one wildcard.
    await expandSection(wrap, "wildcard");
    await wrap.get('[data-test="export-tab-row-wildcard-w1"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    const counter2 = wrap.get('[data-test="export-tab-counter"]');
    expect(counter2.text()).toMatch(/^\s*1\s+of\s+7\s+selected\s*$/);
  });

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
    // Sections collapsed by default — expand the wildcard one first.
    await expandSection(wrap, "wildcard");
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
    // Expand to see the rows we just selected (section-checkbox doesn't
    // open the body — it only toggles selection state).
    await expandSection(wrap, "wildcard");

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
    await expandSection(wrap, "wildcard");

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
      await expandSection(wrap, "wildcard");
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
    await expandSection(wrap, "wildcard");
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

  it("pushes an error toast when library load fails", async () => {
    // Reject one of the three Promise.all branches in loadLibrary. The
    // catch wraps the whole gather, so a single rejection should surface
    // exactly one "Failed to load library" toast and leave the component
    // mounted (no throw escaping onMounted).
    apiAny.modules.list.mockRejectedValueOnce(new ApiError(500, "down"));
    mount(ExportTab);
    await flushPromises();
    expect(pushMock).toHaveBeenCalledWith(expect.objectContaining({
      severity: "error",
      summary: expect.stringMatching(/load|library/i),
    }));
  });

  it("'Select with dependencies' button is disabled when nothing is selected", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    const btn = wrap.get('[data-test="export-select-deps"]');
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("'Select with dependencies' expands selection via outgoing closure", async () => {
    // Wildcard A's payload.options[0].value references @{bbbbbbbb}; selecting
    // only A and clicking the button should pull in B through the dep-graph
    // closure. Ids are 8-hex-char so they match the REF_REGEX exactly.
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({
          id: "aaaaaaaa",
          type: "wildcard",
          name: "$a",
          payload: {
            options: [{ id: "o1", value: "uses @{bbbbbbbb}", weight: 1 }],
          },
        }),
        mkModule({
          id: "bbbbbbbb",
          type: "wildcard",
          name: "$b",
          payload: { options: [] },
        }),
      ],
      total: 2,
    });
    apiAny.bundles.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });

    const wrap = mount(ExportTab);
    await flushPromises();
    await expandSection(wrap, "wildcard");

    // Select only wildcard A.
    await wrap.get('[data-test="export-tab-row-wildcard-aaaaaaaa"] button[role="checkbox"]').trigger("click");
    await flushPromises();

    // Click the Select-with-deps button.
    await wrap.get('[data-test="export-select-deps"]').trigger("click");
    await flushPromises();

    // B should now also be checked.
    const rowB = wrap.get('[data-test="export-tab-row-wildcard-bbbbbbbb"] button[role="checkbox"]');
    expect(rowB.attributes("aria-checked")).toBe("true");
  });

  it("'Select with dependencies' pulls in constraints whose source AND target are both selected", async () => {
    // Constraint C carries source_wildcard_id = A and target_wildcard_id = B
    // nested under its payload. Selecting A + B (but not C) and clicking
    // should add C via constraintsBothSidesIn.
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({
          id: "aaaaaaaa",
          type: "wildcard",
          name: "$a",
          payload: { options: [] },
        }),
        mkModule({
          id: "bbbbbbbb",
          type: "wildcard",
          name: "$b",
          payload: { options: [] },
        }),
        mkModule({
          id: "cccccccc",
          type: "constraint",
          name: "c1",
          payload: {
            source_wildcard_id: "aaaaaaaa",
            target_wildcard_id: "bbbbbbbb",
            matrix: {},
            exceptions: [],
          },
        }),
      ],
      total: 3,
    });
    apiAny.bundles.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });

    const wrap = mount(ExportTab);
    await flushPromises();
    await expandSection(wrap, "wildcard");
    await expandSection(wrap, "constraint");

    await wrap.get('[data-test="export-tab-row-wildcard-aaaaaaaa"] button[role="checkbox"]').trigger("click");
    await wrap.get('[data-test="export-tab-row-wildcard-bbbbbbbb"] button[role="checkbox"]').trigger("click");
    await flushPromises();

    await wrap.get('[data-test="export-select-deps"]').trigger("click");
    await flushPromises();

    const rowC = wrap.get('[data-test="export-tab-row-constraint-cccccccc"] button[role="checkbox"]');
    expect(rowC.attributes("aria-checked")).toBe("true");
  });

  // ---------- Polish B: collapsed-by-default sections ----------

  it("all 7 sections render collapsed by default", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    // Every section header is present.
    for (const key of [
      "bundle", "wildcard", "fixed_values",
      "combine", "derivation", "constraint", "category",
    ]) {
      expect(wrap.find(`[data-test="export-tab-section-${key}"]`).exists()).toBe(true);
    }
    // No PickerRow renders because every section body is collapsed
    // (the only fixture row is wildcard w1, which would render if the
    // wildcard section were expanded).
    expect(wrap.find('[data-test="export-tab-row-wildcard-w1"]').exists()).toBe(false);
    // Each section body div lives under the section root only when open;
    // assert the body wrapper is absent for every bucket.
    const bodies = wrap.findAll(".wp-picker-section__body");
    expect(bodies.length).toBe(0);
  });

  // ---------- Polish B: PickerRow receives enriched props ----------

  it("PickerRow receives kind prop matching the module's type", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    await expandSection(wrap, "wildcard");

    const row = wrap.get('[data-test="export-tab-row-wildcard-w1"]');
    const pickerRow = row.findComponent(PickerRow);
    expect(pickerRow.exists()).toBe(true);
    expect(pickerRow.props("kind")).toBe("wildcard");
  });

  it("PickerRow receives showId=true so the short uuid renders", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    await expandSection(wrap, "wildcard");

    const pickerRow = wrap
      .get('[data-test="export-tab-row-wildcard-w1"]')
      .findComponent(PickerRow);
    expect(pickerRow.props("showId")).toBe(true);
    // And the rendered id element exists.
    expect(wrap.find('[data-test="picker-row-id"]').exists()).toBe(true);
  });

  it("PickerRow receives category name + color when module has a category", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({
          id: "w1",
          type: "wildcard",
          name: "$tagged",
          category_id: "cat1",
        }),
      ],
      total: 1,
    });
    apiAny.bundles.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({
      items: [mkCategory({ id: "cat1", name: "Outfits", color: "#ff8800" })],
    });

    const wrap = mount(ExportTab);
    await flushPromises();
    await expandSection(wrap, "wildcard");

    const pickerRow = wrap
      .get('[data-test="export-tab-row-wildcard-w1"]')
      .findComponent(PickerRow);
    expect(pickerRow.props("categoryName")).toBe("Outfits");
    expect(pickerRow.props("categoryColor")).toBe("#ff8800");
  });

  // ---------- Polish B: quick filter presets ----------

  it("'Full library' preset selects every row across all 7 buckets", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({ id: "w1", type: "wildcard",     name: "$one" }),
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

    const wrap = mount(ExportTab);
    await flushPromises();

    await wrap.get('[data-test="preset-full"]').trigger("click");
    await flushPromises();

    // The footer counter surfaces totalSelected — 5 modules + 1 bundle
    // + 1 category = 7. Cheaper than expanding 7 sections to count
    // individual checkboxes, and exercises the same computed.
    const counter = wrap.get('[data-test="export-tab-counter"]');
    expect(counter.text()).toContain("7");
    const btn = wrap.get('[data-test="export-tab-submit"]');
    expect(btn.attributes("disabled")).toBeUndefined();

    // Spot-check a couple of buckets to prove rows are actually checked.
    for (const key of ["wildcard", "bundle", "category", "constraint"]) {
      await expandSection(wrap, key);
    }
    for (const sel of [
      '[data-test="export-tab-row-wildcard-w1"]',
      '[data-test="export-tab-row-bundle-b1"]',
      '[data-test="export-tab-row-category-cat1"]',
      '[data-test="export-tab-row-constraint-cn1"]',
    ]) {
      const cb = wrap.get(`${sel} button[role="checkbox"]`);
      expect(cb.attributes("aria-checked")).toBe("true");
    }
  });

  it("'Wildcards only' preset clears non-wildcard buckets and selects all wildcards", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({ id: "w1", type: "wildcard",     name: "$one" }),
        mkModule({ id: "w2", type: "wildcard",     name: "$two" }),
        mkModule({ id: "fv1", type: "fixed_values", name: "fv1" }),
        mkModule({ id: "co1", type: "combine",      name: "co1" }),
      ],
      total: 4,
    });
    apiAny.bundles.list.mockResolvedValue({
      items: [mkBundle({ id: "b1", name: "B1" })],
      total: 1,
    });
    apiAny.categories.list.mockResolvedValue({
      items: [mkCategory({ id: "cat1", name: "Cat1" })],
    });

    const wrap = mount(ExportTab);
    await flushPromises();

    // Pre-select a bundle to prove the preset clears it.
    await expandSection(wrap, "bundle");
    await wrap.get('[data-test="export-tab-row-bundle-b1"] button[role="checkbox"]').trigger("click");
    await flushPromises();

    await wrap.get('[data-test="preset-wildcards"]').trigger("click");
    await flushPromises();

    // Total = 2 wildcards. Bundle/fixed/combine/category all empty.
    const counter = wrap.get('[data-test="export-tab-counter"]');
    expect(counter.text()).toContain("2");

    // Bundle b1 should now be unchecked (preset cleared the pre-selection).
    const bundleCb = wrap.get('[data-test="export-tab-row-bundle-b1"] button[role="checkbox"]');
    expect(bundleCb.attributes("aria-checked")).toBe("false");

    await expandSection(wrap, "wildcard");
    for (const sel of [
      '[data-test="export-tab-row-wildcard-w1"]',
      '[data-test="export-tab-row-wildcard-w2"]',
    ]) {
      expect(wrap.get(`${sel} button[role="checkbox"]`).attributes("aria-checked")).toBe("true");
    }
  });

  it("'Favorites only' preset selects only modules + bundles flagged is_favorite", async () => {
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({ id: "w1", type: "wildcard", name: "$fav",    is_favorite: true }),
        mkModule({ id: "w2", type: "wildcard", name: "$nofav",  is_favorite: false }),
        mkModule({ id: "co1", type: "combine", name: "co1",     is_favorite: true }),
      ],
      total: 3,
    });
    apiAny.bundles.list.mockResolvedValue({
      items: [
        mkBundle({ id: "b1", name: "B1", is_favorite: true }),
        mkBundle({ id: "b2", name: "B2", is_favorite: false }),
      ],
      total: 2,
    });
    apiAny.categories.list.mockResolvedValue({
      items: [mkCategory({ id: "cat1", name: "Cat1" })],
    });

    const wrap = mount(ExportTab);
    await flushPromises();

    await wrap.get('[data-test="preset-favorites"]').trigger("click");
    await flushPromises();

    // 1 fav wildcard + 1 fav combine + 1 fav bundle = 3 selected.
    const counter = wrap.get('[data-test="export-tab-counter"]');
    expect(counter.text()).toContain("3");

    await expandSection(wrap, "wildcard");
    await expandSection(wrap, "combine");
    await expandSection(wrap, "bundle");

    expect(
      wrap.get('[data-test="export-tab-row-wildcard-w1"] button[role="checkbox"]')
        .attributes("aria-checked"),
    ).toBe("true");
    expect(
      wrap.get('[data-test="export-tab-row-wildcard-w2"] button[role="checkbox"]')
        .attributes("aria-checked"),
    ).toBe("false");
    expect(
      wrap.get('[data-test="export-tab-row-combine-co1"] button[role="checkbox"]')
        .attributes("aria-checked"),
    ).toBe("true");
    expect(
      wrap.get('[data-test="export-tab-row-bundle-b1"] button[role="checkbox"]')
        .attributes("aria-checked"),
    ).toBe("true");
    expect(
      wrap.get('[data-test="export-tab-row-bundle-b2"] button[role="checkbox"]')
        .attributes("aria-checked"),
    ).toBe("false");
  });

  // ---------- Phase 2: unselectedDeps wiring ----------

  it("PickerSection for wildcards receives kind=wildcard so the header icon renders", async () => {
    const wrap = mount(ExportTab);
    await flushPromises();
    const section = wrap.get('[data-test="export-tab-section-wildcard"]');
    const icon = section.find('[data-test="picker-section-icon"]');
    expect(icon.exists()).toBe(true);
    expect(icon.attributes("class") ?? "").toContain("wp-row-type-icon--wildcard");
  });

  it("PickerRow.unselectedDeps lists referenced-but-unselected ids on a selected row", async () => {
    // Wildcard A references @{bbbbbbbb}; select only A. The row for A
    // should receive a non-empty `unselectedDeps` listing B with its
    // library-known name + kind.
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({
          id: "aaaaaaaa",
          type: "wildcard",
          name: "$a",
          payload: {
            options: [{ id: "o1", value: "uses @{bbbbbbbb}", weight: 1 }],
          },
        }),
        mkModule({
          id: "bbbbbbbb",
          type: "wildcard",
          name: "$b",
          payload: { options: [] },
        }),
      ],
      total: 2,
    });
    apiAny.bundles.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });

    const wrap = mount(ExportTab);
    await flushPromises();
    await expandSection(wrap, "wildcard");

    // Select only A.
    await wrap.get('[data-test="export-tab-row-wildcard-aaaaaaaa"] button[role="checkbox"]').trigger("click");
    await flushPromises();

    const rowA = wrap
      .get('[data-test="export-tab-row-wildcard-aaaaaaaa"]')
      .findComponent(PickerRow);
    const deps = rowA.props("unselectedDeps") as Array<{ id: string; name: string; type?: string }>;
    expect(deps).toHaveLength(1);
    expect(deps[0]!.id).toBe("bbbbbbbb");
    expect(deps[0]!.name).toBe("$b");
    expect(deps[0]!.type).toBe("wildcard");
  });

  it("PickerRow.unselectedDeps is empty when both source and target are selected", async () => {
    // Same fixture as above, but select both rows — no unmet deps left.
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({
          id: "aaaaaaaa",
          type: "wildcard",
          name: "$a",
          payload: {
            options: [{ id: "o1", value: "uses @{bbbbbbbb}", weight: 1 }],
          },
        }),
        mkModule({
          id: "bbbbbbbb",
          type: "wildcard",
          name: "$b",
          payload: { options: [] },
        }),
      ],
      total: 2,
    });
    apiAny.bundles.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });

    const wrap = mount(ExportTab);
    await flushPromises();
    await expandSection(wrap, "wildcard");

    await wrap.get('[data-test="export-tab-row-wildcard-aaaaaaaa"] button[role="checkbox"]').trigger("click");
    await wrap.get('[data-test="export-tab-row-wildcard-bbbbbbbb"] button[role="checkbox"]').trigger("click");
    await flushPromises();

    const rowA = wrap
      .get('[data-test="export-tab-row-wildcard-aaaaaaaa"]')
      .findComponent(PickerRow);
    expect(rowA.props("unselectedDeps")).toEqual([]);
  });

  it("PickerRow.unselectedDeps is empty on an UNSELECTED row even when it has unresolved refs", async () => {
    // Wildcard A references @{bbbbbbbb} but A itself isn't selected.
    // Surfacing dep chips on unchecked rows would be advisory noise — the
    // user hasn't picked the row, so there's nothing to "resolve".
    apiAny.modules.list.mockResolvedValue({
      items: [
        mkModule({
          id: "aaaaaaaa",
          type: "wildcard",
          name: "$a",
          payload: {
            options: [{ id: "o1", value: "uses @{bbbbbbbb}", weight: 1 }],
          },
        }),
        mkModule({
          id: "bbbbbbbb",
          type: "wildcard",
          name: "$b",
          payload: { options: [] },
        }),
      ],
      total: 2,
    });
    apiAny.bundles.list.mockResolvedValue({ items: [], total: 0 });
    apiAny.categories.list.mockResolvedValue({ items: [] });

    const wrap = mount(ExportTab);
    await flushPromises();
    await expandSection(wrap, "wildcard");

    // Don't select anything.
    const rowA = wrap
      .get('[data-test="export-tab-row-wildcard-aaaaaaaa"]')
      .findComponent(PickerRow);
    expect(rowA.props("unselectedDeps")).toEqual([]);
  });
});
