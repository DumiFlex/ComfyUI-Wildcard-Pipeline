import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BundleAddChildModal from "../components/BundleAddChildModal.vue";
import type { BundleRow, ModuleRow } from "../api/types";

function makeModule(o: Partial<ModuleRow>): ModuleRow {
  return {
    id: o.id ?? "m_x",
    type: o.type ?? "wildcard",
    name: o.name ?? "x",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {},
    payload_hash: "",
    version: 1,
    created_at: "",
    updated_at: "",
    ...o,
  };
}

function makeBundle(o: Partial<BundleRow>): BundleRow {
  return {
    id: o.id ?? "b_x",
    name: o.name ?? "bundle-x",
    description: "",
    color: null,
    category_id: null,
    tags: [],
    is_favorite: false,
    children: [],
    payload_hash: "",
    version: 1,
    created_at: "",
    updated_at: "",
    ...o,
  };
}

describe("BundleAddChildModal.vue", () => {
  it("lists every module passed in", () => {
    const wrap = mount(BundleAddChildModal, {
      props: {
        visible: true,
        modules: [
          makeModule({ id: "m_a", name: "alpha", type: "wildcard" }),
          makeModule({ id: "m_b", name: "beta", type: "combine" }),
        ],
      },
      attachTo: document.body,
    });
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");
    wrap.unmount();
  });

  it("filters by search term", async () => {
    const wrap = mount(BundleAddChildModal, {
      props: {
        visible: true,
        modules: [
          makeModule({ id: "m_a", name: "alpha", type: "wildcard" }),
          makeModule({ id: "m_b", name: "beta", type: "combine" }),
        ],
      },
      attachTo: document.body,
    });
    const search = document.body.querySelector('[data-test="bundle-add-search"]') as HTMLInputElement | null;
    expect(search).not.toBeNull();
    search!.value = "alpha";
    search!.dispatchEvent(new Event("input"));
    await wrap.vm.$nextTick();
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).not.toContain("beta");
    wrap.unmount();
  });

  it("emits pick with the chosen module", async () => {
    const wrap = mount(BundleAddChildModal, {
      props: {
        visible: true,
        modules: [makeModule({ id: "m_a", name: "alpha", type: "wildcard" })],
      },
      attachTo: document.body,
    });
    const row = document.body.querySelector('[data-test="bundle-add-row-m_a"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.click();
    const emitted = wrap.emitted("pick");
    expect(emitted).toBeTruthy();
    expect((emitted![0][0] as ModuleRow).id).toBe("m_a");
    wrap.unmount();
  });

  it("emits close when backdrop clicked", async () => {
    const wrap = mount(BundleAddChildModal, {
      props: { visible: true, modules: [] },
      attachTo: document.body,
    });
    const backdrop = document.body.querySelector('[data-test="bundle-add-backdrop"]') as HTMLElement | null;
    expect(backdrop).not.toBeNull();
    backdrop!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(wrap.emitted("close")).toBeTruthy();
    wrap.unmount();
  });

  // ── Tier-2 nesting: bundle tab ─────────────────────────────────────

  it("renders bundles in the all-tab list alongside modules", () => {
    const wrap = mount(BundleAddChildModal, {
      props: {
        visible: true,
        modules: [makeModule({ id: "m_a", name: "alpha" })],
        bundles: [makeBundle({ id: "b_a", name: "nested-bundle" })],
      },
      attachTo: document.body,
    });
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("nested-bundle");
    wrap.unmount();
  });

  it("Bundles tab hides modules + lists only the bundles", async () => {
    const wrap = mount(BundleAddChildModal, {
      props: {
        visible: true,
        modules: [makeModule({ id: "m_a", name: "should-hide" })],
        bundles: [makeBundle({ id: "b_a", name: "tier1-bundle" })],
      },
      attachTo: document.body,
    });
    const tab = document.body.querySelector('[data-test="bundle-add-tab-bundle"]') as HTMLElement | null;
    expect(tab).not.toBeNull();
    tab!.click();
    await wrap.vm.$nextTick();
    expect(document.body.textContent).toContain("tier1-bundle");
    expect(document.body.textContent).not.toContain("should-hide");
    wrap.unmount();
  });

  it("emits pick-bundle (not pick) when a bundle row is clicked", async () => {
    const wrap = mount(BundleAddChildModal, {
      props: {
        visible: true,
        modules: [],
        bundles: [makeBundle({ id: "b_a", name: "bundle-a" })],
      },
      attachTo: document.body,
    });
    const row = document.body.querySelector('[data-test="bundle-add-bundle-b_a"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    row!.click();
    expect(wrap.emitted("pick-bundle")).toBeTruthy();
    expect(wrap.emitted("pick")).toBeFalsy();
    expect((wrap.emitted("pick-bundle")![0][0] as BundleRow).id).toBe("b_a");
    wrap.unmount();
  });

  it("counts include bundles in the All tab badge but split them out in the Bundles tab", () => {
    const wrap = mount(BundleAddChildModal, {
      props: {
        visible: true,
        modules: [
          makeModule({ id: "m_a", name: "alpha" }),
          makeModule({ id: "m_b", name: "beta" }),
        ],
        bundles: [
          makeBundle({ id: "b_a", name: "ba" }),
          makeBundle({ id: "b_b", name: "bb" }),
        ],
      },
      attachTo: document.body,
    });
    const allTab = document.body.querySelector('[data-test="bundle-add-tab-all"]');
    const bundleTab = document.body.querySelector('[data-test="bundle-add-tab-bundle"]');
    expect(allTab?.textContent).toContain("4");   // 2 modules + 2 bundles
    expect(bundleTab?.textContent).toContain("2");
    wrap.unmount();
  });

  it("search filter applies to bundles", async () => {
    const wrap = mount(BundleAddChildModal, {
      props: {
        visible: true,
        modules: [],
        bundles: [
          makeBundle({ id: "b_a", name: "lighting" }),
          makeBundle({ id: "b_b", name: "subject" }),
        ],
      },
      attachTo: document.body,
    });
    const search = document.body.querySelector('[data-test="bundle-add-search"]') as HTMLInputElement;
    search.value = "light";
    search.dispatchEvent(new Event("input"));
    await wrap.vm.$nextTick();
    expect(document.body.textContent).toContain("lighting");
    expect(document.body.textContent).not.toContain("subject");
    wrap.unmount();
  });
});
