import type { CommandItem } from "../components/CommandPalette.types";

interface Scored {
  item: CommandItem;
  score: number;
}

/** Score a single haystack against a single token. */
function tokenScore(haystack: string, token: string): number {
  const h = haystack.toLowerCase();
  const t = token.toLowerCase();
  if (!t) return 0;
  const idx = h.indexOf(t);
  if (idx < 0) return -Infinity;       // miss — caller filters
  if (idx === 0) {
    // Prefix match. Exact label = 12, plain prefix = 10.
    return h === t ? 12 : 10;
  }
  // Word-boundary substring bonus (preceded by space or dash/underscore).
  const prevChar = h[idx - 1];
  if (prevChar === " " || prevChar === "-" || prevChar === "_") return 8;
  return 4;
}

/**
 * Score and sort commands against a query. Multi-token AND semantics:
 * every token must match in label OR subtitle. Per-token score is
 * max(labelScore, subtitleScore * 0.5). Recent-id matches get +5 boost.
 *
 * Sort: score descending, then label ascending alphabetically.
 */
export function rankCommands(
  items: CommandItem[],
  query: string,
  recentIds: string[],
): CommandItem[] {
  const q = query.trim();
  if (!q) return items;

  const recentSet = new Set(recentIds);
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored: Scored[] = [];

  for (const it of items) {
    let total = 0;
    let allMatch = true;
    for (const tok of tokens) {
      const labelScore = tokenScore(it.label, tok);
      const subtitleScore = tokenScore(it.subtitle ?? "", tok) * 0.5;
      const best = Math.max(labelScore, subtitleScore);
      if (!Number.isFinite(best) || best <= -Infinity) { allMatch = false; break; }
      total += best;
    }
    if (!allMatch) continue;
    if (recentSet.has(it.id)) total += 5;
    scored.push({ item: it, score: total });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.label.localeCompare(b.item.label);
  });
  return scored.map((s) => s.item);
}
