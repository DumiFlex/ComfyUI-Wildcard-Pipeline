import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createMemoryHistory } from "vue-router";

vi.mock("../../api/client", () => {
  const rows = [
    {
      id: "t1", name: "portrait", description: "", category_id: null, tags: [],
      is_favorite: false, template_string: "$subject $style", created_at: "", updated_at: "",
    },
  ];
  return {
    api: {
      templates: {
        list: vi.fn(async () => ({ items: rows, total: 1 })),
        favorite: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      categories: { list: vi.fn(async () => ({ items: [] })) },
    },
  };
});

import Templates from "../../views/Templates.vue";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/templates", component: Templates },
    { path: "/templates/:id/edit", component: { template: "<div/>" } },
    { path: "/templates/new", component: { template: "<div/>" } },
  ],
});

describe("Templates.vue", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("lists saved templates with their string preview", async () => {
    router.push("/templates");
    await router.isReady();
    const w = mount(Templates, { global: { plugins: [router] } });
    await flushPromises();
    expect(w.text()).toContain("portrait");
    expect(w.text()).toContain("$subject $style");
  });
});
