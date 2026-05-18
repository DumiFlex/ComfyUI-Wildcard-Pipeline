import { useToast, type ToastSeverity } from "./useToast";
import type { BulkAdapter, AnyRow, BulkResult } from "./bulkAdapters";

interface CategorySnapshot { id: string; prevCategoryId: string | null; }

const UNDO_TOAST_LIFE = 5000;

function severityFor(res: BulkResult): ToastSeverity {
  if (res.failed === 0) return "success";
  if (res.ok === 0) return "error";
  return "warn";
}

function summary(verb: string, res: BulkResult): string {
  const total = res.ok + res.failed;
  if (res.failed === 0) return `${verb} ${res.ok} of ${total}`;
  return `${verb} ${res.ok} of ${total} — ${res.failed} failed`;
}

export function useBulkActions(adapter: BulkAdapter) {
  const toast = useToast();

  function reportUndoFailure(results: BulkResult[]): void {
    const failed = results.reduce((n, r) => n + r.failed, 0);
    if (failed === 0) return;
    toast.push({
      severity: "error",
      summary: `Undo failed for ${failed} item${failed === 1 ? "" : "s"}`,
      detail: results.flatMap((r) => r.errors.map((e) => e.reason)).join("; "),
      life: UNDO_TOAST_LIFE,
    });
  }

  async function onBulkFavorite(items: AnyRow[], on: boolean): Promise<void> {
    const snapshot = items.map((i) => ({ id: i.id, was: Boolean(i.is_favorite) }));
    const res = await adapter.setFavorite(items, on);
    toast.push({
      severity: severityFor(res),
      summary: summary(on ? "Favorited" : "Unfavorited", res),
      detail: res.failed ? res.errors.map((e) => e.reason).join("; ") : undefined,
      life: UNDO_TOAST_LIFE,
      action: {
        label: "Undo",
        run: async () => {
          // Reverse: each item back to its prior state via two grouped calls.
          const toEnable = items.filter((_, idx) => snapshot[idx].was);
          const toDisable = items.filter((_, idx) => !snapshot[idx].was);
          const results: BulkResult[] = [];
          if (toEnable.length) results.push(await adapter.setFavorite(toEnable, true));
          if (toDisable.length) results.push(await adapter.setFavorite(toDisable, false));
          reportUndoFailure(results);
        },
      },
    });
  }

  async function onBulkDuplicate(items: AnyRow[]): Promise<void> {
    const res = await adapter.duplicate(items);
    toast.push({
      severity: severityFor(res),
      summary: summary("Duplicated", res),
      detail: res.failed ? res.errors.map((e) => e.reason).join("; ") : undefined,
      life: UNDO_TOAST_LIFE,
      action: res.created.length
        ? {
            label: "Undo",
            run: async () => {
              // Delete the freshly-created copies.
              const newRows = res.created.map((id) => ({ id } as AnyRow));
              const result = await adapter.delete(newRows);
              reportUndoFailure([result]);
            },
          }
        : undefined,
    });
  }

  async function onBulkTagAdd(items: AnyRow[], tag: string): Promise<void> {
    const res = await adapter.addTag(items, tag);
    toast.push({
      severity: severityFor(res),
      summary: summary("Tagged", res),
      detail: tag,
      life: UNDO_TOAST_LIFE,
      action: {
        label: "Undo",
        run: async () => {
          const result = await adapter.removeTag(items, tag);
          reportUndoFailure([result]);
        },
      },
    });
  }

  async function onBulkTagRemove(items: AnyRow[], tag: string): Promise<void> {
    const res = await adapter.removeTag(items, tag);
    toast.push({
      severity: severityFor(res),
      summary: summary("Untagged", res),
      detail: tag,
      life: UNDO_TOAST_LIFE,
      action: {
        label: "Undo",
        run: async () => {
          const result = await adapter.addTag(items, tag);
          reportUndoFailure([result]);
        },
      },
    });
  }

  async function onBulkSetCategory(items: AnyRow[], categoryId: string | null): Promise<void> {
    const snapshot: CategorySnapshot[] = items.map((i) => ({
      id: i.id,
      prevCategoryId: "category_id" in i ? i.category_id ?? null : null,
    }));
    const res = await adapter.setCategory(items, categoryId);
    toast.push({
      severity: severityFor(res),
      summary: summary("Categorized", res),
      detail: res.failed ? res.errors.map((e) => e.reason).join("; ") : undefined,
      life: UNDO_TOAST_LIFE,
      action: {
        label: "Undo",
        run: async () => {
          // Group by previous category_id; one call per distinct value.
          const groups = new Map<string | null, AnyRow[]>();
          for (let i = 0; i < items.length; i += 1) {
            const prev = snapshot[i].prevCategoryId;
            if (!groups.has(prev)) groups.set(prev, []);
            groups.get(prev)!.push(items[i]);
          }
          const results: BulkResult[] = [];
          for (const [prev, group] of groups) {
            results.push(await adapter.setCategory(group, prev));
          }
          reportUndoFailure(results);
        },
      },
    });
  }

  async function onBulkDelete(items: AnyRow[]): Promise<void> {
    const res = await adapter.delete(items);
    toast.push({
      severity: severityFor(res),
      summary: summary("Deleted", res),
      detail: res.failed ? res.errors.map((e) => e.reason).join("; ") : undefined,
      life: UNDO_TOAST_LIFE,
      // No undo — delete is destructive. Users must re-create from scratch.
    });
  }

  return {
    onBulkFavorite,
    onBulkDuplicate,
    onBulkTagAdd,
    onBulkTagRemove,
    onBulkSetCategory,
    onBulkDelete,
  };
}
