/**
 * Reads ComfyUI's `Comfy.ColorPalette` setting and applies a matching
 * `wp-theme-dark` / `wp-theme-light` class to widget host elements.
 *
 * ComfyUI ships several palettes (dark / light / github / solarized /
 * arc / nord / etc). For our purposes only the dark/light split
 * matters — non-dark palettes typically all read as "light" in the
 * ColorPalette enum. We treat exactly `"light"` as light; everything
 * else falls through to dark.
 *
 * The detector exposes two surfaces:
 *  - `applyTheme(host, theme)` — pure mutation, used by mount glue
 *    and tests
 *  - `attachThemeDetector(host, app)` — full lifecycle: read initial
 *    setting, listen for changes, return cleanup
 */

export type WpTheme = "dark" | "light";

interface AppLike {
  extensionManager?: {
    setting?: {
      get?: (id: string) => unknown;
      // newer ComfyUI exposes onChange; older builds rely on settings array onChange
      onChange?: (id: string, cb: (value: unknown) => void) => () => void;
    };
  };
}

const COLOR_PALETTE_KEY = "Comfy.ColorPalette";
const CLASS_DARK = "wp-theme-dark";
const CLASS_LIGHT = "wp-theme-light";

/** Mutates `host` so it carries exactly one of `wp-theme-dark` / `wp-theme-light`. */
export function applyTheme(host: HTMLElement, theme: WpTheme): void {
  if (theme === "dark") {
    host.classList.add(CLASS_DARK);
    host.classList.remove(CLASS_LIGHT);
  } else {
    host.classList.add(CLASS_LIGHT);
    host.classList.remove(CLASS_DARK);
  }
}

/** Reads `Comfy.ColorPalette` once, returns the matching `WpTheme`. Defaults to dark. */
export function detectInitialTheme(app: AppLike): WpTheme {
  const value = app.extensionManager?.setting?.get?.(COLOR_PALETTE_KEY);
  return value === "light" ? "light" : "dark";
}

/**
 * Wire a host element to follow ComfyUI's color palette setting.
 *
 * Applies the initial theme synchronously, subscribes to setting
 * changes (when the API exposes `onChange`), and returns a cleanup
 * function that removes the listener. Cleanup is mostly a courtesy —
 * widget hosts live for the duration of the page session, but tests +
 * future hot-reload paths benefit from the explicit teardown.
 */
export function attachThemeDetector(host: HTMLElement, app: AppLike): () => void {
  applyTheme(host, detectInitialTheme(app));

  const onChange = app.extensionManager?.setting?.onChange;
  if (typeof onChange !== "function") {
    // Older ComfyUI: no live subscribe; initial apply is the best we can do.
    return () => {};
  }

  const unsub = onChange(COLOR_PALETTE_KEY, (value) => {
    applyTheme(host, value === "light" ? "light" : "dark");
  });

  return () => {
    try {
      unsub();
    } catch {
      /* idempotent */
    }
  };
}
