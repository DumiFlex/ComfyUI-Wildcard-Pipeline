import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// What the Categories, Tags, Import/Export and Dashboard pages tell the AI
// chat through `registerPageNote`, and the parts it can point at.
vi.mock("../api/client", () => ({
  ApiError: class extends Error {
    status = 0;
  },
  api: {
    modules: { list: vi.fn() },
    bundles: { list: vi.fn() },
    templates: { list: vi.fn() },
    categories: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    libraryTags: { rename: vi.fn(), delete: vi.fn() },
    importExport: { build: vi.fn(), commit: vi.fn(), undo: vi.fn() },
    ai: { config: vi.fn().mockRejectedValue(new Error("off")) },
  },
}));

import { api } from "../api/client";
import { _resetOpenEditorForTests, currentPageNote } from "../composables/useOpenEditor";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import type { BundleRow, ModuleRow } from "../api/types";
import Categories from "../views/Categories.vue";
import Tags from "../views/Tags.vue";
import ImportExport from "../views/ImportExport.vue";
import Dashboard from "../views/Dashboard.vue";

type Fn = ReturnType<typeof vi.fn>;
const m = api as unknown as {
  modules: { list: Fn };
  bundles: { list: Fn };
  templates: { list: Fn };
  categories: { list: Fn };
  importExport: { commit: Fn };
};

const MODULES = [
  { id: "aaaa0001", type: "wildcard", name: "Outfit", category_id: "cat00001", tags: ["fashion", "warm"],
    payload: { options: [{ value: "coat" }] }, updated_at: "2026-10-01T00:00:00Z" },
  { id: "aaaa0002", type: "wildcard", name: "Blank", category_id: "cat00001", tags: ["fashion"],
    payload: { options: [] }, updated_at: "2026-10-02T00:00:00Z" },
];

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:rest(.*)*", component: { template: "<div/>" } }],
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  _resetOpenEditorForTests();
  m.modules.list.mockReset().mockResolvedValue({ items: MODULES, total: MODULES.length });
  m.bundles.list.mockReset().mockResolvedValue({ items: [], total: 0 });
  m.templates.list.mockReset().mockResolvedValue({ items: [{ id: "tttt0001", tags: ["portrait"] }], total: 1 });
  m.categories.list.mockReset().mockResolvedValue({
    items: [
      { id: "cat00001", name: "Style", color: "#a78bfa", icon: "palette", sort_order: 0 },
      { id: "cat00002", name: "Lighting", color: "#22d3ee", icon: null, sort_order: 1 },
    ],
  });
  m.importExport.commit.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

function anchors(w: ReturnType<typeof mount>): string[] {
  return w.findAll("[data-ai-anchor]").map((e) => e.attributes("data-ai-anchor") ?? "");
}

describe("Categories page note", () => {
  it("lists each category's look and count, and the row being edited", async () => {
    const w = mount(Categories, { global: { plugins: [router()] } });
    await flushPromises();
    expect(currentPageNote()).toBe(
      "Categories page, 2 categories: Style (cat00001): #a78bfa, icon palette, 2 modules; "
      + "Lighting (cat00002): #22d3ee, no icon, 0 modules",
    );
    await w.find('[data-test="cat-edit-cat00002"]').trigger("click");
    await w.find('[data-test="new-cat-name"]').setValue("Mood");
    expect(currentPageNote()).toContain('Editing Lighting (cat00002), unsaved: name "Lighting", #22d3ee');
    expect(currentPageNote()).toContain('New category form holds "Mood" (not added yet)');
    expect(anchors(w)).toEqual(expect.arrayContaining(["refresh", "new-category", "add-category", "categories", "counts"]));
    w.unmount();
    expect(currentPageNote()).toBe("");
  });
});

describe("Tags page note", () => {
  it("lists the tags shown with their counts, following the filter", async () => {
    const w = mount(Tags, { global: { plugins: [router()] } });
    await flushPromises();
    expect(currentPageNote()).toBe(
      "Tags page, 3 tags: #fashion (2 modules), #portrait (1 template), #warm (1 module)",
    );
    await w.find('[data-test="tags-filter"]').setValue("ar");
    expect(currentPageNote()).toBe('Tags page, filtered by "ar": 1 of 3 tags shown: #warm (1 module)');
    await w.find('[data-test="tag-rename-warm"]').trigger("click");
    expect(currentPageNote()).toContain('Renaming #warm to "warm" (not saved)');
    expect(anchors(w)).toEqual(expect.arrayContaining(["refresh", "filter", "tags", "actions"]));
  });
});

describe("Import / Export page note", () => {
  it("says which tab is open, what's loaded and the last result", async () => {
    const w = mount(ImportExport, { global: { plugins: [] }, attachTo: document.body });
    await flushPromises();
    expect(currentPageNote()).toBe("Import / Export page, Export tab. 0 of 5 items picked for export");
    expect(anchors(w)).toEqual(expect.arrayContaining(["refresh", "tabs", "export"]));

    await w.find('[data-test="io-tab-import"]').trigger("click");
    await flushPromises();
    expect(currentPageNote()).toBe("Import / Export page, Import tab. No file loaded yet");

    const payload = {
      schema_version: 1, bundles: [], fixed_values: [], combines: [], derivations: [],
      constraints: [], categories: [], templates: [],
      wildcards: [{ id: "cccc0001", type: "wildcard", name: "Hats", description: "", tags: [],
        payload_hash: "0".repeat(64), payload: { options: [{ id: "opt00001", value: "cap", weight: 1 }] } }],
    };
    await w.find('[data-test="import-paste-btn"]').trigger("click");
    await flushPromises();
    await w.find('[data-test="import-paste-textarea"]').setValue(JSON.stringify(payload));
    await w.find('[data-test="import-paste-confirm"]').trigger("click");
    await flushPromises();
    expect(currentPageNote()).toContain("A file is loaded");
    expect(currentPageNote()).toContain("1 wildcards");
    expect(currentPageNote()).toContain("In it: Hats (wildcard, cccc0001)");

    m.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u1", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    await w.find('[data-test="import-picker-continue"]').trigger("click");
    await flushPromises();
    expect(currentPageNote()).toContain("Last result: import committed: 1 added, 0 replaced, 0 renamed");
    w.unmount();
  });
});

describe("Dashboard page note", () => {
  it("gives the counts, the warnings with their items and the open tab's rows", async () => {
    m.modules.list.mockResolvedValue({ items: MODULES.slice(0, 1), total: 2 });
    m.bundles.list.mockResolvedValue({ items: [], total: 1 });
    const w = mount(Dashboard, { global: { plugins: [router()] } });
    useModuleStore().catalog = MODULES as unknown as ModuleRow[];
    useBundleStore().catalog = [{ id: "bbbb0001", name: "Kit", children: [] }] as unknown as BundleRow[];
    await flushPromises();
    const note = currentPageNote();
    expect(note).toContain("Dashboard: 11 items (2 wildcards, 2 fixed values, 2 combines, 2 derivations, 2 constraints, 1 bundle)");
    expect(note).toContain("Things to look at: 1 wildcard with no usable options: Blank (aaaa0002); 1 empty bundle: Kit (bbbb0001)");
    expect(note).toContain("Recently opened tab: empty");
    await w.find('[data-test="dashboard-tab-recent"]').trigger("click");
    expect(currentPageNote()).toContain("Recent edits tab: Outfit (wildcard, aaaa0001)");
    expect(anchors(w)).toEqual(expect.arrayContaining(["counts", "quick-create", "health", "recent", "new-module"]));
  });
});
