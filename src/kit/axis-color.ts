/**
 * Per-axis sub-category colours — one source of truth for the wildcard
 * editor pills, the option-row tag chips, and the pool palette, so a tag
 * reads with the same colour on every surface.
 *
 * Each sub-category GROUP (axis) gets a distinct hue by its position among
 * its siblings. The old per-component copies shared TWO failings that both
 * produced "two groups, same colour": the palette held two near-identical
 * purples (`#a78bfa` and `#a970ff`), and assignment wrapped with
 * `% length`, repeating once there were more groups than hues. This palette
 * is de-duplicated and ordered for maximum separation between consecutive
 * axes; past it, a golden-angle hue keeps every additional group distinct.
 */

/** Neutral hue for ungrouped / "other" tags. */
export const UNGROUPED_HUE = "var(--wp-text-dim, var(--wp-text3))";

/** Curated distinct hues (no two similar), ordered so consecutive axes land
 *  far apart on the wheel. Theme tokens where they exist, hex otherwise. */
const AXIS_HUES = [
  "var(--wp-kind-wildcard, #a78bfa)", // purple
  "var(--wp-teal, #33d6c6)", // teal
  "var(--wp-status-modified, #fb923c)", // orange
  "#60a5fa", // blue
  "var(--wp-success, #22c55e)", // green
  "#fb7185", // rose
  "#fbbf24", // amber
  "#e879f9", // magenta
];

/**
 * Distinct, non-repeating hue for the sub-category group (axis) at `index`
 * among its siblings. `index < 0` (ungrouped) → the neutral token. Past the
 * curated palette, a golden-angle hue keeps additional groups distinct
 * rather than wrapping back onto an earlier colour.
 */
export function axisHueAt(index: number): string {
  if (index < 0) return UNGROUPED_HUE;
  if (index < AXIS_HUES.length) return AXIS_HUES[index];
  const hue = ((index * 137.508) % 360).toFixed(1);
  return `hsl(${hue} 68% 66%)`;
}
