import type { CommandItem } from "../components/CommandPalette.types";

/**
 * Score and sort commands against a query. Full token-aware ranking
 * lands in Task 5 (Phase 2 plan).
 */
export function rankCommands(
  items: CommandItem[],
  query: string,
  _recentIds: string[],
): CommandItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return items;
  return items
    .filter((i) => i.label.toLowerCase().includes(q) || (i.subtitle ?? "").toLowerCase().includes(q))
    .sort((a, b) => a.label.localeCompare(b.label));
}
