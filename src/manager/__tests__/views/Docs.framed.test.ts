import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi } from "vitest";
import { api } from "../../api/client";
import type { AiConfig } from "../../api/types";
import { _resetAiConfigForTests } from "../../composables/useAiConfig";
import { _resetAiChatForTests, useAiChat } from "../../composables/useAiChat";
import { createPinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

// The canvas help dialog shows the docs in a frame with no assistant chat.
vi.mock("../../router/frame-mode", async (orig) => ({
  ...(await orig<typeof import("../../router/frame-mode")>()),
  FRAMED: true,
}));

describe("Docs.vue in the canvas help frame", () => {
  it("hands \"Ask about this page\" to the full manager in a new tab", async () => {
    _resetAiConfigForTests();
    _resetAiChatForTests();
    const cfg = vi.spyOn(api.ai, "config").mockResolvedValue({ enabled: true, model: "m" } as unknown as AiConfig);
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const { default: Docs } = await import("../../views/Docs.vue");
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/docs/:page?", component: Docs, props: true }],
    });
    await router.push("/docs/wp-context");
    await router.isReady();
    const w = mount(Docs, { props: { page: "wp-context" }, global: { plugins: [router, createPinia()] } });
    await flushPromises();
    await w.get('[data-test="doc-ask-ai"]').trigger("click");
    expect(opened).toHaveBeenCalledTimes(1);
    const [url, target] = opened.mock.calls[0];
    expect(target).toBe("_blank");
    const u = new URL(String(url));
    expect(u.pathname).toBe("/wp/docs/wp-context");
    expect(u.searchParams.get("ask")).toBe('Explain the docs page "WP Context" in simpler words');
    // Nothing to open here: the frame has no chat.
    expect(useAiChat().open.value).toBe(false);
    opened.mockRestore();
    cfg.mockRestore();
    _resetAiConfigForTests();
    _resetAiChatForTests();
  });
});
