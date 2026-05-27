/**
 * WildcardEditor starter-prefill tests.
 *
 * When the user navigates to /wildcards/new?starter=subject the editor should
 * open pre-filled with name="subject", varBinding="subject", and three options
 * ("a cat", "a dog", "a fox"). Any other or absent starter query param leaves
 * the editor in its default empty state.
 */
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("../api/client", () => ({
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

import WildcardEditor from "../views/WildcardEditor.vue";

function makeRouter(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/wildcards/new", component: WildcardEditor },
      { path: "/wildcards", component: { template: "<div/>" } },
    ],
  });
  router.push(path);
  return router;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("WildcardEditor starter prefill", () => {
  it("pre-fills name, varBinding, and three options when starter=subject", async () => {
    const router = makeRouter("/wildcards/new?starter=subject");
    await router.isReady();
    const w = mount(WildcardEditor, { global: { plugins: [router] } });
    await flushPromises();

    // We access the exposed `options` ref directly via the component instance
    const vm = w.vm as unknown as { options: Array<{ value: string; weight: number }> };
    expect(vm.options).toHaveLength(3);
    expect(vm.options.map((o) => o.value)).toEqual(["a cat", "a dog", "a fox"]);
    vm.options.forEach((o) => expect(o.weight).toBe(1));

    // Title should still say "New wildcard" (not edit mode)
    expect(w.text()).toContain("New wildcard");

    // The name is rendered into the identity-name input's value.
    const nameInput = w.find('[data-test="identity-name"]');
    expect((nameInput.element as HTMLInputElement).value).toBe("subject");
  });

  it("leaves the editor empty when no starter param is present", async () => {
    const router = makeRouter("/wildcards/new");
    await router.isReady();
    const w = mount(WildcardEditor, { global: { plugins: [router] } });
    await flushPromises();

    const vm = w.vm as unknown as { options: Array<{ value: string; weight: number }> };
    // Default: two empty option rows
    expect(vm.options).toHaveLength(2);
    vm.options.forEach((o) => expect(o.value).toBe(""));
  });

  it("leaves the editor empty when starter has an unknown key", async () => {
    const router = makeRouter("/wildcards/new?starter=unknown");
    await router.isReady();
    const w = mount(WildcardEditor, { global: { plugins: [router] } });
    await flushPromises();

    const vm = w.vm as unknown as { options: Array<{ value: string; weight: number }> };
    expect(vm.options).toHaveLength(2);
    vm.options.forEach((o) => expect(o.value).toBe(""));
  });
});
