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
 *   1. The active colour palette (`comfy-palette.ts:paletteIsLight`): its
 *      `light_theme` flag, else how light the widgets it paints are, so a
 *      light palette that sets no flag (Easy-Use's Milk White) still counts
 *      as light. The authority wherever the API exists. Frontend 1.58.5
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

import { paletteIsLight } from "./comfy-palette";

export type WpTheme = "dark" | "light";

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

let rootObserver: MutationObserver | null = null;

/**
 * Keep `<html>`'s `wp-theme-*` class in step with ComfyUI for the whole page.
 *
 * Each widget's `attachThemeDetector` also writes `<html>`, but only while
 * that widget lives: once the widgets that saw the last switch are gone
 * (a workflow reload, nodes removed), nothing moved `<html>` on the next
 * palette switch and it kept the old theme. This one observer lives for the
 * page. Writes only on a real change, so its own write can't re-fire it.
 */
export function watchRootTheme(app?: AppLike): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  const root = document.documentElement;
  const sync = () => {
    const dark = isDark(app);
    const want = dark ? CLASS_DARK : CLASS_LIGHT;
    const other = dark ? CLASS_LIGHT : CLASS_DARK;
    if (!root.classList.contains(want)) root.classList.add(want);
    if (root.classList.contains(other)) root.classList.remove(other);
  };
  sync();
  if (rootObserver || typeof MutationObserver === "undefined") return;
  rootObserver = new MutationObserver(sync);
  for (const t of themeSignalTargets()) {
    const filter = t === root ? ["class", "style"] : ["class"];
    rootObserver.observe(t, { attributes: true, attributeFilter: filter });
  }
}

/** Tests only. */
export function _resetRootThemeForTests(): void {
  rootObserver?.disconnect();
  rootObserver = null;
}
