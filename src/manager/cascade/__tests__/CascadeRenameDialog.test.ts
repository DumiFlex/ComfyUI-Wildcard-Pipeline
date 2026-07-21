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

import CascadeRenameDialog from "../CascadeRenameDialog.vue";

describe("CascadeRenameDialog", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockComposable.dryRun.mockReset();
    mockComposable.apply.mockReset();
  });

  // Cascade toggle is now the shared Checkbox component:
  // `<button role="checkbox" class="wp-check">` with `aria-checked`.
  function findToggle(): HTMLButtonElement | null {
    return document.body.querySelector("button.wp-check") as HTMLButtonElement | null;
  }

  // Name input — Input.vue defaults to type="text", so the underlying
  // native input still matches. Scope to the body slot to avoid grabbing
  // any other text inputs the modal might wrap later.
  function findNameInput(): HTMLInputElement | null {
    return document.body.querySelector(".wp-modal__body input.wp-input, .wp-modal__body input[type='text']") as HTMLInputElement | null;
  }

  it("toggle defaults to checked when affected list non-empty", async () => {
    mockComposable.dryRun.mockResolvedValue({
      ok: true, affected_count: 2,
      affected_entities: [
        { kind: "constraint", id: "c1", name: "A" },
        { kind: "constraint", id: "c2", name: "B" },
      ],
    });
    const wrap = mount(CascadeRenameDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", initialName: "warm",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    const cb = findToggle();
    expect(cb).toBeTruthy();
    expect(cb!.getAttribute("aria-checked")).toBe("true");
    wrap.unmount();
  });

  it("hides toggle when no affected refs", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    const wrap = mount(CascadeRenameDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", initialName: "warm",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    expect(findToggle()).toBeNull();
    wrap.unmount();
  });

  it("opt-out (toggle unchecked) emits confirmed with broken_refs", async () => {
    mockComposable.dryRun.mockResolvedValue({
      ok: true, affected_count: 2,
      affected_entities: [
        { kind: "constraint", id: "c1", name: "A" },
        { kind: "constraint", id: "c2", name: "B" },
      ],
    });
    mockComposable.apply.mockImplementation(async (req) => {
      if (req.cascade_refs === false) {
        return {
          ok: true, undo_entry_id: "u2", affected_count: 0,
          broken_refs: [{ kind: "constraint", id: "c1", name: "A" }],
        };
      }
      return { ok: true, undo_entry_id: "u1", affected_count: 2, diff: [] };
    });
    const wrap = mount(CascadeRenameDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", initialName: "warm",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    // Uncheck the cascade toggle (Checkbox component button).
    findToggle()!.click();
    await flushPromises();
    // Update name via the native input inside Input.vue.
    const input = findNameInput();
    input!.value = "hot";
    input!.dispatchEvent(new Event("input"));
    await flushPromises();
    const btn = document.body.querySelector("[data-test='cascade-rename-confirm']") as HTMLButtonElement;
    btn.click();
    await flushPromises();
    const events = wrap.emitted("confirmed") ?? [];
    expect(events).toHaveLength(1);
    const result = events[0]![0] as { undo_entry_id: string; broken_refs?: Array<unknown> };
    expect(result.undo_entry_id).toBe("u2");
    expect(result.broken_refs).toHaveLength(1);
    wrap.unmount();
  });

  it("cascade-on (toggle checked) emits confirmed without broken_refs", async () => {
    mockComposable.dryRun.mockResolvedValue({
      ok: true, affected_count: 1,
      affected_entities: [{ kind: "constraint", id: "c1", name: "A" }],
    });
    mockComposable.apply.mockResolvedValue({
      ok: true, undo_entry_id: "u1", affected_count: 1,
      affected_entities: [{ kind: "constraint", id: "c1", name: "A" }],
      diff: [],
    });
    const wrap = mount(CascadeRenameDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", initialName: "warm",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    const input = findNameInput();
    input!.value = "hot";
    input!.dispatchEvent(new Event("input"));
    await flushPromises();
    const btn = document.body.querySelector("[data-test='cascade-rename-confirm']") as HTMLButtonElement;
    btn.click();
    await flushPromises();
    const events = wrap.emitted("confirmed") ?? [];
    expect(events).toHaveLength(1);
    const result = events[0]![0] as { undo_entry_id: string; broken_refs?: Array<unknown> };
    expect(result.undo_entry_id).toBe("u1");
    expect(result.broken_refs).toBeUndefined();
    wrap.unmount();
  });

  it("blocks a subcategory rename to a name containing a space (issue #7)", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    const wrap = mount(CascadeRenameDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", initialName: "warm",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    const input = findNameInput();
    input!.value = "warm tone"; // contains a space — invalid subcat name
    input!.dispatchEvent(new Event("input"));
    await flushPromises();
    // Validation error is surfaced.
    const err = document.body.querySelector(".wp-cascade-rename__error");
    expect(err?.textContent ?? "").toContain("whitespace");
    // Confirm is disabled and clicking it does not apply the rename.
    const btn = document.body.querySelector("[data-test='cascade-rename-confirm']") as HTMLButtonElement;
    expect(btn.disabled || btn.getAttribute("aria-disabled") === "true").toBe(true);
    btn.click();
    await flushPromises();
    expect(mockComposable.apply).not.toHaveBeenCalled();
    wrap.unmount();
  });

  it("blocks a combine output-var rename to a non-identifier name", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    const wrap = mount(CascadeRenameDialog, {
      props: { open: true, kind: "combine_output_var", id: "22222222", initialName: "outfit",
                extra: { old_name: "outfit" } },
      attachTo: document.body,
    });
    await flushPromises();
    const input = findNameInput();
    input!.value = "out fit"; // space — invalid $identifier
    input!.dispatchEvent(new Event("input"));
    await flushPromises();
    const err = document.body.querySelector(".wp-cascade-rename__error");
    expect(err?.textContent ?? "").toContain("letters, digits");
    const btn = document.body.querySelector("[data-test='cascade-rename-confirm']") as HTMLButtonElement;
    expect(btn.disabled || btn.getAttribute("aria-disabled") === "true").toBe(true);
    btn.click();
    await flushPromises();
    expect(mockComposable.apply).not.toHaveBeenCalled();
    wrap.unmount();
  });

  it("rename button disabled when name empty", async () => {
    mockComposable.dryRun.mockResolvedValue({ ok: true, affected_count: 0, affected_entities: [] });
    const wrap = mount(CascadeRenameDialog, {
      props: { open: true, kind: "subcategory", id: "11111111", initialName: "",
                extra: { subcat_name: "warm" } },
      attachTo: document.body,
    });
    await flushPromises();
    // Button.vue renders the disabled state via aria-disabled +
    // pointer-events-none rather than the native `disabled` prop in
    // every variant — check both.
    const btn = document.body.querySelector("[data-test='cascade-rename-confirm']") as HTMLButtonElement;
    const isDisabled = btn.disabled || btn.getAttribute("aria-disabled") === "true";
    expect(isDisabled).toBe(true);
    wrap.unmount();
  });
});
