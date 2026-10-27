/**
 * Old → new building blocks for the chat's change cards
 * (`composables/card-views/`): a list matched up by id, a set of tags
 * split into kept / added / dropped, and option weights as shares.
 *
 * Pure and DOM-free; the views colour what these return the same way
 * everywhere (`components/ai/views/card-diff.css`).
 */

/** What happened to one part of an item. */
export type Change = "added" | "removed" | "changed" | "same";

export interface ListDiffRow<T> {
  change: Change;
  /** The part as it will be (as it was, for a removed one). */
  now: T;
  /** The part as it was; null for an added one. */
  was: T | null;
}

/**
 * Two lists matched up by `key`, in the new order, with each removed part
 * put back where it stood (after the part it followed before).
 */
export function diffList<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b),
): ListDiffRow<T>[] {
  const old = new Map(before.map((b) => [key(b), b]));
  const kept = new Set(after.map(key));
  const rows: ListDiffRow<T>[] = after.map((now) => {
    const was = old.get(key(now)) ?? null;
    if (!was) return { change: "added", now, was: null };
    return { change: same(was, now) ? "same" : "changed", now, was };
  });
  // Removed parts go back in after the part they followed.
  let at = 0;
  before.forEach((b) => {
    const k = key(b);
    if (kept.has(k)) {
      const i = rows.findIndex((r) => r.was !== null && key(r.was) === k);
      if (i >= 0) at = i + 1;
      return;
    }
    rows.splice(at, 0, { change: "removed", now: b, was: b });
    at += 1;
  });
  return rows;
}

export interface TagDiff {
  tag: string;
  change: "added" | "removed" | "same";
}

/** Tags old → new, kept ones first in their order, then the added ones;
 *  dropped ones stay where they were, marked. */
export function diffTags(before: readonly string[], after: readonly string[]): TagDiff[] {
  const now = new Set(after);
  const had = new Set(before);
  return [
    ...before.map((tag): TagDiff => ({ tag, change: now.has(tag) ? "same" : "removed" })),
    ...after.filter((t) => !had.has(t)).map((tag): TagDiff => ({ tag, change: "added" })),
  ];
}

/** Whether a tag diff changes anything. */
export function tagsChanged(d: readonly TagDiff[]): boolean {
  return d.some((t) => t.change !== "same");
}

/** Each weight as its share of the total, 0–100 (the editor's numbers:
 *  `WildcardEditor.probabilityFor`). */
export function shares(weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + (Number.isFinite(w) && w > 0 ? w : 0), 0);
  return weights.map((w) => (sum > 0 && Number.isFinite(w) && w > 0 ? (w / sum) * 100 : 0));
}
