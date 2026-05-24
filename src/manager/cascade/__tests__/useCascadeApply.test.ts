import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.hoisted(() => ({
  cascade_apply: vi.fn(),
  cascade_undo: vi.fn(),
}));

vi.mock("../../api/client", () => ({ api: apiMock }));

import { useCascadeApply } from "../useCascadeApply";
import { useCascadeStore } from "../cascade-store";

describe("useCascadeApply", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.cascade_apply.mockReset();
    apiMock.cascade_undo.mockReset();
  });

  it("dryRun POSTs with dry_run: true", async () => {
    apiMock.cascade_apply.mockResolvedValue({
      ok: true, affected_count: 2,
      affected_entities: [{ kind: "constraint", id: "c1", name: "c" }, { kind: "constraint", id: "c2", name: "d" }],
    });
    const m = useCascadeApply();
    const result = await m.dryRun({ kind: "wildcard", id: "11111111", action: "delete" });
    expect(result.ok).toBe(true);
    expect(apiMock.cascade_apply).toHaveBeenCalledWith(expect.objectContaining({
      kind: "wildcard", id: "11111111", action: "delete", dry_run: true,
    }));
  });

  it("apply POSTs without dry_run and patches store on success", async () => {
    apiMock.cascade_apply.mockResolvedValue({
      ok: true, undo_entry_id: "u1",
      affected_count: 1, affected_entities: [{ kind: "constraint", id: "c1", name: "c" }],
      diff: [{ entity_id: "c1", removed: true }],
    });
    const store = useCascadeStore();
    const applyDiffSpy = vi.spyOn(store, "applyDiff");
    const m = useCascadeApply();
    const result = await m.apply({ kind: "wildcard", id: "11111111", action: "delete" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.undo_entry_id).toBe("u1");
    }
    expect(applyDiffSpy).toHaveBeenCalledWith([{ entity_id: "c1", removed: true }]);
  });

  it("apply does not patch store on failure", async () => {
    apiMock.cascade_apply.mockResolvedValue({ ok: false, error: "boom" });
    const store = useCascadeStore();
    const applyDiffSpy = vi.spyOn(store, "applyDiff");
    const m = useCascadeApply();
    const result = await m.apply({ kind: "wildcard", id: "11111111", action: "delete" });
    expect(result.ok).toBe(false);
    expect(applyDiffSpy).not.toHaveBeenCalled();
  });

  it("undo POSTs and invalidates store on success", async () => {
    apiMock.cascade_undo.mockResolvedValue({ ok: true });
    const store = useCascadeStore();
    const invalidateSpy = vi.spyOn(store, "invalidate");
    const m = useCascadeApply();
    const result = await m.undo("u1");
    expect(result.ok).toBe(true);
    expect(apiMock.cascade_undo).toHaveBeenCalledWith("u1");
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("opt-out rename surfaces broken_refs in response", async () => {
    apiMock.cascade_apply.mockResolvedValue({
      ok: true, undo_entry_id: "u2", affected_count: 0,
      broken_refs: [{ kind: "constraint", id: "c1", name: "c" }],
    });
    const m = useCascadeApply();
    const result = await m.apply({
      kind: "subcategory", id: "11111111", action: "rename",
      cascade_refs: false, new_name: "hot",
      extra: { subcat_name: "warm" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.broken_refs).toHaveLength(1);
    }
  });
});
