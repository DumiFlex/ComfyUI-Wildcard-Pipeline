import { computed, ref, type ComputedRef, type Ref } from "vue";

/**
 * Generic multi-row selection for an editor's bulk mode (select + delete).
 *
 * The editor owns its rows; this owns only the "which ids are picked" state
 * plus the on/off `active` flag. Pass a `getIds` that returns the CURRENT
 * selectable row ids — every derived value reads through it, so selection
 * stays correct even as rows are added or removed (a deleted id simply stops
 * counting; no stale-id bookkeeping needed).
 *
 * Mirrors the hand-rolled selection in WildcardEditor so the three simpler
 * editors (fixed-values, constraint exceptions, derivation rules) share one
 * implementation instead of copying it three times.
 */
export interface BulkSelection {
  /** Bulk mode on/off. */
  active: Ref<boolean>;
  /** How many currently-present rows are selected. */
  count: ComputedRef<number>;
  /** True when every selectable row is selected (drives the header check). */
  allSelected: ComputedRef<boolean>;
  /** True when ≥1 (but maybe not all) rows are selected (indeterminate dash). */
  someSelected: ComputedRef<boolean>;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Select all when not all selected; otherwise clear. */
  toggleAll: () => void;
  clear: () => void;
  /** Enter/leave bulk mode; leaving clears the selection. */
  toggleMode: () => void;
  exit: () => void;
  /** The selected ids that still exist, for the delete handler. */
  selectedIds: () => string[];
}

/**
 * @param getIds        every selectable row, filtered or not. Drives `count`
 *                      and `selectedIds`, so a selection survives the user
 *                      changing the filter and still deletes what they picked.
 * @param getVisibleIds the rows currently ON SCREEN. Drives `allSelected`,
 *                      `someSelected` and `toggleAll`.
 *
 * The split exists because "select all" under an active filter must mean the
 * rows you can see. Scoping it to `getIds` instead means filtering a list of
 * 40 down to 3, clicking the header checkbox, and deleting all 40 — with 37 of
 * them never rendered. Defaults to `getIds` so an unfiltered list behaves
 * exactly as before.
 */
export function useBulkSelection(
  getIds: () => string[],
  getVisibleIds: () => string[] = getIds,
): BulkSelection {
  const active = ref(false);
  const selected = ref<Set<string>>(new Set());

  const count = computed(
    () => getIds().filter((id) => selected.value.has(id)).length,
  );
  const allSelected = computed(() => {
    const ids = getVisibleIds();
    return ids.length > 0 && ids.every((id) => selected.value.has(id));
  });
  const someSelected = computed(() =>
    getVisibleIds().some((id) => selected.value.has(id)),
  );

  function isSelected(id: string): boolean {
    return selected.value.has(id);
  }
  function toggle(id: string): void {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected.value = next;
  }
  /** Adds or removes ONLY the visible rows, so it never silently reaches a row
   *  the filter is hiding — in either direction. Without a filter,
   *  `getVisibleIds` is `getIds` and this is the original select-all/none. */
  function toggleAll(): void {
    const visible = getVisibleIds();
    const next = new Set(selected.value);
    if (allSelected.value) for (const id of visible) next.delete(id);
    else for (const id of visible) next.add(id);
    selected.value = next;
  }
  function clear(): void {
    selected.value = new Set();
  }
  function exit(): void {
    active.value = false;
    clear();
  }
  function toggleMode(): void {
    if (active.value) exit();
    else active.value = true;
  }
  function selectedIds(): string[] {
    return getIds().filter((id) => selected.value.has(id));
  }

  return {
    active,
    count,
    allSelected,
    someSelected,
    isSelected,
    toggle,
    toggleAll,
    clear,
    toggleMode,
    exit,
    selectedIds,
  };
}
