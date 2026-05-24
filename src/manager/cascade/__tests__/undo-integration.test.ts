import { describe, expect, it, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const apiMock = vi.hoisted(() => ({
  cascade_undo: vi.fn(),
}));

vi.mock("../../api/client", () => ({ api: apiMock }));

import { registerCascadeUndo } from "../undo-stack-integration";
import { useCascadeStore } from "../cascade-store";

describe("registerCascadeUndo", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiMock.cascade_undo.mockReset();
  });

  it("returns a handle with undo_entry_id + label + undo function", () => {
    const h = registerCascadeUndo("u1", "Deleted X");
    expect(h.undo_entry_id).toBe("u1");
    expect(h.label).toBe("Deleted X");
    expect(typeof h.undo).toBe("function");
  });

  it("undo handle posts to api.cascade_undo with stored id", async () => {
    apiMock.cascade_undo.mockResolvedValue({ ok: true });
    const h = registerCascadeUndo("u1", "Deleted X");
    const result = await h.undo();
    expect(apiMock.cascade_undo).toHaveBeenCalledWith("u1");
    expect(result.ok).toBe(true);
  });

  it("undo handle invalidates cascade store on success", async () => {
    apiMock.cascade_undo.mockResolvedValue({ ok: true });
    const store = useCascadeStore();
    // Rebuild with a tiny fixture so we can verify invalidation toggles isStale.
    store.rebuild({
      wildcards: [], fixed_values: [], combines: [], derivations: [],
      constraints: [], bundles: [], categories: [],
    });
    expect(store.isStale).toBe(false);
    const h = registerCascadeUndo("u1", "label");
    await h.undo();
    expect(store.isStale).toBe(true);
  });

  it("undo handle propagates error on failure", async () => {
    apiMock.cascade_undo.mockResolvedValue({ ok: false, error: "boom" });
    const h = registerCascadeUndo("u1", "label");
    const result = await h.undo();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});
