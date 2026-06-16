import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// Same harness as the sibling WildcardEditor view tests — mock the API
// client + drive a memory router so the editor mounts headless. The
// constraint row is returned by `api.modules.get`; the wildcard catalog
// (which `moduleStore.fetchCatalog` writes into `catalog`) is returned by
// `api.modules.list`.
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
import ConstraintEditor from "../ConstraintEditor.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
  apiMod.list.mockResolvedValue({ items: [], total: 0 });
  apiCat.list.mockResolvedValue({ items: [] });
});
afterEach(() => {
  vi.clearAllMocks();
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/constraints", component: { template: "<div/>" } },
      { path: "/constraints/:id/edit", component: ConstraintEditor },
    ],
  });
}

/** The wildcard catalog `fetchCatalog` loads. Candidate `beef0001` covers
 *  sub-categories warm+cold; `facade00` is the (present) target. */
function catalog() {
  return [
    {
      id: "beef0001", name: "colour", description: "", category_id: null, tags: [],
      type: "wildcard",
      payload: { sub_categories: ["warm", "cold"], options: [{ id: "o2", value: "red", weight: 1 }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    },
    {
      id: "facade00", name: "texture", description: "", category_id: null, tags: [],
      type: "wildcard",
      payload: { sub_categories: ["rough"], options: [{ id: "o1", value: "matte", weight: 1 }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    },
  ];
}

/** A constraint whose source uuid (`deadbeef`) is ABSENT from the catalog
 *  → dangling. Two-row matrix: `warm` survives under candidate beef0001
 *  (subs warm+cold) while `cool` VANISHES, so a source reattach to
 *  beef0001 drops every cell in the `cool` row (2 cells). */
function danglingConstraint() {
  return {
    id: "c0ffee00",
    name: "warm-only",
    description: "",
    category_id: null,
    tags: [],
    type: "constraint",
    payload: {
      source_wildcard_id: "deadbeef", // missing from catalog → dangling
      target_wildcard_id: "facade00", // present
      matrix: {
        warm: { rough: { mode: "boost", factor: 2 } }, // survives → 0 dropped
        cool: { rough: { mode: "exclude", factor: 0 }, smooth: { mode: "boost", factor: 2 } }, // vanishes → 2 cells
      },
      exceptions: [],
    },
    version: 1, created_at: "", updated_at: "", is_favorite: false,
  };
}

async function mountSeeded() {
  apiMod.list.mockResolvedValue({ items: catalog(), total: catalog().length });
  apiMod.get.mockResolvedValue(danglingConstraint());
  const w = mount(ConstraintEditor, {
    props: { id: "c0ffee00" },
    global: { plugins: [makeRouter()] },
  });
  await flushPromises();
  return w;
}

describe("ConstraintEditor — dangling source reattach (SPA, both sides)", () => {
  it("renders the reattach banner when source id is absent from the catalog", async () => {
    const w = await mountSeeded();
    expect(w.find("[data-test='reattach-row-source']").exists()).toBe(true);
    // Target resolves to a catalog wildcard → no target row.
    expect(w.find("[data-test='reattach-row-target']").exists()).toBe(false);
  });

  it("reattach sets sourceWildcardId to the picked uuid + repoints the matrix", async () => {
    const w = await mountSeeded();
    // `defineExpose`d refs are auto-unwrapped on `vm` by vue-test-utils, so
    // read `sourceWildcardId` as the bare string (no `.value`).
    const vm = w.vm as unknown as { sourceWildcardId: string | null };
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    await w.find("[data-test-id='reattach-candidate-beef0001']").trigger("click");
    await w.find("[data-test='reattach-confirm-source']").trigger("click");
    expect(vm.sourceWildcardId).toBe("beef0001");
  });

  it("previews the per-cell dropped count for a non-surviving source pick (pre-confirm)", async () => {
    const w = await mountSeeded();
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    // Select candidate beef0001 (subs warm+cold) WITHOUT confirming: the
    // `cool` row (2 cells) vanishes, `warm` (1 cell) survives → 2 dropped.
    await w.find("[data-test-id='reattach-candidate-beef0001']").trigger("click");
    const dropped = w.find("[data-test='reattach-dropped-source']");
    expect(dropped.exists()).toBe(true);
    expect(dropped.text()).toContain("2 cells dropped");
  });
});
