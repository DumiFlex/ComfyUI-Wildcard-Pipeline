/**
 * The manager's live appearance, as the framed Community page takes it:
 * light/dark, the look id and the values of the tokens a theme or look sets.
 *
 * Values, not theme names, cross the frame, so a new palette, a custom
 * accent or High contrast needs nothing on the community side. The frame
 * keeps only the names listed here (its mirror is `web/src/frame/appearance.ts`
 * in the community repo) and only plain colour / length / font values.
 */
import type { FrameAppearance } from "./frame-protocol";

export const APPEARANCE_TOKENS = [
  "--wp-bg", "--wp-bg-1", "--wp-bg-2", "--wp-bg-3", "--wp-bg-4",
  "--wp-border", "--wp-border-strong",
  "--wp-text", "--wp-text-muted", "--wp-text-dim", "--wp-row-hover",
  "--wp-accent-50", "--wp-accent-100", "--wp-accent-200", "--wp-accent-300",
  "--wp-accent-400", "--wp-accent-500", "--wp-accent-600", "--wp-accent-700",
  "--wp-accent-800", "--wp-accent-900",
  "--wp-accent-text", "--wp-accent-text-strong", "--wp-focus-ring",
  "--wp-radius-sm", "--wp-radius", "--wp-radius-lg", "--wp-radius-xl", "--wp-radius-cap",
  "--wp-font", "--wp-font-mono", "--wp-font-head",
  "--wp-input-h", "--wp-btn-h", "--wp-btn-h-sm",
  "--wp-shadow-sm", "--wp-shadow",
] as const;

export function readAppearance(root: HTMLElement = document.documentElement): FrameAppearance {
  const style = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of APPEARANCE_TOKENS) {
    const value = style.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  return {
    scheme: root.classList.contains("wp-theme-light") ? "light" : "dark",
    look: root.getAttribute("data-wp-look") ?? "orbit",
    tokens,
  };
}

/** Call `onChange` with a fresh appearance whenever <html> changes theme,
 *  palette, look or an inline accent. Returns the stop function. */
export function watchAppearance(
  onChange: (appearance: FrameAppearance) => void,
  root: HTMLElement = document.documentElement,
): () => void {
  let last = JSON.stringify(readAppearance(root));
  const observer = new MutationObserver(() => {
    const next = readAppearance(root);
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    onChange(next);
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["class", "style", "data-wp-palette", "data-wp-look"],
  });
  return () => observer.disconnect();
}
