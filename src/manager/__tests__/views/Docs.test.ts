import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { api } from "../../api/client";
import type { AiConfig } from "../../api/types";
import { _resetAiConfigForTests } from "../../composables/useAiConfig";
import { _resetAiChatForTests, useAiChat } from "../../composables/useAiChat";
import { createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";
import Docs from "../../views/Docs.vue";
import { DOC_PAGES, findPage } from "../../docs/registry";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/docs/:page?", name: "documentation-page", component: Docs, props: true },
  ],
});

// Pre-warm the page modules that the tests assert on. Vitest's module cache
// then resolves `import()` synchronously inside the watch+shallowRef pattern
// in Docs.vue, so flushPromises() is enough for DOM to settle.
beforeAll(async () => {
  await Promise.all([
    findPage("introduction")!.loader(),
    findPage("wp-context")!.loader(),
  ]);
});

async function mountAt(page?: string) {
  await router.push(page ? `/docs/${page}` : "/docs");
  await router.isReady();
  const w = mount(Docs, { props: { page }, global: { plugins: [router, createPinia()] } });
  await flushPromises();
  return w;
}

describe("Docs.vue", () => {
  it("lists every registry page in the sub-nav", async () => {
    const w = await mountAt();
    for (const p of DOC_PAGES) expect(w.text()).toContain(p.title);
  });

  it("renders the requested page and falls back to introduction for unknown", async () => {
    const w = await mountAt("wp-context");
    expect(w.get(".wp-doc-page__title").text()).toBe("WP Context");

    const w2 = await mountAt("does-not-exist");
    expect(w2.get(".wp-doc-page__title").text()).toBe("Introduction");
  });

  it("filters the sub-nav with the search box", async () => {
    const w = await mountAt();
    const input = w.get('[data-test="doc-search"]');
    (input.element as HTMLInputElement).value = "constraint";
    await input.trigger("input");
    expect(w.text()).toContain("Constraint");
    expect(w.text()).not.toContain("WP Prompt Cleaner");
  });

  it("opens the assistant about this page, or the selected text, once it's on", async () => {
    _resetAiConfigForTests();
    _resetAiChatForTests();
    const spy = vi.spyOn(api.ai, "config").mockResolvedValue(
      { enabled: true, model: "m" } as unknown as AiConfig);
    const w = await mountAt("wp-context");
    await w.get('[data-test="doc-ask-ai"]').trigger("click");
    const chat = useAiChat();
    expect(chat.open.value).toBe(true);
    expect(chat.input.value).toBe("Explain this page in simpler words");
    const sel = vi.spyOn(window, "getSelection").mockReturnValue(
      { toString: () => "  the  Context node " } as unknown as Selection);
    await w.get('[data-test="doc-ask-ai"]').trigger("click");
    expect(chat.input.value).toBe('Explain this in simpler words: "the Context node"');
    sel.mockRestore();
    spy.mockRestore();
    _resetAiConfigForTests();
    _resetAiChatForTests();
  });
});
