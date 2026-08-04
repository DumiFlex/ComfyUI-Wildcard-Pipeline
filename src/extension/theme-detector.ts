/**
 * Tracks ComfyUI's active theme and applies a matching `wp-theme-dark`
 * / `wp-theme-light` class to the host element AND `<html>`.
 *
 * **Why both targets:** Vue `<Teleport to="body">` modals
 * (ModuleEditModal, ModulePickerModal) escape the widget host subtree,
 * so a host-only class doesn't reach them. Mounting the same class on
 * `<html>` makes the cascade reach every descendant.
 *
 * **Why watch the `dark-theme` class instead of `Comfy.ColorPalette`:**
 * ComfyUI sets a `dark-theme` class for every dark variant (default
 * `dark`, `obsidian`, themed dark palettes) and omits it for light
 * variants. The `Comfy.ColorPalette` setting key is unreliable across
 * versions — some builds don't expose
 * `extensionManager.setting.onChange`, others use different palette
 * IDs (`dark` / `light` / `obsidian` / `github` / …) that don't all
 * map cleanly to dark/light.
 *
 * **Why BOTH `<html>` and `<body>`:** the class moved between frontend
 * releases. Verified against two live builds:
 *
 *   - 1.45.21 → `<body class="litegraph grid dark-theme …">`, `<html>` bare
 *   - 1.47.10 → `<html class="dark-theme">`, body no longer carries it
 *
 * Reading only `<body>` therefore reported LIGHT on every modern build,
 * so the extension painted its light tokens onto a dark ComfyUI. Checking
 * either element covers both eras, and observing both means a theme switch
 * is caught whichever element the running frontend mutates. Neither element
 * carrying the class is the genuine light signal on both.
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

/** The elements ComfyUI has parked the `dark-theme` class on across releases.
 *  `<html>` first — that's where current builds put it. */
function themeSignalTargets(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const out: HTMLElement[] = [];
  if (document.documentElement) out.push(document.documentElement);
  if (document.body) out.push(document.body);
  return out;
}

/** True when EITHER `<html>` or `<body>` carries ComfyUI's dark marker.
 *  Defaults to dark when there's no DOM at all (SSR / unit bootstrap), which
 *  matches ComfyUI's own default palette. */
function hasDarkClass(): boolean {
  const targets = themeSignalTargets();
  if (targets.length === 0) return true;
  return targets.some((el) => el.classList.contains(COMFY_DARK_BODY_CLASS));
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
  return hasDarkClass() ? "dark" : "light";
}

/**
 * Wire a host element to follow ComfyUI's theme class.
 *
 * Applies the initial theme synchronously, observes future `class` changes on
 * BOTH `<html>` and `<body>` (the class has lived on each across releases —
 * see the file header) via `MutationObserver`, and returns a cleanup function
 * that disconnects the observer.
 */
export function attachThemeDetector(host: HTMLElement, _app?: AppLike): () => void {
  applyTheme(host, detectInitialTheme());

  const targets = themeSignalTargets();
  if (typeof MutationObserver === "undefined" || targets.length === 0) {
    // No DOM / no observer — initial apply is the best we can do.
    return () => {};
  }

  let lastIsDark = hasDarkClass();
  const observer = new MutationObserver(() => {
    const isDark = hasDarkClass();
    if (isDark === lastIsDark) return;
    lastIsDark = isDark;
    applyTheme(host, isDark ? "dark" : "light");
  });
  // One observer, both targets — whichever element the running frontend
  // mutates, the same callback re-reads the combined signal.
  for (const t of targets) {
    observer.observe(t, { attributes: true, attributeFilter: ["class"] });
  }

  return () => {
    try {
      observer.disconnect();
    } catch {
      /* idempotent */
    }
  };
}
