/**
 * Filtering and reordering for a wildcard's option list (and Fixed Values,
 * which shares the move half).
 *
 * Pure data-to-data, kept out of the 2.4k-line editor that hosts it: the
 * interesting behaviour here is ordering arithmetic and set logic, both of
 * which are worth asserting directly rather than through a mounted component.
 */

/** The subset of an option row these functions need. */
export interface OptionLike {
  id: string;
  value?: string;
  sub_categories?: string[] | null;
  is_null?: boolean;
}

/* ------------------------------------------------------------------ filter */

export interface OptionFilter {
  /** Case-insensitive substring, matched against the option's value. */
  query: string;
  /** Tags that must ALL be present. Empty = no tag constraint. */
  tags: readonly string[];
}

export function filterIsActive(f: OptionFilter): boolean {
  return f.query.trim().length > 0 || f.tags.length > 0;
}

/**
 * Does this option survive the filter?
 *
 * Text and tags are ANDed, and multiple tags are ANDed with each other —
 * "red" plus "warm" means options carrying both. That is the narrowing
 * direction people expect from adding a second filter; OR would widen the
 * result as you add constraints, which reads as the control being broken.
 *
 * The null option carries no value and no tags, so any active filter excludes
 * it. That is correct — it cannot match — and it is also why moves have to
 * treat it separately (see `moveSelected`).
 */
export function optionMatches(o: OptionLike, f: OptionFilter): boolean {
  const q = f.query.trim().toLowerCase();
  if (q && !(o.value ?? "").toLowerCase().includes(q)) return false;
  if (f.tags.length > 0) {
    const own = new Set(o.sub_categories ?? []);
    for (const t of f.tags) if (!own.has(t)) return false;
  }
  return true;
}

/* -------------------------------------------------------------- tag hoisting */

export interface VisibleTags {
  /** Tags to render, matched ones first. */
  visible: string[];
  /** How many are folded behind the `+N` pill. */
  hiddenCount: number;
  /** True when at least one FOLDED tag satisfies the filter — the pill has to
   *  say so, or the row looks like it matched for no reason. */
  hiddenHasMatch: boolean;
}

/**
 * Choose which tags to show, promoting the ones the filter matched.
 *
 * A row shows only the first few tags and folds the rest behind `+N`. Filter
 * by a tag that happens to sit in the folded remainder and the row appears
 * with no visible reason for being there — the evidence is hidden behind the
 * very pill that says "there is more".
 *
 * Tags are a SET, so their display order carries no meaning and promoting the
 * matched ones costs nothing. That is why this is a reorder rather than an
 * auto-expand: expanding reflows every matching row at once, which is a large
 * price for a small clarification, and it defeats the fold the moment a filter
 * is broad.
 */
export function visibleTagsFor(
  all: readonly string[],
  matched: ReadonlySet<string>,
  limit: number,
  expanded: boolean,
): VisibleTags {
  if (expanded || all.length <= limit) {
    return { visible: [...all], hiddenCount: 0, hiddenHasMatch: false };
  }
  if (matched.size === 0) {
    return {
      visible: all.slice(0, limit),
      hiddenCount: all.length - limit,
      hiddenHasMatch: false,
    };
  }
  // Stable partition: matched keep their relative order, so do the rest.
  const hit = all.filter((t) => matched.has(t));
  const rest = all.filter((t) => !matched.has(t));
  const visible = [...hit, ...rest].slice(0, limit);
  const shown = new Set(visible);
  return {
    visible,
    hiddenCount: all.length - visible.length,
    hiddenHasMatch: hit.some((t) => !shown.has(t)),
  };
}

/* ---------------------------------------------------------------- reordering */

export type MoveTarget =
  | { to: "top" }
  | { to: "bottom" }
  /** Insert immediately BEFORE this row id. */
  | { to: "before"; id: string };

/**
 * Move every selected row to one destination, as a single block.
 *
 * A scattered selection collapses into a contiguous run in the relative order
 * it already had — rows 3, 47 and 99 sent to the top land as 1, 2, 3. There is
 * no other coherent answer, but it does surprise the first time, so callers
 * should report what happened rather than let it be discovered.
 *
 * The null option never moves. `hoistNullFirst` re-pins it to index 0 on every
 * save, so any move it took part in would silently undo itself; it is filtered
 * out of the cargo and left where it is, and it is never a valid landing point.
 *
 * Returns a NEW array; the input is untouched.
 */
export function moveSelected<T extends OptionLike>(
  list: readonly T[],
  selectedIds: ReadonlySet<string>,
  target: MoveTarget,
): T[] {
  const movable = list.filter((o) => selectedIds.has(o.id) && !o.is_null);
  if (movable.length === 0) return [...list];
  const moving = new Set(movable.map((o) => o.id));
  const rest = list.filter((o) => !moving.has(o.id));

  if (target.to === "top") {
    // Anything pinned (the null option) stays ahead of the arriving block.
    const pinned = rest.filter((o) => o.is_null);
    const others = rest.filter((o) => !o.is_null);
    return [...pinned, ...movable, ...others];
  }
  if (target.to === "bottom") return [...rest, ...movable];

  // Land before a specific row. If that row is itself part of the cargo the
  // request is meaningless, so nothing moves rather than guessing.
  if (moving.has(target.id)) return [...list];
  const at = rest.findIndex((o) => o.id === target.id);
  if (at < 0) return [...list];
  return [...rest.slice(0, at), ...movable, ...rest.slice(at)];
}

/**
 * Nudge a single row one step up or down.
 *
 * The keyboard path, and the only reordering that stays usable in a list of a
 * hundred-plus rows where dragging means an auto-scroll fight. Steps over the
 * pinned null option rather than swapping with it.
 */
export function nudge<T extends OptionLike>(
  list: readonly T[],
  id: string,
  dir: -1 | 1,
): T[] {
  const from = list.findIndex((o) => o.id === id);
  if (from < 0 || list[from].is_null) return [...list];
  let to = from + dir;
  while (to >= 0 && to < list.length && list[to].is_null) to += dir;
  if (to < 0 || to >= list.length) return [...list];
  const out = [...list];
  const [row] = out.splice(from, 1);
  out.splice(to, 0, row);
  return out;
}
