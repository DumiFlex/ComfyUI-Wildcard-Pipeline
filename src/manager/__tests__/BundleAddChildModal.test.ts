import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import BundleAddChildModal from "../components/BundleAddChildModal.vue";
import type { ModuleRow } from "../api/types";

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
});
