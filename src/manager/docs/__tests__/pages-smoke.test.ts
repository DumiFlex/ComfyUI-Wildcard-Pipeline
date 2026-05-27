import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import { createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import { DOC_PAGES } from "../registry";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/docs/:page?", name: "documentation-page", component: { template: "<div/>" } },
  ],
});

describe("doc pages smoke", () => {
  it.each(DOC_PAGES.map((p) => [p.id, p] as const))(
    "%s renders a hero title",
    async (_id, p) => {
      await router.push("/docs");
      await router.isReady();
      const mod = await p.loader();
      // Module doc pages now embed <StarterButton>, which reads a Pinia store
      // in setup — install a fresh Pinia so those pages mount.
      const w = mount(mod.default, { global: { plugins: [router, createPinia()] } });
      await flushPromises();
      expect(w.find(".wp-doc-page__title").exists()).toBe(true);
    },
  );
});
