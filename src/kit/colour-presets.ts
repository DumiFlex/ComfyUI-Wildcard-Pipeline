/** The preset colours the colour pickers offer (bundle frames, categories),
 *  and the default a new one starts with. One list, so every picker and the
 *  canvas offer the same swatches. Brand colours, not theme tokens: a picked
 *  colour is stored as hex and looks the same in light and dark. */
export const COLOUR_PRESETS: readonly string[] = [
  "#7c3aed", "#a78bfa", "#22d3ee", "#34d399",
  "#fbbf24", "#f472b6", "#fb7185", "#ef4444",
  "#6366f1", "#10b981", "#f59e0b", "#8b5cf6",
];

/** The colour a new bundle or category starts with. */
export const DEFAULT_COLOUR = "#6366f1";
