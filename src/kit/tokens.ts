// The CSS custom properties a kit piece may read.
//
// Most pieces also run on the ComfyUI canvas, whose colour sheet is the
// extension's own (components/shared/theme.css), not src/theme/. Those pieces
// read only SHARED_TOKENS, which every host defines, so a piece wears
// whichever side's colours it sits on. The pieces in PAGE_PIECES only run on
// pages that load src/theme/tokens.css (the manager, the community site, the
// kit site), so they may read any name that sheet defines.
// tokens.test.ts holds both rules.
//
// Add a shared name only once every host defines it (docs/tokens.md).

export const SHARED_TOKENS = [
  // Surfaces and text
  "--wp-bg", "--wp-bg-1", "--wp-bg-2", "--wp-bg-3", "--wp-bg-4",
  "--wp-text", "--wp-text-muted", "--wp-text-dim",
  "--wp-border", "--wp-border-strong", "--wp-border-soft", "--wp-border-focus",
  "--wp-overlay-bg", "--wp-row-hover", "--wp-input-shade", "--wp-scrollbar-thumb",
  // Accent and states
  "--wp-accent", "--wp-accent-glow", "--wp-accent-text", "--wp-accent-text-strong",
  "--wp-accent-300", "--wp-accent-400", "--wp-accent-500", "--wp-accent-600", "--wp-accent-700", "--wp-accent-800",
  "--wp-focus-ring",
  "--wp-success", "--wp-warn", "--wp-danger", "--wp-info", "--wp-danger-text",
  "--wp-error-border", "--wp-error-text",
  "--wp-red", "--wp-red-bg", "--wp-green", "--wp-green-bg", "--wp-amber", "--wp-amber-bg",
  "--wp-teal", "--wp-teal-bg", "--wp-violet", "--wp-violet-bg", "--wp-rose", "--wp-rose-bg",
  // Kinds and variables
  "--wp-kind-wildcard", "--wp-kind-fixed", "--wp-kind-combine", "--wp-kind-derivation", "--wp-kind-constraint",
  "--wp-var-1", "--wp-var-2", "--wp-var-3", "--wp-var-4", "--wp-var-5", "--wp-var-6", "--wp-var-7", "--wp-var-8",
  // Shape, depth and type
  "--wp-radius-sm", "--wp-radius", "--wp-radius-md", "--wp-radius-lg", "--wp-radius-xl", "--wp-radius-cap",
  "--wp-shadow-sm", "--wp-shadow", "--wp-shadow-md", "--wp-shadow-lg", "--wp-shadow-xl",
  "--wp-font-sans", "--wp-font-mono",
  "--wp-text-xs", "--wp-text-sm", "--wp-text-base", "--wp-text-md", "--wp-text-lg", "--wp-text-xl",
  "--wp-space-0", "--wp-space-1", "--wp-space-2", "--wp-space-3", "--wp-space-4",
  "--wp-space-5", "--wp-space-6", "--wp-space-7", "--wp-space-8",
  "--wp-control-h-sm", "--wp-control-h-md", "--wp-control-h-lg",
  // Motion
  "--wp-motion-quick", "--wp-motion-hover", "--wp-motion-shimmer", "--wp-motion-fade", "--wp-motion-swap", "--wp-motion-flip",
  "--wp-motion-curve-collapse", "--wp-motion-curve-flip", "--wp-motion-curve-linear",
] as const;

/** Read with a fallback (`var(--wp-bg-deep, var(--wp-bg))`) or kept for older
 *  hosts; a host may leave these out. */
export const OPTIONAL_TOKENS = ["--wp-bg-deep", "--wp-bg2"] as const;

/** Set by the piece itself, on its own root, not by the host. */
export const LOCAL_TOKENS = ["--wp-hsv-hue", "--wp-lm-t", "--wp-select-line-h"] as const;

/** Pieces that need a page with src/theme/ loaded (not the canvas). */
export const PAGE_PIECES = [
  "Button.vue", "Card.vue", "Checkbox.vue", "Chip.vue", "ChoiceCards.vue", "ColorPicker.vue", "ConfirmModal.vue",
  "DataTable.vue", "Drawer.vue", "EmptyState.vue", "Field.vue", "Icon.vue", "IconPicker.vue", "Input.vue",
  "ListFilter.vue", "Modal.vue", "RelativeDate.vue", "Select.vue", "Textarea.vue", "ToastHost.vue", "Toggle.vue",
] as const;
