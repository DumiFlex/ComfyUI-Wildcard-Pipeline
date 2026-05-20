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

  it("mounts derivation sections when child.type === 'derivation'", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: {
          id: "dv_a",
          type: "derivation",
          meta: { name: "mood_to_lighting" },
          payload: { rules: [] },
          instance: {},
        },
      },
    });
    expect(wrap.find('[data-test="bundle-pane-sections-derivation"]').exists()).toBe(true);
  });

  it("mounts constraint sections when child.type === 'constraint'", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: {
          id: "cn_a",
          type: "constraint",
          meta: { name: "hair_x_mood" },
          payload: {
            source_wildcard_id: "",
            target_wildcard_id: "",
            matrix: {},
            exceptions: [],
          },
          instance: {},
        },
      },
    });
    expect(wrap.find('[data-test="bundle-pane-sections-constraint"]').exists()).toBe(true);
  });

  it("renders unsupported-kind placeholder for unknown types", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: { id: "x", type: "future_kind", meta: { name: "x" }, payload: {} },
      },
    });
    expect(wrap.find('[data-test="bundle-pane-unsupported"]').exists()).toBe(true);
  });

  // ── Tier-2 nesting: bundle reference branch ─────────────────────────

  it("renders the reference summary block for bundle-type children", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: {
          id: "b_ref",
          type: "bundle",
          name: "nested-bundle",
          color: "#abcdef",
          children: [
            { id: "c1", type: "wildcard" },
            { id: "c2", type: "fixed_values" },
            { id: "c3", type: "combine" },
          ],
          _resolved_from: "b_ref",
        },
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    expect(wrap.find('[data-test="bundle-pane-sections-bundle"]').exists()).toBe(true);
    // The reference banner replaces the frozen-snapshot wording.
    expect(wrap.text()).toContain("live reference");
    expect(wrap.text()).not.toContain("snapshot");
    // Inner count reflects the GET-expanded payload.
    expect(wrap.text()).toContain("3");
    // Open-in-editor CTA is wired.
    expect(wrap.find('[data-test="bundle-pane-ref-open"]').exists()).toBe(true);
  });

  it("bundle reference reads display name off the row (not meta.name)", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: { id: "b_ref", type: "bundle", name: "subject_phrase" },
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    expect(wrap.text()).toContain("subject_phrase");
  });

  it("bundle ref with no children resolves to count 0", () => {
    const wrap = mount(BundleChildPane, {
      props: {
        child: { id: "b_missing", type: "bundle", name: "missing", _missing_ref: true },
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    expect(wrap.find('[data-test="bundle-pane-sections-bundle"]').exists()).toBe(true);
    expect(wrap.text()).toContain("0");
  });
});
