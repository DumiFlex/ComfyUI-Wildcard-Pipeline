import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import BundleReattachSection from "./BundleReattachSection.vue";

/**
 * Mirrors ConstraintReattachSection.test.ts — the bundle analog of the
 * manual per-endpoint reattach. A bundle's frozen child can dangle (its
 * `id` no longer resolves in the library). This section renders one
 * reattach row per dangling child; a leaf-module child picks from MODULE
 * candidates, a `type:"bundle"` child picks from BUNDLE candidates. Picking
 * + confirming emits `reattach { childId, newId, newName }`. A `downloadable`
 * child also renders a "Download from community" button emitting
 * `downloadreattach { childId }`.
 */
function mountSection(overrides = {}) {
  return mount(BundleReattachSection, {
    props: {
      danglingChildren: [
        { childId: "aaa", type: "wildcard", cachedName: "Sub" },
        { childId: "bbb", type: "bundle", cachedName: "Inner" },
      ],
      moduleCandidates: [
        { id: "mod1", name: "Live module" },
        { id: "mod2", name: "Other module" },
      ],
      bundleCandidates: [{ id: "bun1", name: "Live bundle" }],
      downloadableChildIds: [],
      ...overrides,
    },
  });
}

describe("BundleReattachSection", () => {
  it("renders one reattach row per dangling child", () => {
    const w = mountSection();
    expect(w.find("[data-test='bundle-reattach-row-aaa']").exists()).toBe(true);
    expect(w.find("[data-test='bundle-reattach-row-bbb']").exists()).toBe(true);
    // The dead id (sliced) + cached name surface in the row text.
    expect(w.find("[data-test='bundle-reattach-row-aaa']").text()).toContain("aaa");
    expect(w.find("[data-test='bundle-reattach-row-aaa']").text()).toContain("Sub");
  });

  it("lists MODULE candidates for a leaf child and BUNDLE candidates for a bundle child", async () => {
    const w = mountSection();
    // Leaf (wildcard) child → module candidates.
    await w.find("[data-test='bundle-reattach-btn-aaa']").trigger("click");
    const leafCands = w.findAll("[data-test='bundle-reattach-candidate']").map((c) => c.text());
    expect(leafCands).toContain("Live module");
    expect(leafCands).toContain("Other module");
    expect(leafCands).not.toContain("Live bundle");

    // Bundle child → bundle candidates.
    await w.find("[data-test='bundle-reattach-btn-bbb']").trigger("click");
    const bundleCands = w.findAll("[data-test='bundle-reattach-candidate']").map((c) => c.text());
    expect(bundleCands).toContain("Live bundle");
    expect(bundleCands).not.toContain("Live module");
  });

  it("picking + confirming emits reattach with childId + newId + newName", async () => {
    const w = mountSection();
    await w.find("[data-test='bundle-reattach-btn-aaa']").trigger("click");
    await w.find("[data-test-id='bundle-reattach-candidate-mod1']").trigger("click");
    await w.find("[data-test='bundle-reattach-confirm-aaa']").trigger("click");
    const ev = w.emitted("reattach");
    expect(ev).toBeTruthy();
    expect(ev![0][0]).toEqual({ childId: "aaa", newId: "mod1", newName: "Live module" });
  });

  it("renders the community-download button only for a downloadable child", () => {
    const w = mountSection({ downloadableChildIds: ["aaa"] });
    expect(w.find("[data-test='bundle-reattach-download-aaa']").exists()).toBe(true);
    expect(w.find("[data-test='bundle-reattach-download-bbb']").exists()).toBe(false);
  });

  it("omits the community-download button by default", () => {
    const w = mountSection();
    expect(w.find("[data-test='bundle-reattach-download-aaa']").exists()).toBe(false);
  });

  it("emits downloadreattach with the childId when the download button is clicked", async () => {
    const w = mountSection({ downloadableChildIds: ["aaa"] });
    await w.find("[data-test='bundle-reattach-download-aaa']").trigger("click");
    const ev = w.emitted("downloadreattach");
    expect(ev).toBeTruthy();
    expect(ev![0][0]).toEqual({ childId: "aaa" });
  });
});
