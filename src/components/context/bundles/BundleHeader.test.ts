import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BundleHeader from "./BundleHeader.vue";
import type { BundleInstance } from "../../../widgets/_shared";

function instance(overrides: Partial<BundleInstance> = {}): BundleInstance {
  return {
    _uid: "bundle-uid-12",
    library_id: "lib-coral",
    start_idx: 0,
    end_idx: 2,
    enabled: true,
    collapsed: false,
    inserted_at_hash: "h",
    name: "subject_phrase",
    color: null,
    ...overrides,
  };
}

describe("BundleHeader", () => {
  it("renders name + count + bundle chip", () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "subject_phrase", childCount: 3 },
    });
    expect(w.find(".wp-bundle-name").text()).toBe("subject_phrase");
    expect(w.find(".wp-bundle-summary").text()).toBe("3 mods");
    expect(w.find(".wp-bundle-chip").text()).toBe("bundle");
  });

  it("uses singular 'mod' for childCount === 1", () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "x", childCount: 1 },
    });
    expect(w.find(".wp-bundle-summary").text()).toBe("1 mod");
  });

  it("appends drift count when > 0", () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "x", childCount: 5, driftedCount: 2 },
    });
    expect(w.find(".wp-bundle-summary").text()).toBe("5 mods · 2 drifted");
  });

  it("uses default color when color prop is missing", () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "x", childCount: 0 },
    });
    const root = w.find(".wp-bundle-header");
    expect(root.attributes("style")).toContain("--b: var(--wp-bundle-default)");
  });

  it("uses user-picked color when provided", () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "x", childCount: 0, color: "#FB7185" },
    });
    const root = w.find(".wp-bundle-header");
    expect(root.attributes("style")).toContain("--b: #FB7185");
  });

  it("renders pi-box icon", () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "x", childCount: 0 },
    });
    expect(w.find(".wp-bundle-icon .pi-box").exists()).toBe(true);
  });

  it("collapse chevron is caret-down when expanded", () => {
    const w = mount(BundleHeader, {
      props: { instance: instance({ collapsed: false }), name: "x", childCount: 0 },
    });
    expect(w.find(".wp-bundle-collapse .pi-caret-down").exists()).toBe(true);
  });

  it("collapse chevron is caret-right when collapsed", () => {
    const w = mount(BundleHeader, {
      props: { instance: instance({ collapsed: true }), name: "x", childCount: 0 },
    });
    expect(w.find(".wp-bundle-collapse .pi-caret-right").exists()).toBe(true);
  });

  it("emits toggle-collapse on chevron click", async () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "x", childCount: 0 },
    });
    await w.find(".wp-bundle-collapse").trigger("click");
    expect(w.emitted("toggle-collapse")).toBeTruthy();
  });

  it("emits toggle-enabled with new state on checkbox change", async () => {
    const w = mount(BundleHeader, {
      props: { instance: instance({ enabled: true }), name: "x", childCount: 0 },
    });
    const input = w.find('input[type="checkbox"]');
    await input.setValue(false);
    const events = w.emitted("toggle-enabled");
    expect(events).toBeTruthy();
    expect(events && events[0]).toEqual([false]);
  });

  it("emits remove on remove-button click", async () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "x", childCount: 0 },
    });
    await w.find(".wp-bundle-action--danger").trigger("click");
    expect(w.emitted("remove")).toBeTruthy();
  });

  it("emits contextmenu on right-click", async () => {
    const w = mount(BundleHeader, {
      props: { instance: instance(), name: "x", childCount: 0 },
    });
    await w.find(".wp-bundle-header").trigger("contextmenu");
    expect(w.emitted("contextmenu")).toBeTruthy();
  });
});
