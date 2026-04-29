import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import AppTopbar from "../layout/AppTopbar.vue";
import { useUiStore } from "../stores/uiStore";

// Community status pill / sign-in / user-menu surfaces moved to the
// `feat/community-tab` branch alongside the views that need them. Topbar
// on main only carries the always-on chrome (brand, theme, tweaks,
// settings cog), so this suite shrinks accordingly.

function makeRouter(start = "/wildcards"): Router {
  const r = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/wildcards", name: "wildcards", component: { template: "<div/>" } },
      { path: "/settings", name: "settings", component: { template: "<div/>" } },
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

  it("does not render any community-specific surfaces", async () => {
    const { wrap } = await mountTopbar("/wildcards");
    expect(wrap.find('[data-test="topbar-status"]').exists()).toBe(false);
    expect(wrap.find('[data-test="topbar-signin"]').exists()).toBe(false);
    expect(wrap.find('[data-test="topbar-user"]').exists()).toBe(false);
  });

  it("navigates to /settings when settings cog clicked", async () => {
    const { wrap, router } = await mountTopbar();
    await wrap.find('[data-test="topbar-settings"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/settings");
  });
});
