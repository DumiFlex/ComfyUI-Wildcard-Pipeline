import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { useAskHandoff } from "../../composables/useAskHandoff";
import { _resetAiChatForTests, useAiChat } from "../../composables/useAiChat";
import { askInManagerUrl } from "../../router/frame-mode";

const Shell = defineComponent({ setup() { useAskHandoff(); return () => h("div"); } });
const Page = defineComponent({ render: () => h("div") });

describe("useAskHandoff", () => {
  it("opens the chat with the question the help frame handed over, then drops it from the address", async () => {
    _resetAiChatForTests();
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/docs/:page?", component: Page }] });
    const url = new URL(askInManagerUrl("http://x", "/docs/wp-note", "#s-when", 'Explain the docs page "WP Note" & more'));
    await router.push(`${url.pathname.replace(/^\/wp/, "")}${url.search}${url.hash}`);
    await router.isReady();
    mount(Shell, { global: { plugins: [router] } });
    await flushPromises();
    const chat = useAiChat();
    expect(chat.open.value).toBe(true);
    expect(chat.input.value).toBe('Explain the docs page "WP Note" & more');
    expect(router.currentRoute.value.query.ask).toBeUndefined();
    expect(router.currentRoute.value.fullPath).toBe("/docs/wp-note#s-when");
    _resetAiChatForTests();
  });

  it("leaves the chat shut without a question", async () => {
    _resetAiChatForTests();
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/docs/:page?", component: Page }] });
    await router.push("/docs/wp-note");
    await router.isReady();
    mount(Shell, { global: { plugins: [router] } });
    await flushPromises();
    expect(useAiChat().open.value).toBe(false);
  });
});
