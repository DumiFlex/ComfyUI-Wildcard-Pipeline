import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const mockComposable = {
  dryRun: vi.fn(),
  apply: vi.fn(),
  undo: vi.fn(),
};

vi.mock("../useCascadeApply", () => ({
  useCascadeApply: () => mockComposable,
}));

import CascadeConfirmDialog from "../CascadeConfirmDialog.vue";

describe("CascadeConfirmDialog", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockComposable.dryRun.mockReset();
    mockComposable.apply.mockReset();
  });

  it("loads dry-run on open + displays affected entities", async () => {
    mockComposable.dryRun.mockResolvedValue({
      ok: true, affected_count: 2,
      affected_entities: [
        { kind: "constraint", id: "c1", name: "constraint A" },
        { kind: "constraint", id: "c2", name: "constraint B" },
      ],
    });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", action: "delete",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    expect(document.body.textContent).toContain("constraint A");
    expect(document.body.textContent).toContain("constraint B");
    wrap.unmount();
  });

  it("emits confirmed with undo_entry_id on confirm click", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    mockComposable.apply.mockResolvedValue({
      ok: true, undo_entry_id: "u1", affected_count: 0,
      affected_entities: [], diff: [],
    });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", action: "delete",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    const btn = document.body.querySelector("[data-test='cascade-confirm']") as HTMLButtonElement;
    btn.click();
    await flushPromises();
    expect(wrap.emitted("confirmed")).toBeTruthy();
    const event = wrap.emitted("confirmed")![0] as Array<{ undo_entry_id: string }>;
    expect(event[0].undo_entry_id).toBe("u1");
    wrap.unmount();
  });

  it("emits cancelled on backdrop click", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", action: "delete",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    // Now wraps Modal.vue, which exposes `.wp-modal__backdrop` with
    // `@mousedown.self` — clicking the backdrop dispatches mousedown
    // (mouseup → click won't bubble through the self modifier).
    const backdrop = document.body.querySelector(".wp-modal__backdrop") as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();
    expect(wrap.emitted("cancelled")).toBeTruthy();
    wrap.unmount();
  });

  it("surfaces apply error in dialog body", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    mockComposable.apply.mockResolvedValue({ ok: false, error: "boom" });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", action: "delete",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    const btn = document.body.querySelector("[data-test='cascade-confirm']") as HTMLButtonElement;
    btn.click();
    await flushPromises();
    expect(document.body.textContent).toMatch(/boom/i);
    expect(wrap.emitted("confirmed")).toBeFalsy();
    wrap.unmount();
  });

  it("button label adapts to action", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", action: "rename",
                extra: { subcat_name: "warm" }, newName: "hot" },
      attachTo: document.body,
    });
    await flushPromises();
    expect(document.body.textContent).toContain("Rename");
    wrap.unmount();
  });

  it("renders inside the shared Modal wrapper", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", action: "delete",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    // Modal.vue contract: `.wp-modal__backdrop` wraps `.wp-modal`,
    // header lives in `.wp-modal__head`, body slot in `.wp-modal__body`,
    // footer slot in `.wp-modal__foot`. Asserting these classes locks
    // the cascade dialog to the shared chrome.
    expect(document.body.querySelector(".wp-modal")).toBeTruthy();
    expect(document.body.querySelector(".wp-modal__head")?.textContent ?? "")
      .toContain("Confirm delete");
    expect(document.body.querySelector(".wp-modal__foot")).toBeTruthy();
    wrap.unmount();
  });
});
