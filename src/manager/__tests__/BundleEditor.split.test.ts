import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("../api/client", () => ({
  api: {
    bundles: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), favorite: vi.fn(),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
    modules: { list: vi.fn().mockResolvedValue({ items: [] }) },
    ai: {
      config: vi.fn().mockResolvedValue({ enabled: true, model: "m", provider: "ollama", presets: {} }),
      bundleSplit: vi.fn(),
    },
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from "../api/client";
import BundleEditor from "../views/BundleEditor.vue";
import { _resetAiConfigForTests } from "../composables/useAiConfig";
import { usePackBuilder, _resetPackBuilderForTests } from "../composables/usePackBuilder";

const B = api.bundles as unknown as Record<string, ReturnType<typeof vi.fn>>;
const kid = (id: string, name: string) => ({ id, type: "wildcard", meta: { name }, payload: { options: [] } });

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/bundles", name: "bundles", component: { template: "<div/>" } },
      { path: "/bundles/:id/edit", name: "bundles-edit", component: { template: "<div/>" } },
      { path: "/pack-builder", name: "pack-builder", component: { template: "<div/>" } },
    ],
  });
}

describe("BundleEditor sub-bundles and Extend with AI", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiConfigForTests();
    _resetPackBuilderForTests();
    B.get.mockResolvedValue({
      id: "bn000001", name: "Look", description: "", color: null, category_id: null, tags: ["t"],
      is_favorite: false, payload_hash: "", version: 1, created_at: "", updated_at: "",
      children: [kid("a0000001", "Hair"), kid("a0000002", "Eyes"), kid("a0000003", "Shirt"),
        kid("a0000004", "Sky")],
    });
    B.create.mockReset().mockImplementation(async (body: { name: string; children: unknown[] }) => ({
      id: `cc00000${B.create.mock.calls.length}`, name: body.name, color: null, children: body.children,
    }));
  });

  async function mountIt() {
    const router = makeRouter();
    await router.push("/bundles/bn000001/edit");
    const w = mount(BundleEditor, { props: { id: "bn000001" }, global: { plugins: [router] } });
    await flushPromises();
    return { w, router };
  }

  it("groups children by name into sub-bundles placed where the first one was", async () => {
    vi.mocked(api.ai.bundleSplit).mockResolvedValue({
      model: "m", groups: [{ name: "Body", about: "the person", start: 0, end: 1 }],
    });
    const { w } = await mountIt();
    await w.get('[data-test="bd-split-btn"]').trigger("click");
    await flushPromises();
    await document.querySelector<HTMLButtonElement>('[data-test="split-suggest"]')?.click();
    await flushPromises();
    const labels = [...document.querySelectorAll<HTMLInputElement>('[data-test="split-label"]')];
    expect(labels.map((l) => l.value)).toEqual(["Body", "Body", "", ""]);
    // A hand-made group with a gap is flagged.
    labels[3].value = "Body";
    labels[3].dispatchEvent(new Event("input"));
    await flushPromises();
    expect(document.querySelector('[data-test="split-gap"]')).not.toBeNull();
    labels[3].value = "";
    labels[3].dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLButtonElement>('[data-test="split-apply"]')?.click();
    await flushPromises();
    expect(B.create).toHaveBeenCalledTimes(1);
    expect(B.create.mock.calls[0][0]).toMatchObject({ name: "Look · Body", description: "the person", tags: ["t"] });
    expect(w.text()).toContain("Children (3)");
    w.unmount();
  });

  it("opens the pack builder aimed at the bundle", async () => {
    const { w, router } = await mountIt();
    await w.get('[data-test="bd-extend-ai"]').trigger("click");
    await flushPromises();
    expect(usePackBuilder().target.value).toEqual({ id: "bn000001", name: "Look" });
    expect(router.currentRoute.value.name).toBe("pack-builder");
    w.unmount();
  });
});
