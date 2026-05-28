import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import CrossLinks from "../CrossLinks.vue";

const router = createRouter({ history: createMemoryHistory(), routes: [
  { path: "/docs/:page?", name: "documentation-page", component: { template: "<div/>" } },
] });

describe("CrossLinks", () => {
  it("renders a chip per target and navigates on click", async () => {
    await router.push("/docs/wp-context"); await router.isReady();
    const w = mount(CrossLinks, {
      props: { links: [{ id: "wp-prompt-assembler", label: "WP Prompt Assembler", icon: "pi pi-align-left", tone: "node" }] },
      global: { plugins: [router] },
    });
    expect(w.text()).toContain("WP Prompt Assembler");
    await w.get('[data-test="doc-xlink"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.params.page).toBe("wp-prompt-assembler");
  });
});
