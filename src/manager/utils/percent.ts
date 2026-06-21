/**
 * Format a wildcard-option probability (a number in 0–100) for display.
 *
 * The editor used to render `probabilityFor(o).toFixed(0)`, which rounds
 * any option below 0.5% to a flat "0%". With many options that's both
 * common and misleading — a legitimately-weighted option reads as
 * impossible. This keeps big values clean (integers) and grows decimal
 * places for small ones so a nonzero probability never shows as "0%".
 *
 *   33.333 → "33%"   2.5 → "2.5%"   0.76 → "0.76%"
 *   0.0076 → "0.01%"  0.001 → "0.001%"  0 → "0%"
 */
export function formatProbability(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0%";
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${trimZeros(pct.toFixed(1))}%`;
  // Below 1%: grow precision until the rounded value is nonzero (capped),
  // so a tiny-but-real weight never collapses to "0%".
  let dp = 2;
  while (Number(pct.toFixed(dp)) === 0 && dp < 4) dp++;
  const v = pct.toFixed(dp);
  return Number(v) === 0 ? "<0.01%" : `${trimZeros(v)}%`;
}

/** Strip trailing zeros (and a bare trailing dot) from a fixed-decimal string. */
function trimZeros(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
