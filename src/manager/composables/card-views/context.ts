/** The library lookups the card views use, from the stores. The store is
 *  read on first lookup, so a card with no category never needs one. */
import { useCategoryStore } from "../../stores/categoryStore";
import type { CardViewContext } from "./types";

export function useCardViewContext(): CardViewContext {
  let categories: ReturnType<typeof useCategoryStore> | null = null;
  return {
    category: (id) => {
      categories ??= useCategoryStore();
      const c = categories.items.find((x) => x.id === id);
      return c ? { name: c.name, color: c.color, icon: c.icon } : null;
    },
  };
}
