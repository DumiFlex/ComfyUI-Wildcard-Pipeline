/**
 * Tracks ComfyUI's active theme and applies a matching `wp-theme-dark`
 * / `wp-theme-light` class to the host element AND `<html>`.
 *
 * **Why both targets:** Vue `<Teleport to="body">` modals
 * (ModuleEditModal, ModulePickerModal) escape the widget host subtree,
 * so a host-only class doesn't reach them. Mounting the same class on
 * `<html>` makes the cascade reach every descendant.
 *
 * **Why watch `<body>` instead of `Comfy.ColorPalette`:**
 * Modern ComfyUI sets `<body class="...dark-theme">` for every dark
 * variant (default `dark`, `obsidian`, themed dark palettes) and omits
 * the class for light variants. The `Comfy.ColorPalette` setting key
 * is unreliable across versions — some builds don't expose
 * `extensionManager.setting.onChange`, others use different palette
 * IDs (`dark` / `light` / `obsidian` / `github` / …) that don't all
 * map cleanly to dark/light.
 *
 * Watching the body class is the universal signal: regardless of
 * which palette is active, the body either carries `dark-theme` or
 * doesn't. A `MutationObserver` on `<body>` `class` catches every
 * theme switch in one place and works on every ComfyUI build that
 * ever shipped (the `dark-theme` body class predates the extension
 * setting API).
 *
 * The detector exposes two surfaces:
 *  - `applyTheme(host, theme)` — pure mutation, used by mount glue
 *    and tests
 *  - `attachThemeDetector(host, app)` — full lifecycle: read initial
 *    body class, observe future changes, return cleanup
 */

export type WpTheme = "dark" | "light";

interface AppLike {
  // Kept for backward compatibility with the test harness; no longer
  // queried by attachThemeDetector. Body-class observation supersedes
  // the setting read.
  extensionManager?: unknown;
}

const COMFY_DARK_BODY_CLASS = "dark-theme";
const CLASS_DARK = "wp-theme-dark";
const CLASS_LIGHT = "wp-theme-light";

function bodyHasDarkClass(): boolean {
  if (typeof document === "undefined" || !document.body) return true;
  return document.body.classList.contains(COMFY_DARK_BODY_CLASS);
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

/**
 * Read the current theme from `<body class>`. Returns `"dark"` when
 * `dark-theme` is present (default ComfyUI dark + obsidian + every
 * dark-variant palette), `"light"` otherwise.
 */
export function detectInitialTheme(_app?: AppLike): WpTheme {
  return bodyHasDarkClass() ? "dark" : "light";
}

/**
 * Wire a host element to follow ComfyUI's body theme class.
 *
 * Applies the initial theme synchronously, observes future changes to
 * `<body class>` via `MutationObserver`, and returns a cleanup
 * function that disconnects the observer.
 */
export function attachThemeDetector(host: HTMLElement, _app?: AppLike): () => void {
  applyTheme(host, detectInitialTheme());

  if (typeof MutationObserver === "undefined" || typeof document === "undefined" || !document.body) {
    // No DOM / no observer — initial apply is the best we can do.
    return () => {};
  }

  let lastIsDark = bodyHasDarkClass();
  const observer = new MutationObserver(() => {
    const isDark = bodyHasDarkClass();
    if (isDark === lastIsDark) return;
    lastIsDark = isDark;
    applyTheme(host, isDark ? "dark" : "light");
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => {
    try {
      observer.disconnect();
    } catch {
      /* idempotent */
    }
  };
}
