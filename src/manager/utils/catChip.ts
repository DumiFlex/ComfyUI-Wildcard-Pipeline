/**
 * Build the inline-style triple for a `<span class="wp-cat-chip">` matching
 * the prototype's `<Chip color>` pattern (ui.jsx:323-337):
 *   color  = raw color
 *   bg     = color @ 14%
 *   border = color @ 35%
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
    color,
    background: `color-mix(in oklab, ${color} 14%, transparent)`,
    borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
  };
}
