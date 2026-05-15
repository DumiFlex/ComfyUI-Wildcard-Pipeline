import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  api: {
    modules: { list: vi.fn().mockResolvedValue({ items: [] }) },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import BundleChildPane from "../components/BundleChildPane.vue";

beforeEach(() => setActivePinia(createPinia()));

describe("BundleChildPane.vue", () => {
  it("renders empty state when no child selected", () => {
    const wrap = mount(BundleChildPane, {
      props: { child: null },
    });
    expect(wrap.find('[data-test="bundle-pane-empty"]').exists()).toBe(true);
    expect(wrap.text()).toContain("Pick a child");
  });

  it("renders header with display name and kind for wildcard child", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: {
          id: "wc_a",
          type: "wildcard",
          enabled: true,
          meta: { name: "outfit" },
          payload: { options: [], sub_categories: [] },
          instance: {},
        },
      },
    });
    expect(wrap.text()).toContain("outfit");
    expect(wrap.find('[data-test="bundle-pane-header"]').exists()).toBe(true);
  });

  it("shows frozen-snapshot banner", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: {
          id: "wc_a",
          type: "wildcard",
          meta: { name: "outfit" },
          payload: { options: [] },
          instance: {},
        },
      },
    });
    expect(wrap.find('[data-test="bundle-pane-banner"]').exists()).toBe(true);
    expect(wrap.text()).toContain("snapshot");
  });

  it("emits close when × clicked", async () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: { id: "wc_a", type: "wildcard", meta: { name: "outfit" }, payload: {} },
      },
    });
    await wrap.find('[data-test="bundle-pane-close"]').trigger("click");
    expect(wrap.emitted("close")).toBeTruthy();
  });

  it("mounts wildcard sections when child.type === 'wildcard'", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: {
          id: "wc_a",
          type: "wildcard",
          meta: { name: "outfit" },
          payload: { options: [], sub_categories: [] },
          instance: {},
        },
      },
    });
    expect(wrap.find('[data-test="bundle-pane-sections-wildcard"]').exists()).toBe(true);
  });

  it("mounts combine sections when child.type === 'combine'", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: {
          id: "cb_a",
          type: "combine",
          meta: { name: "subject" },
          payload: { template: "", output_var: "subject", input_vars: [] },
          instance: {},
        },
      },
    });
    expect(wrap.find('[data-test="bundle-pane-sections-combine"]').exists()).toBe(true);
  });

  it("mounts fixed_values sections when child.type === 'fixed_values'", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: {
          id: "fv_a",
          type: "fixed_values",
          meta: { name: "constants" },
          payload: { values: [] },
          instance: {},
        },
      },
    });
    expect(wrap.find('[data-test="bundle-pane-sections-fixed-values"]').exists()).toBe(true);
  });

  it("renders unsupported-kind placeholder for unknown types", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: { id: "x", type: "future_kind", meta: { name: "x" }, payload: {} },
      },
    });
    expect(wrap.find('[data-test="bundle-pane-unsupported"]').exists()).toBe(true);
  });
});
