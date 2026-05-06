// Wildcard Pipeline topbar/toolbar button — opens the manager SPA at
// `/wp/dashboard` in a new tab.
//
// Render strategy: use ComfyUI's DEFAULT actionbar button styling
// (no inline overrides, no LoRA-Manager-replica). We only swap the
// Iconify placeholder `<i>` for our brand SVG so the button carries
// the WP identity. Everything else — padding, border-radius, hover
// background, text color — comes from ComfyUI's button CSS so we
// blend in with the rest of the topbar regardless of palette.
//
// Two render paths, picked by ComfyUI frontend version:
//
//   - Frontend ≥ 1.33.9 → `actionBarButtons` extension property.
//     ComfyUI's Vue actionbar renders our entry inside the
//     `actionbar-container`. We replace the icon `<i>` with our SVG
//     via a `requestAnimationFrame` loop once Vue mounts the button.
//   - Frontend  < 1.33.9 → legacy direct attach: build a `ComfyButton`
//     via `/scripts/ui/components/{button,buttonGroup}.js` and insert
//     before `app.menu.settingsGroup`. Default `comfyui-button`
//     classList only — no `primary` modifier or per-button styles.
//
// SVG construction goes through DOMParser (not `innerHTML = ...`)
// because the project's pre-tool security hook flags raw innerHTML
// writes. Outcome is identical, just safer.
//
// Belt-and-suspenders: also register `commands` + `menuCommands` for
// the topbar dropdown so the SPA stays reachable even when
// `app.menu.settingsGroup` isn't there (older ComfyUI builds, headless
// hosts, etc.).

import wpLogoSvg from "../components/shared/wp-logo.svg?raw";

const SPA_PATH = "/wp/dashboard";
const TOOLTIP = "Wildcard Pipeline Workspace (opens in a new window)";
const POPUP_FEATURES = "width=1280,height=900,resizable=yes,scrollbars=yes,status=yes";
const BUTTON_GROUP_CLASS = "wp-top-menu-group";
const BUTTON_MARKER_CLASS = "wp-top-menu-button";

// Frontend version threshold for the new actionBarButtons API.
// Versions below ship a different menu shell where the
// actionbar-container doesn't exist.
const MIN_VERSION_FOR_ACTION_BAR: readonly [number, number, number] = [1, 33, 9];

// Cap the polling retry — `app.menu.settingsGroup` mounts a few rAF
// ticks into ComfyUI's boot, so 120 frames (~2s at 60fps) is far past
// the realistic worst case.
const MAX_ATTACH_ATTEMPTS = 120;

interface AppMenu { settingsGroup?: { element: HTMLElement } }
interface AppLike { menu?: AppMenu }

interface ComfyButtonInstance {
  element: HTMLButtonElement;
  iconElement?: HTMLElement;
}
interface ComfyButtonModule {
  ComfyButton: new (opts: {
    icon?: string;
    tooltip?: string;
    app?: unknown;
    enabled?: boolean;
    classList?: string;
  }) => ComfyButtonInstance;
}
interface ComfyButtonGroupModule {
  ComfyButtonGroup: new (...elements: HTMLElement[]) => { element: HTMLElement };
}

/** Open the SPA. Shift+Click → detached popup window (sized for the
 *  manager UI), plain click → background tab. The path lands on
 *  `/wp/dashboard` so the user sees the overview, not the wildcards
 *  list (which is what the SPA's root redirect resolves to). */
function openSpa(event?: MouseEvent | KeyboardEvent): void {
  const url = `${window.location.origin}${SPA_PATH}`;
  if ((event as MouseEvent | undefined)?.shiftKey) {
    window.open(url, "_blank", POPUP_FEATURES);
    return;
  }
  // noopener so the SPA tab can't reach back into ComfyUI's window via
  // window.opener — defensive, the SPA wouldn't try, but free safety.
  window.open(url, "_blank", "noopener");
}

/** Parse a "1.33.9" / "v1.33.9-beta" -style frontend version string
 *  into a `[major, minor, patch]` triple, padding shorter strings with
 *  zeros and stripping pre-release suffixes. */
function parseVersion(v: string): [number, number, number] {
  if (!v) return [0, 0, 0];
  const clean = v.replace(/^[vV]/, "").split("-")[0];
  const parts = clean.split(".").map((p) => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return [parts[0], parts[1], parts[2]];
}

function compareVersions(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

/** Resolve the running frontend version. Tries the global window var
 *  first (set by ComfyUI core during boot), falls back to `/system_stats`,
 *  finally returns "0.0.0" so version compare stays well-defined. */
async function getFrontendVersion(): Promise<string> {
  const w = window as unknown as { __COMFYUI_FRONTEND_VERSION__?: string };
  if (w.__COMFYUI_FRONTEND_VERSION__) return w.__COMFYUI_FRONTEND_VERSION__;
  try {
    const r = await fetch("/system_stats");
    const data = await r.json();
    return data?.system?.comfyui_frontend_version ?? data?.system?.required_frontend_version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** True when the running ComfyUI exposes the new `actionBarButtons`
 *  extension property — gates the modern render path against the
 *  legacy `app.menu.settingsGroup` direct-attach path. */
export async function supportsActionBar(): Promise<boolean> {
  const v = await getFrontendVersion();
  return compareVersions(parseVersion(v), MIN_VERSION_FOR_ACTION_BAR) >= 0;
}

/**
 * Strip the bundled brand SVG down to a flat `currentColor` glyph and
 * parse it into a real SVGElement. Each call returns a fresh node,
 * because we re-run the icon swap and the same node can't live in
 * two places.
 *
 * `fill="currentColor"` lets the icon inherit ComfyUI's button text
 * color so it adapts to whatever palette is active (light/dark/etc).
 * Replaces the previous `#fff` hardcode that paired with the
 * LoRA-Manager-replica primary-bg button — now that we use ComfyUI's
 * default button styling, hardcoded white would clash on light themes.
 *
 * Returns null on a malformed parse — caller leaves the placeholder
 * Iconify `<i>` in place.
 */
function parseBrandIcon(): SVGElement | null {
  if (typeof DOMParser === "undefined") return null;
  const monochrome = wpLogoSvg
    .replace(/<defs>[\s\S]*?<\/defs>/g, "")
    .replace(/\sclass="[^"]*"/g, "")
    .replace(/\sfill="[^"]*"/g, "")
    .replace(/<svg([^>]*)>/, '<svg$1 fill="currentColor">');
  const doc = new DOMParser().parseFromString(monochrome, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName === "parsererror" || root.nodeName.toLowerCase() !== "svg") return null;
  return document.importNode(root, true) as unknown as SVGElement;
}

/**
 * Replace the Iconify placeholder `<i>` inside every WP-tagged button
 * with our brand SVG. No inline styles — ComfyUI's default button CSS
 * keeps the icon sized + positioned correctly.
 *
 * Returns the count of buttons touched so the caller can decide
 * whether to keep polling (button not yet mounted) or stop.
 */
function applyBrandIcon(): number {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${TOOLTIP}"]`,
  );
  buttons.forEach((btn) => {
    btn.classList.add(BUTTON_MARKER_CLASS);
    // Skip if our SVG is already mounted (rAF tick after a previous
    // success). Iconify renders an `<i>` placeholder; once we replace
    // it with `<svg>` the next tick would otherwise no-op safely, but
    // checking is cheaper than re-parsing the SVG.
    if (btn.querySelector("svg.wp-brand-icon")) return;
    const fresh = parseBrandIcon();
    if (!fresh) return;
    fresh.classList.add("wp-brand-icon");
    // ComfyUI's actionBar button uses `size-4` (Tailwind 1rem = 16px) on
    // the icon `<i>`. Apply the equivalent inline so our SVG scales the
    // same as siblings without needing a hover/transition stylesheet.
    fresh.setAttribute("width", "1em");
    fresh.setAttribute("height", "1em");
    btn.replaceChildren(fresh);
  });
  return buttons.length;
}

/**
 * Drive the post-mount icon swap loop. Used by both paths — the
 * actionBar path needs it because Vue mounts the button asynchronously
 * (the rAF tick gives us the moment after first paint), and the
 * legacy path needs it because `comfyui-button` may apply child
 * layout that the construction-time iconElement swap doesn't fully
 * tame.
 *
 * Loop terminates the first frame at least one matching button is
 * found AND has been processed.
 */
export function startIconReplaceLoop(): void {
  if (typeof document === "undefined") return;
  const tick = (): void => {
    const touched = applyBrandIcon();
    if (touched === 0) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

/**
 * Legacy direct-attach path for ComfyUI < 1.33.9. Build a default
 * `ComfyButton` (no `primary` modifier) and insert before
 * `settingsGroup`. ComfyUI's default button styling carries the
 * tooltip + hover behavior — we only swap the icon afterwards.
 *
 * Polls via rAF until `settingsGroup` is mountable. Idempotent — a
 * guard query on the group class short-circuits double mounts.
 */
export async function attachLegacyTopbarButton(app: AppLike, attempt = 0): Promise<void> {
  if (typeof document === "undefined") return;
  if (document.querySelector(`.${BUTTON_GROUP_CLASS}`)) return;

  const settingsGroup = app.menu?.settingsGroup;
  if (!settingsGroup?.element?.parentElement) {
    if (attempt >= MAX_ATTACH_ATTEMPTS) {
      console.warn(
        "[wildcard-pipeline] could not locate ComfyUI settings group; legacy topbar attach skipped (dropdown menu still works)",
      );
      return;
    }
    requestAnimationFrame(() => {
      void attachLegacyTopbarButton(app, attempt + 1);
    });
    return;
  }

  // Resolve the path through a variable so TypeScript doesn't treat it
  // as a module specifier at compile time — these modules are served
  // by the running ComfyUI process, not present in node_modules.
  const BUTTON_PATH = "/scripts/ui/components/button.js";
  const GROUP_PATH = "/scripts/ui/components/buttonGroup.js";
  let buttonMod: ComfyButtonModule;
  let groupMod: ComfyButtonGroupModule;
  try {
    [buttonMod, groupMod] = await Promise.all([
      import(/* @vite-ignore */ BUTTON_PATH) as Promise<ComfyButtonModule>,
      import(/* @vite-ignore */ GROUP_PATH) as Promise<ComfyButtonGroupModule>,
    ]);
  } catch (err) {
    console.warn("[wildcard-pipeline] ComfyButton modules unavailable; legacy attach skipped:", err);
    return;
  }

  const button = new buttonMod.ComfyButton({
    icon: "wildcardpipeline",
    tooltip: TOOLTIP,
    app,
    enabled: true,
    // Default ComfyUI button class only — no `primary` modifier so the
    // button picks up the same styling as ComfyUI's other topbar
    // entries (queue, manager, settings).
    classList: "comfyui-button comfyui-menu-mobile-collapse",
  });

  button.element.setAttribute("aria-label", TOOLTIP);
  button.element.title = TOOLTIP;

  if (button.iconElement) {
    const svg = parseBrandIcon();
    if (svg) {
      svg.classList.add("wp-brand-icon");
      svg.setAttribute("width", "1em");
      svg.setAttribute("height", "1em");
      button.iconElement.replaceChildren(svg);
    }
  }

  button.element.addEventListener("click", openSpa as EventListener);

  const group = new groupMod.ComfyButtonGroup(button.element);
  group.element.classList.add(BUTTON_GROUP_CLASS);

  settingsGroup.element.before(group.element);
}

// `actionBarButtons` — modern extension API path for ComfyUI ≥ 1.33.9.
// ComfyUI's Vue actionbar renders our entry inside the rounded
// `actionbar-container`. The icon string is an Iconify class that
// ComfyUI's Vue button component turns into a placeholder `<i>`; we
// swap it for our brand SVG via `startIconReplaceLoop` once Vue has
// mounted the element. Iconify class chosen so the placeholder is at
// least vaguely on-brand if our SVG swap ever fails — `mdi--cards`
// reads as "library / wildcards".
export const ACTION_BAR_BUTTONS = [
  {
    icon: "icon-[mdi--cards-outline] size-4",
    tooltip: TOOLTIP,
    onClick: openSpa,
  },
];

// `commands` + `menuCommands` — official ComfyUI extension API for
// topbar dropdown entries. Always works regardless of whether the
// direct toolbar attach succeeded, so the SPA is reachable even on
// ComfyUI builds that don't expose `app.menu.settingsGroup`.
export const TOPBAR_COMMANDS = [
  {
    id: "wildcardPipeline.openManager",
    label: "Launch Wildcard Pipeline manager",
    function: () => openSpa(),
  },
];

export const TOPBAR_MENU_COMMANDS = [
  {
    path: ["Extensions", "Wildcard Pipeline"],
    commands: ["wildcardPipeline.openManager"],
  },
];
