import { computed, ref } from "vue";

/**
 * Shared delete-confirm gating for list views.
 *
 * Pre-existing flow: list views called `store.remove(id)` immediately on
 * trash-icon click. With no dependencies an accidental click would lose
 * data — only the cascade-confirm path (which is gated behind "has
 * downstream refs") prompted the user. This composable normalizes the
 * no-refs path: hold the row in a `pending` ref, surface a
 * `<ConfirmDialog>` bound to `visible`, run the actual delete on
 * confirm.
 *
 * Usage:
 *   const delConfirm = useDeleteConfirm<ModuleRow>();
 *   // in del() handler, replace `await store.remove(row.id)` with:
 *   delConfirm.ask(row);
 *   // in template:
 *   <ConfirmDialog
 *     :visible="delConfirm.visible.value"
 *     :title="`Delete \"${delConfirm.pending.value?.name ?? ''}\"?`"
 *     body="This permanently removes the library entry."
 *     confirm-label="Delete"
 *     variant="danger"
 *     @confirm="delConfirm.confirm(performDelete)"
 *     @cancel="delConfirm.cancel"
 *   />
 *   // where `performDelete(row: ModuleRow)` does the actual work.
 *
 * Generic so consumers can carry whatever row shape they need (BundleRow,
 * CategoryRow, ModuleRow…) without losing field access in the handler.
 */
export function useDeleteConfirm<T>() {
  const pending = ref<T | null>(null);
  const visible = computed<boolean>(() => pending.value !== null);

  function ask(row: T): void {
    pending.value = row;
  }
  function cancel(): void {
    pending.value = null;
  }
  /** Run `fn` with the held row and clear `pending`. Caller's function
   *  may be async; we await before clearing so a UI listener can still
   *  read the row name while the request is in flight. */
  async function confirm(fn: (row: T) => unknown | Promise<unknown>): Promise<void> {
    const row = pending.value;
    if (!row) return;
    try {
      await fn(row);
    } finally {
      pending.value = null;
    }
  }

  return { pending, visible, ask, cancel, confirm };
}
