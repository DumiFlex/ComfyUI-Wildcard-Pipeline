import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// Harness mirrors ConstraintEditor.cached-names.test.ts — mock the API
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
  // The matrix popover teleports to <body>; clear any stragglers between
  // tests so a leaked node can't satisfy a later assertion.
  document.body.querySelectorAll("[data-test='cell-rule-popover']").forEach((n) => n.remove());
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

/** Live catalog: only `facade00` ("texture") is present — `deadbeef` (the
 *  stranded constraint's source) is deliberately ABSENT. `facade00` carries
 *  sub_category "rough" and an option value "matte" (so the exception's
 *  target value would resolve, but the source value "red" cannot). */
function strandedCatalog() {
  return [
    {
      id: "facade00", name: "texture", description: "", category_id: null, tags: [],
      type: "wildcard",
      payload: { sub_categories: ["rough"], options: [{ id: "o1", value: "matte", weight: 1 }] },
      version: 1, created_at: "", updated_at: "", is_favorite: false,
    },
  ];
}

/** Healthy catalog: BOTH `beef0001` ("colour") + `facade00` ("texture") are
 *  present with sub_categories — the non-stranded control. */
function healthyCatalog() {
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

/** A constraint whose SOURCE wildcard (`deadbeef`) is missing from the
 *  catalog → stranded. The matrix + exceptions data is intact in the
 *  payload; only the live source's sub_categories are gone. */
function strandedConstraint() {
  return {
    id: "c0ffee01",
    name: "warm-only",
    description: "",
    category_id: null,
    tags: [],
    type: "constraint",
    payload: {
      source_wildcard_id: "deadbeef", // missing from catalog → stranded
      target_wildcard_id: "facade00", // present, sub_categories ["rough"]
      source_wildcard_name: "Starter subject",
      target_wildcard_name: "texture",
      matrix: {
        warm: { rough: { mode: "boost", factor: 1.5 } },
        cold: { rough: { mode: "exclude", factor: 0 } },
      },
      exceptions: [{ source: "red", target: "matte", mode: "reduce", factor: 0.5 }],
    },
    version: 1, created_at: "", updated_at: "", is_favorite: false,
  };
}

/** Same matrix + exceptions, but BOTH source (`beef0001`) and target
 *  (`facade00`) are present — the healthy control. */
function healthyConstraint() {
  return {
    id: "c0ffee02",
    name: "warm-only",
    description: "",
    category_id: null,
    tags: [],
    type: "constraint",
    payload: {
      source_wildcard_id: "beef0001", // present
      target_wildcard_id: "facade00", // present
      source_wildcard_name: "colour",
      target_wildcard_name: "texture",
      matrix: {
        warm: { rough: { mode: "boost", factor: 1.5 } },
        cold: { rough: { mode: "exclude", factor: 0 } },
      },
      exceptions: [{ source: "red", target: "matte", mode: "reduce", factor: 0.5 }],
    },
    version: 1, created_at: "", updated_at: "", is_favorite: false,
  };
}

async function mountStranded() {
  apiMod.list.mockResolvedValue({ items: strandedCatalog(), total: strandedCatalog().length });
  apiMod.get.mockResolvedValue(strandedConstraint());
  const w = mount(ConstraintEditor, {
    props: { id: "c0ffee01" },
    global: { plugins: [makeRouter()] },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

async function mountHealthy() {
  apiMod.list.mockResolvedValue({ items: healthyCatalog(), total: healthyCatalog().length });
  apiMod.get.mockResolvedValue(healthyConstraint());
  const w = mount(ConstraintEditor, {
    props: { id: "c0ffee02" },
    global: { plugins: [makeRouter()] },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
}

describe("ConstraintEditor — stranded constraint renders matrix + exceptions read-only", () => {
  it("renders the matrix grid with reconstructed source rows from saved keys", async () => {
    const w = await mountStranded();
    // The grid fires (not the empty / need-subs branches): the row axis is
    // reconstructed from the saved matrix keys, the col axis from the live
    // target's sub_categories.
    expect(w.find("[data-test='matrix-grid']").exists()).toBe(true);
    expect(w.find("[data-test='matrix-need-subs']").exists()).toBe(false);
    expect(w.find("[data-test='matrix-empty']").exists()).toBe(false);
    // Reconstructed source rows "warm" + "cold" × target col "rough".
    expect(w.find("[data-test='cell-warm-rough']").exists()).toBe(true);
    expect(w.find("[data-test='cell-cold-rough']").exists()).toBe(true);
    w.unmount();
  });

  it("renders the matrix read-only — hint shown, cell click does not open a popover", async () => {
    const w = await mountStranded();
    expect(w.find("[data-test='matrix-readonly-hint']").exists()).toBe(true);
    // No popover before, and none after clicking a cell. The popover
    // teleports to <body>, so check the document, not just the wrapper.
    expect(document.body.querySelector("[data-test='cell-rule-popover']")).toBeNull();
    await w.find("[data-test='cell-warm-rough']").trigger("click");
    await flushPromises();
    expect(document.body.querySelector("[data-test='cell-rule-popover']")).toBeNull();
    w.unmount();
  });

  it("renders the exceptions read-only with stored source + target values visible", async () => {
    const w = await mountStranded();
    const ro = w.find("[data-test='cn-ex-readonly']");
    expect(ro.exists()).toBe(true);
    // Stored values survive the missing wildcard (the edit Selects would
    // swallow them because their option lists are empty).
    expect(ro.text()).toContain("red");
    expect(ro.text()).toContain("matte");
    // No editable Select in the stranded path.
    expect(w.find("[data-test='cn-ex-src-select']").exists()).toBe(false);
    w.unmount();
  });

  it("control: a healthy constraint (both refs present) stays interactive", async () => {
    const w = await mountHealthy();
    // Grid renders, but NOT read-only.
    expect(w.find("[data-test='matrix-grid']").exists()).toBe(true);
    expect(w.find("[data-test='matrix-readonly-hint']").exists()).toBe(false);
    // The editable exception Select is present (an exception exists).
    expect(w.find("[data-test='cn-ex-src-select']").exists()).toBe(true);
    expect(w.find("[data-test='cn-ex-readonly']").exists()).toBe(false);
    w.unmount();
  });
});
