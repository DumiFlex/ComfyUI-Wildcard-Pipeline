/**
 * Pure helpers for SortableList: move one item in a list, and work out where
 * a dragged row lands from the pointer and the rows' boxes.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.min(Math.max(0, to), out.length), 0, it);
  return out;
}

/**
 * The index the dragged row ends up at: the number of OTHER rows whose
 * middle is above the pointer. `mids` are the rows' vertical middles in
 * list order, the dragged row's included.
 */
export function dropIndex(y: number, mids: readonly number[], from: number): number {
  let n = 0;
  mids.forEach((m, i) => { if (i !== from && m < y) n++; });
  return n;
}
