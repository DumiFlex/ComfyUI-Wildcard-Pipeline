import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("../api/client", () => ({
  api: {
    health: { scan: vi.fn(), ignore: vi.fn(), variety: vi.fn() },
    modules: { list: vi.fn(), delete: vi.fn() },
    bundles: { list: vi.fn() },
    templates: { list: vi.fn() },
    categories: { list: vi.fn(), delete: vi.fn() },
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

// No canvas tab in tests: skip the 250 ms wait for an answer.
vi.mock("../utils/ai-context", () => ({ askCanvasFacts: vi.fn().mockResolvedValue(undefined) }));

import { api } from "../api/client";
import type { HealthScan } from "../api/types";
import LibraryHealth from "../views/LibraryHealth.vue";
import { useBundleStore } from "../stores/bundleStore";
import { useHealthStore } from "../stores/healthStore";

const health = api.health as unknown as Record<string, ReturnType<typeof vi.fn>>;
const modules = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;

const SCAN: HealthScan = {
  findings: [
    {
      check: "missing_ref", severity: "problem", key: "missing_ref:module:aaaa0001",
      item: { kind: "module", id: "aaaa0001", name: "Outfit", type: "wildcard" },
      detail: "Points at 1 wildcard no longer in the library (\"Shoes\").", values: ["deadbeef"],
    },
    {
      check: "duplicate_name", severity: "warning", key: "duplicate_name:module:aaaa0002",
      item: { kind: "module", id: "aaaa0002", name: "Mood", type: "wildcard" },
      detail: "2 items of this kind are called \"Mood\".",
      others: [{ kind: "module", id: "aaaa0003", name: "Mood", type: "wildcard" }],
    },
    {
      check: "unused", severity: "tidy", key: "unused:module:aaaa0004",
      item: { kind: "module", id: "aaaa0004", name: "Old hats", type: "wildcard" },
      detail: "No bundle, template, constraint or reference uses it.",
    },
    {
      check: "unused", severity: "tidy", key: "unused:module:aaaa0005",
      item: { kind: "module", id: "aaaa0005", name: "Test colours", type: "wildcard" },
      detail: "No bundle, template, constraint or reference uses it.",
    },
  ],
  ignored: [],
  counts: { problem: 1, warning: 1, tidy: 2 },
  checks: [
    { id: "missing_ref", severity: "problem", title: "Points at a wildcard that's gone" },
    { id: "duplicate_name", severity: "warning", title: "Same name twice" },
    { id: "unused", severity: "tidy", title: "Not used by any bundle, template or reference" },
  ],
  canvas: false,
  checked_at: new Date().toISOString(),
};

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/health", component: LibraryHealth },
      { path: "/wildcards/:id/edit", component: { template: "<div/>" } },
      { path: "/test", component: { template: "<div/>" } },
    ],
  });
}

async function mountPage() {
  const router = makeRouter();
  await router.push("/");
  const wrap = mount(LibraryHealth, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { wrap, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  health.scan.mockResolvedValue(structuredClone(SCAN));
  health.ignore.mockImplementation(async (add: string[], remove: string[] = []) => ({
    ignored: add.filter((k) => !remove.includes(k)),
  }));
  (api.bundles as unknown as Record<string, ReturnType<typeof vi.fn>>).list
    .mockResolvedValue({ items: [], total: 0 });
  modules.delete.mockResolvedValue({ deleted: true });
});
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("LibraryHealth.vue", () => {
  it("shows counts, groups problems first and says when no canvas answered", async () => {
    const { wrap } = await mountPage();
    expect(wrap.get('[data-test="health-card-problem"]').text()).toContain("1");
    expect(wrap.get('[data-test="health-card-tidy"]').text()).toContain("2");
    const titles = wrap.findAll(".wp-health__group-title").map((t) => t.text());
    expect(titles[0]).toBe("Points at a wildcard that's gone");
    expect(titles).toContain("Same name twice");
    expect(wrap.text()).toContain("No ComfyUI canvas is open");
    // The scan was sent without canvas facts.
    expect(health.scan).toHaveBeenCalledWith(null);
    wrap.unmount();
  });

  it("filters by severity and search", async () => {
    const { wrap } = await mountPage();
    await wrap.get('[data-test="health-filter-problem"]').trigger("click");
    let titles = wrap.findAll(".wp-health__group-title").map((t) => t.text());
    expect(titles).toEqual(["Points at a wildcard that's gone"]);
    await wrap.get('[data-test="health-filter-all"]').trigger("click");
    await wrap.get('input[aria-label="Search findings"]').setValue("hats");
    titles = wrap.findAll(".wp-health__group-title").map((t) => t.text());
    expect(titles).toEqual(["Not used by any bundle, template or reference"]);
    wrap.unmount();
  });

  it("ignores a finding and hides it until Show ignored is on", async () => {
    const { wrap } = await mountPage();
    await wrap.get('[data-test="health-ignore-missing_ref:module:aaaa0001"]').trigger("click");
    await flushPromises();
    expect(health.ignore).toHaveBeenCalledWith(["missing_ref:module:aaaa0001"], []);
    expect(wrap.find('[data-test="health-row-missing_ref:module:aaaa0001"]').exists()).toBe(false);
    expect(useHealthStore().counts.problem).toBe(0);
    await wrap.get('[data-test="health-show-ignored"]').trigger("click");
    expect(wrap.find('[data-test="health-row-missing_ref:module:aaaa0001"]').exists()).toBe(true);
    wrap.unmount();
  });

  it("deletes every unused item after one confirm", async () => {
    const { wrap } = await mountPage();
    await wrap.get('[data-test="health-delete-all"]').trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("Delete 2 items?");
    const confirm = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete");
    confirm?.click();
    await flushPromises();
    expect(modules.delete.mock.calls.map((c) => c[0])).toEqual(["aaaa0004", "aaaa0005"]);
    wrap.unmount();
  });

  it("opens an item's editor", async () => {
    const { wrap, router } = await mountPage();
    const row = wrap.get('[data-test="health-row-missing_ref:module:aaaa0001"]');
    await row.get(".wp-health__item").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/wildcards/aaaa0001/edit");
    wrap.unmount();
  });

  it("runs the variety check for a bundle", async () => {
    useBundleStore().catalog = [{ id: "bund0001", name: "Sky", children: [] } as never];
    health.variety.mockResolvedValue({
      runs: 200, failed: 0, distinct: 150, ratio: 0.75,
      stuck: [{ var: "weather", name: "Weather", value: "rain" }],
      never_picked: [], warnings: [],
    });
    const { wrap } = await mountPage();
    await wrap.get('[data-test="health-variety-bund0001"]').trigger("click");
    await flushPromises();
    expect(health.variety).toHaveBeenCalledWith("bund0001");
    expect(document.body.textContent).toContain("150 of 200");
    expect(document.body.textContent).toContain("$weather");
    wrap.unmount();
  });
});
