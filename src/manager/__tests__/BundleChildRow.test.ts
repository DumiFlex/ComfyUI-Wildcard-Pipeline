import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BundleChildRow from "../components/BundleChildRow.vue";

function makeChild(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "wc_a",
    type: "wildcard",
    enabled: true,
    meta: { name: "Hair Color" },
    ...over,
  };
}

describe("BundleChildRow.vue", () => {
  it("renders kind tag and display name", () => {
    const wrap = mount(BundleChildRow, {
      props: { child: makeChild(), idx: 0, selected: false },
    });
    expect(wrap.text()).toContain("WILDCARD");
    expect(wrap.text()).toContain("Hair Color");
  });

  it("falls back to '(unnamed)' when no meta.name and no top-level name", () => {
    const wrap = mount(BundleChildRow, {
      props: { child: { id: "x", type: "wildcard" }, idx: 0, selected: false },
    });
    expect(wrap.text()).toContain("(unnamed)");
  });

  it("bundle-typed child renders BUNDLE label + REFERENCE badge (not SNAPSHOT)", () => {
    const wrap = mount(BundleChildRow, {
      props: {
        child: { id: "b_ref", type: "bundle", name: "nested-bundle", color: "#abcdef" },
        idx: 0,
        selected: false,
      },
    });
    expect(wrap.text()).toContain("BUNDLE");
    expect(wrap.text()).toContain("nested-bundle");
    expect(wrap.text()).toContain("REFERENCE");
    // The frozen-snapshot wording must NOT appear on bundle refs.
    expect(wrap.text()).not.toContain("SNAPSHOT");
  });

  it("bundle ref reads name from the child entry (no meta wrapper)", () => {
    // Bundle refs persist as {id, type, name?, color?} — no meta.name.
    // BundleChildRow must read child.name directly for the bundle branch.
    const wrap = mount(BundleChildRow, {
      props: {
        child: { id: "b_x", type: "bundle", name: "subject_phrase" },
        idx: 0,
        selected: false,
      },
    });
    expect(wrap.text()).toContain("subject_phrase");
  });

  it("emits toggle when eye button clicked", async () => {
    const wrap = mount(BundleChildRow, {
      props: { child: makeChild(), idx: 0, selected: false },
    });
    await wrap.find('[data-test="bundle-child-toggle"]').trigger("click");
    expect(wrap.emitted("toggle")).toBeTruthy();
  });

  it("emits duplicate when clone button clicked", async () => {
    const wrap = mount(BundleChildRow, {
      props: { child: makeChild(), idx: 0, selected: false },
    });
    await wrap.find('[data-test="bundle-child-duplicate"]').trigger("click");
    expect(wrap.emitted("duplicate")).toBeTruthy();
  });

  it("emits remove when × button clicked", async () => {
    const wrap = mount(BundleChildRow, {
      props: { child: makeChild(), idx: 0, selected: false },
    });
    await wrap.find('[data-test="bundle-child-remove"]').trigger("click");
    expect(wrap.emitted("remove")).toBeTruthy();
  });

  it("emits select when main column clicked", async () => {
    const wrap = mount(BundleChildRow, {
      props: { child: makeChild(), idx: 0, selected: false },
    });
    await wrap.find('[data-test="bundle-child-main"]').trigger("click");
    expect(wrap.emitted("select")).toBeTruthy();
  });

  it("applies data-disabled when child.enabled is false", () => {
    const wrap = mount(BundleChildRow, {
      props: { child: makeChild({ enabled: false }), idx: 0, selected: false },
    });
    expect(wrap.attributes("data-disabled")).toBe("true");
  });

  it("applies data-selected when selected prop is true", () => {
    const wrap = mount(BundleChildRow, {
      props: { child: makeChild(), idx: 0, selected: true },
    });
    expect(wrap.attributes("data-selected")).toBe("true");
  });
});
