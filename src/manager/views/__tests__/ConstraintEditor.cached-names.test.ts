import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

// Same harness as ConstraintEditor.reattach.test.ts — mock the API client +
// drive a memory router so the editor mounts headless. The constraint row is
// returned by `api.modules.get`; the wildcard catalog (which
// `moduleStore.fetchCatalog` writes into `catalog`) is returned by
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

/** Live catalog: `beef0001` ("colour") + `facade00` ("texture"). */
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

/** A fresh (new) constraint editor, catalog loaded, nothing selected. */
async function mountNew() {
  apiMod.list.mockResolvedValue({ items: catalog(), total: catalog().length });
  const w = mount(ConstraintEditor, {
    props: {},
    global: { plugins: [makeRouter()] },
  });
  await flushPromises();
  return w;
}

/** A constraint carrying cached ref names whose source uuid (`deadbeef`) is
 *  ABSENT from the catalog → dangling. The cached `source_wildcard_name`
 *  must survive the missing wildcard and feed the broken-reference banner. */
function danglingConstraintWithNames() {
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
      source_wildcard_name: "Starter subject",
      target_wildcard_name: "texture",
      matrix: {},
      exceptions: [],
    },
    version: 1, created_at: "", updated_at: "", is_favorite: false,
  };
}

async function mountDangling() {
  apiMod.list.mockResolvedValue({ items: catalog(), total: catalog().length });
  apiMod.get.mockResolvedValue(danglingConstraintWithNames());
  const w = mount(ConstraintEditor, {
    props: { id: "c0ffee00" },
    global: { plugins: [makeRouter()] },
  });
  await flushPromises();
  return w;
}

/** A legacy constraint: both source + target are LIVE in the catalog
 *  (`beef0001` colour / `facade00` texture) but the payload carries NO
 *  cached `*_wildcard_name` (pre-cache-feature). Backfill should resolve
 *  the names from the live catalog so they persist on the next save. */
function liveNamelessConstraint() {
  return {
    id: "c0ffee01",
    name: "warm-only",
    description: "",
    category_id: null,
    tags: [],
    type: "constraint",
    payload: {
      source_wildcard_id: "beef0001", // LIVE → "colour"
      target_wildcard_id: "facade00", // LIVE → "texture"
      // no source_wildcard_name / target_wildcard_name
      matrix: {},
      exceptions: [],
    },
    version: 1, created_at: "", updated_at: "", is_favorite: false,
  };
}

async function mountLiveNameless() {
  apiMod.list.mockResolvedValue({ items: catalog(), total: catalog().length });
  apiMod.get.mockResolvedValue(liveNamelessConstraint());
  const w = mount(ConstraintEditor, {
    props: { id: "c0ffee01" },
    global: { plugins: [makeRouter()] },
  });
  await flushPromises();
  return w;
}

describe("ConstraintEditor — cached source/target ref names", () => {
  it("picking a source wildcard stamps source_wildcard_name from the catalog", async () => {
    const w = await mountNew();
    const vm = w.vm as unknown as { sourceWildcardName: string | null };
    // The source dropdown emits the picked uuid via @update:model-value;
    // findComponent gives the <Select> instance so we can fire it. The string
    // selector returns a WrapperLike (no typed .vm), so narrow to VueWrapper.
    const select = w.findComponent("[data-test='source-wildcard-select']") as unknown as VueWrapper;
    expect(select.exists()).toBe(true);
    select.vm.$emit("update:model-value", "beef0001");
    await flushPromises();
    expect(vm.sourceWildcardName).toBe("colour");
  });

  it("picking a target wildcard stamps target_wildcard_name from the catalog", async () => {
    const w = await mountNew();
    const vm = w.vm as unknown as { targetWildcardName: string | null };
    const select = w.findComponent("[data-test='target-wildcard-select']") as unknown as VueWrapper;
    select.vm.$emit("update:model-value", "facade00");
    await flushPromises();
    expect(vm.targetWildcardName).toBe("texture");
  });

  it("reattach stamps source_wildcard_name from the emitted newName", async () => {
    const w = await mountDangling();
    const vm = w.vm as unknown as { sourceWildcardName: string | null };
    await w.find("[data-test='reattach-btn-source']").trigger("click");
    await w.find("[data-test-id='reattach-candidate-beef0001']").trigger("click");
    await w.find("[data-test='reattach-confirm-source']").trigger("click");
    // newName for beef0001 is "colour" (its catalog name).
    expect(vm.sourceWildcardName).toBe("colour");
  });

  it("round-trips source_wildcard_name on load", async () => {
    const w = await mountDangling();
    const vm = w.vm as unknown as {
      sourceWildcardName: string | null;
      targetWildcardName: string | null;
    };
    expect(vm.sourceWildcardName).toBe("Starter subject");
    expect(vm.targetWildcardName).toBe("texture");
  });

  it("dangling-source banner shows BOTH the cached name and the uuid", async () => {
    const w = await mountDangling();
    const row = w.find("[data-test='reattach-row-source']");
    expect(row.exists()).toBe(true);
    const txt = row.text();
    // The cached name survives the deleted wildcard …
    expect(txt).toContain("Starter subject");
    // … alongside the 8-char uuid prefix.
    expect(txt).toContain("deadbeef");
  });

  it("backfills the cached name from the LIVE wildcard when the constraint has none", async () => {
    // Legacy constraint, no cached names, but both wildcards still live.
    // resolvedSourceName/resolvedTargetName resolve the live names so the save
    // payload stamps them — capturing the name BEFORE the wildcard can be
    // deleted (after which it's unrecoverable).
    const w = await mountLiveNameless();
    const vm = w.vm as unknown as {
      resolvedSourceName: string | null;
      resolvedTargetName: string | null;
    };
    expect(vm.resolvedSourceName).toBe("colour");
    expect(vm.resolvedTargetName).toBe("texture");
  });

  it("resolved name keeps the cached value for a stranded source (no live lookup)", async () => {
    // Stranded source (deleted): no live wildcard to read, so the cached
    // "Starter subject" is preserved rather than blanked.
    const w = await mountDangling();
    const vm = w.vm as unknown as { resolvedSourceName: string | null };
    expect(vm.resolvedSourceName).toBe("Starter subject");
  });
});
