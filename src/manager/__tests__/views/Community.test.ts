import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

import type { EmbedMountOptions } from "../../community/embedLoader";

const mountEmbed = vi.fn((_opts: EmbedMountOptions) => ({
  unmount: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("../../community/embedLoader", () => ({
  EmbedLoadError: class EmbedLoadError extends Error {},
  loadEmbed: vi.fn(async () => ({ mount: mountEmbed })),
}));

vi.mock("../../community/tokenStore", () => ({
  createWpcTokenStore: () => ({
    getAccessToken: async () => null,
    getRefreshToken: async () => null,
    setTokens: async () => {},
    clear: async () => {},
  }),
}));

import Community from "../../views/Community.vue";
import { useUiStore } from "../../stores/uiStore";

async function mountCommunity() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/community/:rest(.*)*", component: Community }],
  });
  await router.push("/community");
  const wrap = mount(Community, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return wrap;
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  mountEmbed.mockClear();
});

describe("Community usage stats", () => {
  it("passes the usage-stats setting to the embed (on by default)", async () => {
    const wrap = await mountCommunity();
    expect(mountEmbed).toHaveBeenCalledTimes(1);
    expect(mountEmbed.mock.calls[0]?.[0].analytics).toBe(true);
    wrap.unmount();
  });

  it("passes analytics: false when the setting is off", async () => {
    useUiStore().setUsageStats(false);
    const wrap = await mountCommunity();
    expect(mountEmbed.mock.calls[0]?.[0].analytics).toBe(false);
    wrap.unmount();
  });
});
