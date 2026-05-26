/**
 * Build the inline-style triple for a `<span class="wp-cat-chip">` matching
 * the prototype's `<Chip color>` pattern.
 *
 * Theme-aware text: the user-picked category color blends toward
 * `--wp-text` (which flips with the theme) so a light pastel pick stays
 * readable in light mode and a dark pick stays readable in dark mode.
 *
 * Returns a fallback (uses `--wp-bg-3` neutral) when no color is provided.
 */
export function catChipStyle(color?: string | null): Record<string, string> {
  if (!color) {
    return {
      color: "var(--wp-text-muted)",
      background: "var(--wp-bg-3)",
      borderColor: "var(--wp-border)",
    };
  }
  return {
    color: `color-mix(in oklab, ${color} 65%, var(--wp-text))`,
    background: `color-mix(in oklab, ${color} 18%, transparent)`,
    borderColor: `color-mix(in oklab, ${color} 42%, transparent)`,
  };
}
