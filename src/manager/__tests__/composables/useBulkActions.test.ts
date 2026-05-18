import { describe, expect, it, beforeEach, vi } from "vitest";
import { useBulkActions } from "../../composables/useBulkActions";
import { useToast } from "../../composables/useToast";
import type { BulkAdapter, BulkResult } from "../../composables/bulkAdapters";

function makeResult(over: Partial<BulkResult> = {}): BulkResult {
  return { ok: over.ok ?? 0, failed: over.failed ?? 0, errors: over.errors ?? [] };
}

function makeAdapter(over: Partial<BulkAdapter> = {}): BulkAdapter {
  return {
    setFavorite: vi.fn().mockResolvedValue(makeResult({ ok: 1 })),
    duplicate:   vi.fn().mockResolvedValue({ ...makeResult({ ok: 1 }), created: ["new"] }),
    addTag:      vi.fn().mockResolvedValue(makeResult({ ok: 1 })),
    removeTag:   vi.fn().mockResolvedValue(makeResult({ ok: 1 })),
    setCategory: vi.fn().mockResolvedValue(makeResult({ ok: 1 })),
    delete:      vi.fn().mockResolvedValue(makeResult({ ok: 1 })),
    ...over,
  };
}

beforeEach(() => {
  // Clear toast singleton between tests.
  const { toasts } = useToast();
  toasts.value = [];
});

describe("useBulkActions", () => {
  it("favorite pushes success toast on full success with Undo action", async () => {
    const adapter = makeAdapter();
    const { onBulkFavorite } = useBulkActions(adapter);
    await onBulkFavorite([{ id: "a", is_favorite: false }] as never, true);
    const { toasts } = useToast();
    expect(toasts.value.length).toBe(1);
    expect(toasts.value[0].severity).toBe("success");
    expect(toasts.value[0].summary).toContain("Favorited");
    expect(toasts.value[0].action?.label).toBe("Undo");
  });

  it("favorite pushes warn toast on partial failure", async () => {
    const adapter = makeAdapter({
      setFavorite: vi.fn().mockResolvedValue(makeResult({ ok: 1, failed: 1 })),
    });
    const { onBulkFavorite } = useBulkActions(adapter);
    await onBulkFavorite([{ id: "a" }, { id: "b" }] as never, true);
    const { toasts } = useToast();
    expect(toasts.value[0].severity).toBe("warn");
    expect(toasts.value[0].summary).toContain("1 failed");
  });

  it("favorite undo reverses to prior per-item state", async () => {
    const adapter = makeAdapter();
    const { onBulkFavorite } = useBulkActions(adapter);
    const items = [{ id: "a", is_favorite: true }] as never;
    await onBulkFavorite(items, false);
    const { toasts } = useToast();
    await toasts.value[0].action!.run();
    // Two calls: original setFavorite(items, false), undo setFavorite(items, true) for the previously-true items.
    expect(adapter.setFavorite).toHaveBeenCalledTimes(2);
    expect(adapter.setFavorite).toHaveBeenNthCalledWith(2, items, true);
  });

  it("delete toast carries no Undo (destructive — undo not supported)", async () => {
    const adapter = makeAdapter();
    const { onBulkDelete } = useBulkActions(adapter);
    await onBulkDelete([{ id: "a", name: "A" }] as never);
    const { toasts } = useToast();
    expect(toasts.value[0].action).toBeUndefined();
  });

  it("tag-add undo removes the tag", async () => {
    const adapter = makeAdapter();
    const { onBulkTagAdd } = useBulkActions(adapter);
    const items = [{ id: "a", tags: [] }] as never;
    await onBulkTagAdd(items, "red");
    const { toasts } = useToast();
    await toasts.value[0].action!.run();
    expect(adapter.removeTag).toHaveBeenCalledWith(items, "red");
  });

  it("set-category undo restores per-item snapshot of prior category_id (one call per distinct value)", async () => {
    const adapter = makeAdapter();
    const { onBulkSetCategory } = useBulkActions(adapter);
    const items = [
      { id: "a", category_id: "c1" },
      { id: "b", category_id: null },
    ] as never;
    await onBulkSetCategory(items, "c2");
    const { toasts } = useToast();
    await toasts.value[0].action!.run();
    // Calls: 1 original + 2 undo (one per distinct prior value).
    expect(adapter.setCategory).toHaveBeenCalledTimes(3);
  });
});
