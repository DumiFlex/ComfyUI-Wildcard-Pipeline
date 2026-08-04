/**
 * Category dropdown options.
 *
 * Every list view builds the same two dropdowns — a "filter by category" one
 * and a "bulk set category" one — and they had drifted into thirteen
 * hand-copied `categoryStore.items.map(...)` expressions across nine files.
 * Adding the icon to each of them by hand is exactly the edit that leaves one
 * behind, so the mapping lives here now.
 *
 * The two dropdowns differ only in what the null choice reads as: filters say
 * "All categories" (null = no filter), bulk-set says "(none)" (null = clear
 * the category). That is the only parameter.
 */
import type { CategoryRow } from "../api/types";
import type { SelectOption } from "../components/ui/select-types";

/** Category rows as the store holds them. Typed loosely so callers can pass
 *  the store's items without a cast, and so a caller holding a lighter row
 *  (id/name/color/icon only) still fits. */
type CategoryLike = Pick<CategoryRow, "id" | "name" | "color" | "icon">;

/**
 * One option per category, prefixed by the null choice.
 *
 * `icon` wins over `dot` in Select's rendering; passing both means a category
 * with an icon shows the glyph tinted with its colour, and one without falls
 * back to the colour dot exactly as before.
 */
export function categorySelectOptions(
  items: readonly CategoryLike[],
  nullLabel: string,
): SelectOption[] {
  return [
    { value: null, label: nullLabel },
    ...items.map((c) => ({
      value: c.id,
      label: c.name,
      dot: c.color || undefined,
      icon: c.icon || undefined,
    })),
  ];
}

/** Filter dropdown — null means "don't filter". */
export function categoryFilterOptions(items: readonly CategoryLike[]): SelectOption[] {
  return categorySelectOptions(items, "All categories");
}

/** Bulk-assign dropdown — null means "clear the category". */
export function categoryAssignOptions(items: readonly CategoryLike[]): SelectOption[] {
  return categorySelectOptions(items, "(none)");
}
