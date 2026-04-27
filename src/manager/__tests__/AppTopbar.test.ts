import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

vi.mock("../community/mockApi", () => ({
  getCurrentUser: vi.fn(() => null),
  getInstalled: vi.fn(() => []),
  getStarred: vi.fn(() => []),
  getMyUploads: vi.fn(() => []),
  getInstallHistory: vi.fn(() => []),
  getApiStatus: vi.fn(async () => "online"),
  signInWithGitHub: vi.fn(),
  signOut: vi.fn(),
  getFeatured: vi.fn(async () => []),
  searchModules: vi.fn(async () => []),
  getModule: vi.fn(),
  installModule: vi.fn(),
  uninstallModule: vi.fn(),
  starModule: vi.fn(),
  uploadModule: vi.fn(),
}));

import AppTopbar from "../layout/AppTopbar.vue";
import { useUiStore } from "../stores/uiStore";
import { useCommunityStore } from "../stores/communityStore";

function makeRouter(start = "/wildcards"): Router {
  const r = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/wildcards", name: "wildcards", component: { template: "<div/>" } },
      { path: "/settings", name: "settings", component: { template: "<div/>" } },
      { path: "/community", name: "community", component: { template: "<div/>" } },
      { path: "/community/discover", name: "community-discover", component: { template: "<div/>" } },
      { path: "/community/profile", name: "community-profile", component: { template: "<div/>" } },
    ],
  });
  r.push(start);
  return r;
}

async function mountTopbar(start = "/wildcards") {
  const router = makeRouter(start);
  await router.isReady();
  const wrap = mount(AppTopbar, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return { wrap, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("AppTopbar.vue", () => {
  it("renders the brand link with logo + version", async () => {
    const { wrap } = await mountTopbar();
    const brand = wrap.find('[data-test="topbar-brand"]');
    expect(brand.exists()).toBe(true);
    expect(brand.text()).toContain("Wildcard Pipeline");
    expect(brand.text()).toMatch(/v\d/);
    expect(brand.find("img").exists()).toBe(true);
  });

  it("calls ui.toggleSidebar when the bars button is clicked", async () => {
    const { wrap } = await mountTopbar();
    const ui = useUiStore();
    expect(ui.sidebarCollapsed).toBe(false);
    await wrap.find('[data-test="topbar-toggle"]').trigger("click");
    expect(ui.sidebarCollapsed).toBe(true);
  });

  it("calls ui.cycleTheme when the theme button is clicked", async () => {
    const { wrap } = await mountTopbar();
    const ui = useUiStore();
    const before = ui.themeMode;
    await wrap.find('[data-test="topbar-theme"]').trigger("click");
    expect(ui.themeMode).not.toBe(before);
  });

  it("hides the community status pill on non-community routes", async () => {
    const { wrap } = await mountTopbar("/wildcards");
    expect(wrap.find('[data-test="topbar-status"]').exists()).toBe(false);
    expect(wrap.find('[data-test="topbar-signin"]').exists()).toBe(false);
    expect(wrap.find('[data-test="topbar-user"]').exists()).toBe(false);
  });

  it("shows the status pill on community routes", async () => {
    const { wrap } = await mountTopbar("/community/discover");
    expect(wrap.find('[data-test="topbar-status"]').exists()).toBe(true);
  });

  it("shows the sign-in button on community routes when no user", async () => {
    const { wrap } = await mountTopbar("/community/discover");
    expect(wrap.find('[data-test="topbar-signin"]').exists()).toBe(true);
  });

  it("shows the user pill + dropdown when signed in on community routes", async () => {
    const { wrap } = await mountTopbar("/community/discover");
    const community = useCommunityStore();
    community.currentUser = {
      login: "octocat",
      avatar_url: "https://example.com/a.png",
      verified: true,
      name: "Octo Cat",
    };
    await flushPromises();
    const userBtn = wrap.find('[data-test="topbar-user"]');
    expect(userBtn.exists()).toBe(true);
    // Dropdown closed initially
    expect(wrap.find('[data-test="topbar-user-menu"]').exists()).toBe(false);
    await userBtn.trigger("click");
    expect(wrap.find('[data-test="topbar-user-menu"]').exists()).toBe(true);
  });

  it("navigates to /settings when settings cog clicked", async () => {
    const { wrap, router } = await mountTopbar();
    await wrap.find('[data-test="topbar-settings"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/settings");
  });
});
