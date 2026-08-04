/**
 * Dropdown rows for picking a module or bundle out of the library.
 *
 * A dropdown built from `{ value: id, label: name }` is unusable the moment a
 * library holds two things with the same name — and real libraries do, because
 * "Lighting" is the obvious name for both the indoor and the outdoor pool.
 * Five identical lines, and the fields that tell them apart (payload, category,
 * uuid) have usually been projected away before the options are even built.
 *
 * The detail comes from `entitySubtitle`, the same function the Import and
 * Export pickers use, so a row reads identically wherever it is offered.
 *
 * Lives in a plain `.ts` rather than inline in the view because it is pure
 * data-to-data and the interesting behaviour — when a uuid appears — is worth
 * asserting directly rather than through a mounted component.
 */
import { entitySubtitle, type SubtitleModuleLike } from "../import-export/picker-subtitle";
import type { SelectOption } from "../components/ui/select-types";

/** The subset of `ModuleRow` / `BundleRow` this needs. Loose so both fit
 *  without a cast, and so a caller holding a lighter row still works. */
export interface EntityRowLike {
  id: string;
  name: string;
  category_id?: string | null;
  payload?: Record<string, unknown>;
  children?: unknown[] | null;
  template_string?: string | null;
}

/** Category lookup, keyed by id. Only the presentational fields matter. */
export interface CategoryLike {
  name: string;
  color?: string | null;
  icon?: string | null;
}

/** Names appearing more than once, lower-cased and trimmed for comparison —
 *  "Lighting" and "lighting " are the same name to a reader, so they are the
 *  same name here. */
export function duplicateNames(rows: readonly EntityRowLike[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    if (seen.has(key)) dupes.add(key);
    else seen.add(key);
  }
  return dupes;
}

/**
 * One `SelectOption` per row, carrying whatever distinguishes it.
 *
 * `meta` does double duty: `Select` renders it as the dim right-hand column
 * AND matches its type-to-filter query against it, so giving a row its uuid
 * also makes that row reachable by typing the uuid — which is how you get here
 * from an `@{uuid}` ref spotted in a template.
 *
 * The uuid is appended ONLY for names that are actually ambiguous, and always
 * last. Spending the width on every row would bury the readable detail under a
 * string nobody can pronounce, and putting it first would make it read as the
 * row's identity rather than as a tiebreaker.
 */
export function entitySelectOptions(
  rows: readonly EntityRowLike[],
  kind: string,
  categories: ReadonlyMap<string, CategoryLike>,
): SelectOption[] {
  const dupes = duplicateNames(rows);
  return rows.map((row) => {
    const cat = row.category_id ? categories.get(row.category_id) : undefined;
    const detail = entitySubtitle(kind, row as SubtitleModuleLike & EntityRowLike);
    const parts: string[] = [];
    if (cat) parts.push(cat.name);
    if (detail) parts.push(detail);
    if (dupes.has(row.name.trim().toLowerCase())) parts.push(`#${row.id.slice(0, 8)}`);
    return {
      value: row.id,
      label: row.name,
      dot: cat?.color || undefined,
      icon: cat?.icon || undefined,
      meta: parts.length > 0 ? parts.join(" · ") : undefined,
    };
  });
}
