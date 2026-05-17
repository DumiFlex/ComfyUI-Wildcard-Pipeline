import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import AppSidebar from "../layout/AppSidebar.vue";
import { useUiStore } from "../stores/uiStore";

function makeRouter(start = "/wildcards"): Router {
  return createRouter({
    history: createMemoryHistory(start),
    routes: [
      { path: "/", redirect: "/dashboard" },
      { path: "/dashboard", name: "dashboard", component: { template: "<div/>" } },
      { path: "/wildcards", name: "wildcards", component: { template: "<div/>" } },
      { path: "/wildcards/:id/edit", name: "wildcards-edit", component: { template: "<div/>" } },
      { path: "/fixed-values", name: "fixed-values", component: { template: "<div/>" } },
      { path: "/combines", name: "combines", component: { template: "<div/>" } },
      { path: "/derivations", name: "derivations", component: { template: "<div/>" } },
      { path: "/constraints", name: "constraints", component: { template: "<div/>" } },
      { path: "/categories", name: "categories", component: { template: "<div/>" } },
      { path: "/import-export", name: "import-export", component: { template: "<div/>" } },
      { path: "/test", name: "test", component: { template: "<div/>" } },
      { path: "/community", name: "community", component: { template: "<div/>" } },
    ],
  });
}

async function mountSidebar(start = "/wildcards") {
  const router = makeRouter(start);
  await router.push(start);
  await router.isReady();
  const wrap = mount(AppSidebar, {
    global: { plugins: [router] },
  });
  await flushPromises();
  return { wrap, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("AppSidebar.vue", () => {
  it("renders all four section headers", async () => {
    const { wrap } = await mountSidebar();
    const sections = wrap.findAll(".wp-sidebar__section").map((n) => n.text());
    expect(sections).toEqual(["Home", "Modules", "Library", "Get Started"]);
  });

  it("renders all six modules items", async () => {
    const { wrap } = await mountSidebar();
    const labels = wrap.findAll(".wp-nav__label").map((n) => n.text());
    // Modules
    expect(labels).toContain("Wildcards");
    expect(labels).toContain("Fixed Values");
    expect(labels).toContain("Combines");
    expect(labels).toContain("Derivations");
    expect(labels).toContain("Constraints");
    expect(labels).toContain("Bundles");
    // Library
    expect(labels).toContain("Categories");
    expect(labels).toContain("Import / Export");
    expect(labels).toContain("Test Runner");
    // Get Started
    expect(labels).toContain("Community");
    expect(labels).toContain("Documentation");
    expect(labels).toContain("View Source");
    // Home
    expect(labels).toContain("Dashboard");
  });

  it("marks the matching item active when on its route", async () => {
    const { wrap } = await mountSidebar("/wildcards");
    const active = wrap.find('[data-nav-id="wildcards"]');
    expect(active.exists()).toBe(true);
    expect(active.attributes("data-active")).toBe("true");
    // Sibling not active
    const sib = wrap.find('[data-nav-id="combines"]');
    expect(sib.attributes("data-active")).toBeUndefined();
  });

  it("treats editor sub-routes as the parent kind active", async () => {
    const { wrap } = await mountSidebar("/wildcards/abc/edit");
    const active = wrap.find('[data-nav-id="wildcards"]');
    expect(active.attributes("data-active")).toBe("true");
  });

  it("renders external links as anchors with target=_blank", async () => {
    const { wrap } = await mountSidebar();
    const docs = wrap
      .findAll("a.wp-nav")
      .find((a) => a.text().includes("Documentation"));
    if (!docs) throw new Error("Documentation link not found");
    expect(docs.attributes("target")).toBe("_blank");
    expect(docs.attributes("rel")).toContain("noopener");
    expect(docs.attributes("href")).toMatch(/^https?:\/\//);
  });

  it("hides section labels when sidebar is collapsed", async () => {
    const { wrap } = await mountSidebar();
    const ui = useUiStore();
    ui.sidebarCollapsed = true;
    await flushPromises();
    expect(wrap.findAll(".wp-sidebar__section")).toHaveLength(0);
    // Labels also hidden
    expect(wrap.findAll(".wp-nav__label")).toHaveLength(0);
  });
});
