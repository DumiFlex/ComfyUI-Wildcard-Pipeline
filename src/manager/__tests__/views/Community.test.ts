import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("../../community/hostRuntime", () => ({
  createHostRuntime: () => ({
    abi: 1,
    schemaVersion: 10,
    install: vi.fn(),
    markPublished: vi.fn(),
  }),
}));

import Community from "../../views/Community.vue";
import { WPC_EMBED_FRAME_URL } from "../../config/links";
import { useUiStore } from "../../stores/uiStore";

const ORIGIN = new URL(WPC_EMBED_FRAME_URL).origin;

async function mountCommunity(path = "/community") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/community/:rest(.*)*", component: Community },
      { path: "/dashboard", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  const wrap = mount(Community, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  const iframe = wrap.find("iframe").element as HTMLIFrameElement;
  const posted: Array<Record<string, unknown>> = [];
  vi.spyOn(iframe.contentWindow!, "postMessage").mockImplementation(((msg: Record<string, unknown>) => {
    posted.push(msg);
  }) as never);
  const fromFrame = (data: Record<string, unknown>) => {
    window.dispatchEvent(Object.assign(new Event("message"), {
      data: { wpc: 1, ...data }, origin: ORIGIN, source: iframe.contentWindow,
    }));
  };
  return { wrap, router, iframe, posted, fromFrame };
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Community tab iframe", () => {
  it("frames the community page, sandboxed, at the routed view", async () => {
    const { wrap, iframe } = await mountCommunity("/community/p/dumi/pack");
    const src = new URL(iframe.src);
    expect(`${src.origin}${src.pathname}`).toBe(WPC_EMBED_FRAME_URL);
    expect(src.searchParams.get("view")).toBe("detail");
    expect(src.searchParams.get("slug")).toBe("dumi/pack");
    expect(iframe.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect((window as { __wpcRuntime?: unknown }).__wpcRuntime).toBeUndefined();
    wrap.unmount();
  });

  it("passes the usage-stats setting in hello", async () => {
    useUiStore().setUsageStats(false);
    const { wrap, posted, fromFrame } = await mountCommunity();
    fromFrame({ type: "event", name: "ready" });
    expect(posted[0]).toMatchObject({ type: "hello", abi: 1, schemaVersion: 10, analytics: false });
    wrap.unmount();
  });

  it("moves old tokens into the frame and wipes them on ack", async () => {
    localStorage.setItem("wpc.embed.access", "a");
    localStorage.setItem("wpc.embed.refresh", "r");
    localStorage.setItem("wpc.embed.expires_at", "5");
    const { wrap, posted, fromFrame } = await mountCommunity();
    fromFrame({ type: "event", name: "ready" });
    expect(posted[0]!.legacyTokens).toEqual({ access: "a", refresh: "r", expiresAt: 5 });
    expect(localStorage.getItem("wpc.embed.access")).toBe("a");
    fromFrame({ type: "event", name: "tokens-adopted" });
    expect(localStorage.getItem("wpc.embed.access")).toBeNull();
    wrap.unmount();
  });

  it("mirrors frame navigation into the router", async () => {
    const { wrap, router, fromFrame } = await mountCommunity();
    fromFrame({ type: "event", name: "ready" });
    fromFrame({ type: "event", name: "navigate", data: { view: "profile", username: "dumi" } });
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/community/u/dumi");
    wrap.unmount();
  });

  it("hands the publish hash to the frame and strips it", async () => {
    const { wrap, router, posted, fromFrame } = await mountCommunity();
    fromFrame({ type: "event", name: "ready" });
    await router.push("/community/publish");
    window.location.hash = "payload=abc";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await flushPromises();
    expect(posted.find((m) => m.name === "publish")?.data).toBe("payload=abc");
    expect(window.location.hash).toBe("");
    wrap.unmount();
  });

  it("shows the offline card when the frame never answers", async () => {
    vi.useFakeTimers();
    const { wrap } = await mountCommunity();
    vi.advanceTimersByTime(10_001);
    await flushPromises();
    expect(wrap.text()).toContain("Community is offline");
    expect(wrap.find("iframe").exists()).toBe(false);
    wrap.unmount();
  });
});
