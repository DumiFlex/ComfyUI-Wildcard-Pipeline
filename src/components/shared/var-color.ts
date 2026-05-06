/**
 * Binding name → var-color index hash.
 *
 * Same `$hair_style` should look the same across the assembler chip
 * strip, the in-row module meta, and the live preview. Hash the string
 * into one of 8 buckets and emit a `var-N` class — a single CSS rule
 * paints the actual color.
 *
 * djb2 is used because:
 *   - deterministic and stable across browsers
 *   - distributes short identifiers (8-12 chars typical) across buckets
 *     reasonably well at this scale
 *   - tiny implementation, no extra deps
 */
export const VAR_COLOR_COUNT = 8;

/** Returns 1..VAR_COLOR_COUNT for any string. Empty input → 1. */
export function varColorIndex(name: string): number {
  if (!name) return 1;
  // djb2 hash — chosen for short-string distribution + zero deps.
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    // (hash * 33) ^ char — same constants as Bernstein's original.
    hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
  }
  // Modulo into [0, COUNT) then offset to [1, COUNT].
  return ((hash >>> 0) % VAR_COLOR_COUNT) + 1;
}

/** Returns the `var-N` CSS class for `name`. */
export function varColorClass(name: string): string {
  return `var-${varColorIndex(name)}`;
}
