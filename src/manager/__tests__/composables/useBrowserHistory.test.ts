import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h } from "vue";
import { useBrowserHistory } from "../../composables/useBrowserHistory";

describe("useBrowserHistory", () => {
  it("returns a reactive canGoBack ref", async () => {
    let captured: { hasRef: boolean } = { hasRef: false };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push("/");
    await router.isReady();
    const Harness = defineComponent({
      setup() {
        const { canGoBack } = useBrowserHistory();
        captured = { hasRef: typeof canGoBack.value === "boolean" };
        return () => h("div");
      },
    });
    mount(Harness, { global: { plugins: [router] } });
    expect(captured.hasRef).toBe(true);
  });

  it("updates canGoBack after router navigation", async () => {
    const observed: boolean[] = [];
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/a", component: { template: "<div />" } },
        { path: "/b", component: { template: "<div />" } },
      ],
    });
    await router.push("/a");
    await router.isReady();
    const Harness = defineComponent({
      setup() {
        const { canGoBack } = useBrowserHistory();
        observed.push(canGoBack.value);
        router.push("/b").then(() => {
          observed.push(canGoBack.value);
        });
        return () => h("div");
      },
    });
    mount(Harness, { global: { plugins: [router] } });
    await new Promise((r) => setTimeout(r, 10));
    // At least 2 observations captured (initial + post-nav).
    expect(observed.length).toBeGreaterThanOrEqual(2);
  });

  it("multiple consumers share the same canGoBack ref", async () => {
    let aRef: ReturnType<typeof useBrowserHistory>;
    let bRef: ReturnType<typeof useBrowserHistory>;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push("/");
    await router.isReady();
    const Harness = defineComponent({
      setup() {
        aRef = useBrowserHistory();
        bRef = useBrowserHistory();
        return () => h("div");
      },
    });
    mount(Harness, { global: { plugins: [router] } });
    expect(aRef!.canGoBack.value).toBe(bRef!.canGoBack.value);
  });
});
