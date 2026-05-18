import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
vi.mock("../api/client", () => ({
  api: {
    modules: {
      list: vi.fn(),
      delete: vi.fn(),
      duplicate: vi.fn(),
      favorite: vi.fn(),
    },
    bundles: {
      list: vi.fn(),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from "../api/client";
import Dashboard from "../views/Dashboard.vue";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiBundles = api.bundles as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
  Object.values(apiBundles).forEach((fn) => fn.mockReset());
  apiBundles.list.mockResolvedValue({ items: [], total: 0 });
});
afterEach(() => vi.clearAllMocks());

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/wildcards", name: "wildcards", component: { template: "<div/>" } },
      { path: "/wildcards/new", component: { template: "<div/>" } },
      { path: "/wildcards/:id/edit", name: "wildcards-edit", component: { template: "<div/>" } },
      { path: "/fixed-values", name: "fixed-values", component: { template: "<div/>" } },
      { path: "/fixed-values/new", component: { template: "<div/>" } },
      { path: "/combines", name: "combines", component: { template: "<div/>" } },
      { path: "/combines/new", component: { template: "<div/>" } },
      { path: "/derivations", name: "derivations", component: { template: "<div/>" } },
      { path: "/derivations/new", component: { template: "<div/>" } },
      { path: "/constraints", name: "constraints", component: { template: "<div/>" } },
      { path: "/constraints/new", component: { template: "<div/>" } },
      { path: "/bundles", name: "bundles", component: { template: "<div/>" } },
      { path: "/bundles/new", component: { template: "<div/>" } },
      { path: "/categories", component: { template: "<div/>" } },
      { path: "/import-export", component: { template: "<div/>" } },
      { path: "/test", component: { template: "<div/>" } },
    ],
  });
}

function mountView() {
  return mount(Dashboard, {
    global: { plugins: [makeRouter()] },
  });
}

describe("Dashboard.vue", () => {
  it("renders the hero title", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    expect(wrap.text()).toContain("Welcome to Wildcard Pipeline");
  });

  it("shows 6 kind stat cards", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    const stats = wrap.findAll(".dashboard__stat");
    expect(stats).toHaveLength(6);
    const text = wrap.text();
    expect(text).toContain("Wildcards");
    expect(text).toContain("Fixed Values");
    expect(text).toContain("Combines");
    expect(text).toContain("Derivations");
    expect(text).toContain("Constraints");
    expect(text).toContain("Bundles");
  });

  it("renders without crashing when API returns empty arrays", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    // Default tab is Recently opened — empty-state copy.
    expect(wrap.text()).toContain("No recently opened items yet");
    // Switch to Recent edits tab and confirm its empty-state copy.
    await wrap.get('[data-test="dashboard-tab-recent"]').trigger("click");
    expect(wrap.text()).toContain("No edits yet.");
    // Switch to Favorites tab and confirm its empty-state copy.
    await wrap.get('[data-test="dashboard-tab-favorites"]').trigger("click");
    expect(wrap.text()).toContain("No favorites yet.");
  });

  it("clicking a stat card navigates to that kind list", async () => {
    apiMod.list.mockResolvedValue({ items: [], total: 0 });
    const router = makeRouter();
    const push = vi.spyOn(router, "push");
    const wrap = mount(Dashboard, {
      global: { plugins: [router] },
    });
    await flushPromises();
    const stats = wrap.findAll(".dashboard__stat");
    await stats[0]!.trigger("click"); // wildcards
    expect(push).toHaveBeenCalledWith("/wildcards");
  });
});
