/**
 * Reads ComfyUI's `Comfy.ColorPalette` setting and applies a matching
 * `wp-theme-dark` / `wp-theme-light` class to widget host elements
 * AND to `document.documentElement`.
 *
 * Why both? Vue `<Teleport to="body">` modals (ModuleEditModal,
 * ModulePickerModal) escape the widget host subtree, so a host-only
 * class doesn't reach them. Mounting the same class on `<html>` makes
 * the cascade reach every descendant — host widgets AND teleported
 * modals — without giving up the host-scoped class for tests/devtools.
 *
 * ComfyUI ships several palettes (dark / light / github / solarized /
 * arc / nord / etc). We treat exactly `"dark"` (and unset) as dark;
 * everything else maps to light. This is the inverse of what we
 * shipped initially (which only lit up on `"light"`) — the new
 * mapping handles all the non-dark palettes ComfyUI actually ships.
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

function paletteToTheme(value: unknown): WpTheme {
  // Treat `dark` (and unset) as dark; every other palette maps to light.
  if (value === undefined || value === null || value === "" || value === "dark") {
    return "dark";
  }
  return "light";
}

/**
 * Mutate `host` AND `document.documentElement` so they carry exactly one of
 * `wp-theme-dark` / `wp-theme-light`. Documenting twice is intentional —
 * see file header for the teleported-modal rationale.
 */
export function applyTheme(host: HTMLElement, theme: WpTheme): void {
  const targets: Element[] = [host];
  // SSR / unit tests without a document fall through gracefully.
  if (typeof document !== "undefined" && document.documentElement) {
    targets.push(document.documentElement);
  }
  const add = theme === "dark" ? CLASS_DARK : CLASS_LIGHT;
  const remove = theme === "dark" ? CLASS_LIGHT : CLASS_DARK;
  for (const t of targets) {
    t.classList.add(add);
    t.classList.remove(remove);
  }
}

/** Reads `Comfy.ColorPalette` once, returns the matching `WpTheme`. Defaults to dark. */
export function detectInitialTheme(app: AppLike): WpTheme {
  const value = app.extensionManager?.setting?.get?.(COLOR_PALETTE_KEY);
  return paletteToTheme(value);
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
    applyTheme(host, paletteToTheme(value));
  });

  return () => {
    try {
      unsub();
    } catch {
      /* idempotent */
    }
  };
}
