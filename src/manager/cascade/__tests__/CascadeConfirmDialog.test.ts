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

  it("wildcard delete: constraint row is informational (no checkbox), nested-ref row has an unchecked strip checkbox", async () => {
    mockComposable.dryRun.mockResolvedValue({
      ok: true, affected_count: 2,
      affected_entities: [
        { kind: "constraint", id: "c1", name: "constraint A" },
        { kind: "wildcard", id: "w2", name: "nested wildcard" },
      ],
    });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "wildcard", id: "w1", action: "delete" },
      attachTo: document.body,
    });
    await flushPromises();

    // Constraint → informational, NO strip checkbox for its id.
    expect(document.body.querySelector("[data-test='cascade-keep-constraint']")).toBeTruthy();
    expect(document.body.querySelector("[data-test='cascade-strip'][data-test-id='c1']")).toBeFalsy();
    expect(document.body.textContent).toMatch(/reattach to heal/i);

    // Nested-ref wildcard → strip checkbox, present + defaulting unchecked.
    const stripBtn = document.body.querySelector(
      "[data-test='cascade-strip'][data-test-id='w2'] [role='checkbox']",
    ) as HTMLButtonElement | null;
    expect(stripBtn).toBeTruthy();
    expect(stripBtn!.getAttribute("aria-checked")).toBe("false");

    // The single legacy "Update N references" checkbox must NOT render for wildcard delete.
    expect(document.body.querySelector("[data-test='cascade-cleanup-checkbox']")).toBeFalsy();

    wrap.unmount();
  });

  it("wildcard delete: checking a nested-ref row sends cleanup_ids with that id only (not the constraint)", async () => {
    mockComposable.dryRun.mockResolvedValue({
      ok: true, affected_count: 2,
      affected_entities: [
        { kind: "constraint", id: "c1", name: "constraint A" },
        { kind: "wildcard", id: "w2", name: "nested wildcard" },
      ],
    });
    mockComposable.apply.mockResolvedValue({
      ok: true, undo_entry_id: "u1", affected_count: 1, affected_entities: [], diff: [],
    });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "wildcard", id: "w1", action: "delete" },
      attachTo: document.body,
    });
    await flushPromises();

    // Check the nested-ref wildcard's strip box.
    const stripBtn = document.body.querySelector(
      "[data-test='cascade-strip'][data-test-id='w2'] [role='checkbox']",
    ) as HTMLButtonElement;
    stripBtn.click();
    await flushPromises();

    const confirm = document.body.querySelector("[data-test='cascade-confirm']") as HTMLButtonElement;
    confirm.click();
    await flushPromises();

    expect(mockComposable.apply).toHaveBeenCalledTimes(1);
    const sent = mockComposable.apply.mock.calls[0][0] as { cleanup_ids?: string[] };
    expect(sent.cleanup_ids).toContain("w2");
    expect(sent.cleanup_ids).not.toContain("c1");
    wrap.unmount();
  });

  it("non-wildcard delete still renders the single cascade_refs checkbox + sends cascade_refs", async () => {
    mockComposable.dryRun.mockResolvedValue({
      ok: true, affected_count: 1,
      affected_entities: [{ kind: "bundle", id: "b2", name: "parent bundle" }],
    });
    mockComposable.apply.mockResolvedValue({
      ok: true, undo_entry_id: "u1", affected_count: 1, affected_entities: [], diff: [],
    });
    const wrap = mount(CascadeConfirmDialog, {
      props: { open: true, kind: "bundle", id: "b1", action: "delete" },
      attachTo: document.body,
    });
    await flushPromises();

    // The single legacy checkbox renders for bundle delete…
    expect(document.body.querySelector("[data-test='cascade-cleanup-checkbox']")).toBeTruthy();
    // …and no per-row strip checkboxes appear.
    expect(document.body.querySelector("[data-test='cascade-strip']")).toBeFalsy();

    const confirm = document.body.querySelector("[data-test='cascade-confirm']") as HTMLButtonElement;
    confirm.click();
    await flushPromises();

    const sent = mockComposable.apply.mock.calls[0][0] as { cascade_refs?: boolean; cleanup_ids?: string[] };
    expect(sent.cascade_refs).toBe(true);
    expect(sent.cleanup_ids).toBeUndefined();
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
