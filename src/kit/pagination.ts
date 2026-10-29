/**
 * The page numbers a Pagination shows: always the first and last page, the
 * current page with `siblings` on each side, and "…" where pages are left
 * out. A gap of exactly one page shows that page instead of "…", so the row
 * keeps the same length as you move through it.
 */
export type PageItem = number | "gap-start" | "gap-end";

export function pageItems(page: number, pages: number, siblings = 1): PageItem[] {
  if (pages <= 0) return [];
  const slots = siblings * 2 + 5;
  if (pages <= slots) return Array.from({ length: pages }, (_, i) => i + 1);
  const cur = Math.min(Math.max(1, page), pages);
  const left = Math.max(cur - siblings, 1);
  const right = Math.min(cur + siblings, pages);
  const showStart = left > 3;
  const showEnd = right < pages - 2;
  if (!showStart) {
    const n = siblings * 2 + 3;
    return [...Array.from({ length: n }, (_, i) => i + 1), "gap-end", pages];
  }
  if (!showEnd) {
    const n = siblings * 2 + 3;
    return [1, "gap-start", ...Array.from({ length: n }, (_, i) => pages - n + 1 + i)];
  }
  return [1, "gap-start", ...Array.from({ length: right - left + 1 }, (_, i) => left + i), "gap-end", pages];
}
