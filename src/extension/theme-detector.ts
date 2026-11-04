/**
 * Tracks ComfyUI's active theme and applies a matching `wp-theme-dark`
 * / `wp-theme-light` class to the host element AND `<html>`.
 *
 * **Why both targets:** Vue `<Teleport to="body">` modals
 * (ModuleEditModal, ModulePickerModal) escape the widget host subtree,
 * so a host-only class doesn't reach them. Mounting the same class on
 * `<html>` makes the cascade reach every descendant.
 *
 * **Where the theme is read from**, in order (the signal moved between
 * frontend releases; checked against live builds):
 *
 *   1. The active colour palette, `extensionManager.colorPalette
 *      .getActiveColorPalette().light_theme` (`true` only for light
 *      palettes). The authority wherever the API exists. Frontend 1.58.5
 *      sets no `dark-theme` class at all, so without this the extension
 *      painted its light tokens onto a dark ComfyUI.
 *   2. A `dark-theme` class on `<html>` (1.47.10) or `<body>` (1.45.21).
 *   3. The computed `color-scheme` of `<html>` (1.58.5 sets it per palette).
 *
 * None of them saying dark is the light signal. A palette switch on 1.58
 * rewrites `<html>`'s inline style (the palette's CSS variables) rather than
 * a class, so the observer watches `style` on `<html>` as well as `class`.
 *
 * The detector exposes two surfaces:
 *  - `applyTheme(host, theme)` — pure mutation, used by mount glue
 *    and tests
 *  - `attachThemeDetector(host, app)` — full lifecycle: read the initial
 *    theme, observe future changes, return cleanup
 */

export type WpTheme = "dark" | "light";

interface PaletteLike {
  light_theme?: boolean;
}

interface AppLike {
  extensionManager?: unknown;
}

const COMFY_DARK_BODY_CLASS = "dark-theme";
const CLASS_DARK = "wp-theme-dark";
const CLASS_LIGHT = "wp-theme-light";

/** The elements ComfyUI has parked the `dark-theme` class on across releases.
 *  `<html>` first — that's where 1.47-era builds put it. */
function themeSignalTargets(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const out: HTMLElement[] = [];
  if (document.documentElement) out.push(document.documentElement);
  if (document.body) out.push(document.body);
  return out;
}

/** The active palette's `light_theme`, or `undefined` when this frontend has
 *  no palette API (or it throws). */
function paletteIsLight(app?: AppLike): boolean | undefined {
  const em = app?.extensionManager;
  if (!em || typeof em !== "object" || !("colorPalette" in em)) return undefined;
  const cp: unknown = em.colorPalette;
  if (!cp || typeof cp !== "object" || !("getActiveColorPalette" in cp)) return undefined;
  const get: unknown = cp.getActiveColorPalette;
  if (typeof get !== "function") return undefined;
  try {
    const palette = get.call(cp) as PaletteLike | null | undefined;
    if (!palette || typeof palette !== "object") return undefined;
    return palette.light_theme === true;
  } catch {
    return undefined;
  }
}

/** True when ComfyUI is dark, read from the signals in the file header.
 *  Defaults to dark when there's no DOM at all (SSR / unit bootstrap), which
 *  matches ComfyUI's own default palette. */
function isDark(app?: AppLike): boolean {
  const light = paletteIsLight(app);
  if (light !== undefined) return !light;
  const targets = themeSignalTargets();
  if (targets.length === 0) return true;
  if (targets.some((el) => el.classList.contains(COMFY_DARK_BODY_CLASS))) return true;
  try {
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    if (/\bdark\b/.test(scheme) && !/\blight\b/.test(scheme)) return true;
  } catch {
    /* no computed style — fall through to light */
  }
  return false;
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

/** Read ComfyUI's current theme (see the file header for where from). */
export function detectInitialTheme(app?: AppLike): WpTheme {
  return isDark(app) ? "dark" : "light";
}

/**
 * Wire a host element to follow ComfyUI's theme.
 *
 * Applies the initial theme synchronously, observes `class` on `<html>` and
 * `<body>` plus `style` on `<html>` (where each frontend era signals a theme
 * switch — see the file header) via `MutationObserver`, and returns a cleanup
 * function that disconnects the observer.
 */
export function attachThemeDetector(host: HTMLElement, app?: AppLike): () => void {
  applyTheme(host, detectInitialTheme(app));

  const targets = themeSignalTargets();
  if (typeof MutationObserver === "undefined" || targets.length === 0) {
    // No DOM / no observer — initial apply is the best we can do.
    return () => {};
  }

  let lastIsDark = isDark(app);
  const observer = new MutationObserver(() => {
    const dark = isDark(app);
    if (dark === lastIsDark) return;
    lastIsDark = dark;
    applyTheme(host, dark ? "dark" : "light");
  });
  // One observer, both targets — whichever element the running frontend
  // mutates, the same callback re-reads the combined signal.
  for (const t of targets) {
    const filter = t === document.documentElement ? ["class", "style"] : ["class"];
    observer.observe(t, { attributes: true, attributeFilter: filter });
  }

  return () => {
    try {
      observer.disconnect();
    } catch {
      /* idempotent */
    }
  };
}
