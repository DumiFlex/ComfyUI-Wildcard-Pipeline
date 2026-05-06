// Wildcard Pipeline topbar/toolbar button — opens the manager SPA at
// `/wp/dashboard` in a new tab.
//
// Render strategy: borrow LoRA Manager's *visual* treatment (filled
// `--primary-bg` background, 4px border-radius, hover ramp) so the
// button reads as a brand-tagged "primary action" — but use ComfyUI's
// *default size* (no `padding: 6px` override, no 20px SVG dimensions).
// The icon inherits ComfyUI's standard `size-4` (1rem = 16px) class
// instead. Net effect: an actionbar button shaped like the queue /
// settings buttons next to it, painted in our brand color, carrying
// our brand SVG.
//
// Two render paths, picked by ComfyUI frontend version:
//
//   - Frontend ≥ 1.33.9 → `actionBarButtons` extension property.
//     ComfyUI's Vue actionbar (`src/components/topbar/ActionBarButtons.vue`)
//     renders our entry inside the rounded `actionbar-container` as
//     `<Button variant="muted-textonly" size="sm" class="h-7 rounded-full">`.
//     We swap the Iconify placeholder `<i>` for our brand SVG and
//     overwrite the inherited `rounded-full` + muted text with the
//     LoRA-style primary-bg + 4px border-radius via a small style
//     block keyed on our aria-label.
//   - Frontend  < 1.33.9 → legacy direct attach: build a `ComfyButton`
//     via `/scripts/ui/components/{button,buttonGroup}.js` with the
//     `primary` classList modifier (so the button carries primary-bg
//     out of the box) and insert before `app.menu.settingsGroup`.
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
const STYLE_ELEMENT_ID = "wp-top-menu-button-styles";

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
  // Strip width/height attributes from the root <svg> so:
  //  (a) ComfyUI's `[&_svg:not([width]):not([height])]:size-4` Tailwind
  //      selector matches and applies size-4 (1rem = 16px) — same auto-size
  //      every other actionbar icon gets.
  //  (b) The `size-4` class we add on the SVG isn't fighting the source
  //      file's hardcoded 1024×1024 attrs (CSS *should* win over the
  //      attr per spec, but some Chromium versions render the attr-based
  //      intrinsic dimensions during the first paint, briefly flashing a
  //      huge icon before the cascade settles).
  const monochrome = wpLogoSvg
    .replace(/<defs>[\s\S]*?<\/defs>/g, "")
    .replace(/\sclass="[^"]*"/g, "")
    .replace(/\sfill="[^"]*"/g, "")
    .replace(/<svg([^>]*)>/, (_match, attrs: string) => {
      const cleaned = attrs
        .replace(/\swidth="[^"]*"/g, "")
        .replace(/\sheight="[^"]*"/g, "");
      return `<svg${cleaned} fill="currentColor">`;
    });
  const doc = new DOMParser().parseFromString(monochrome, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName === "parsererror" || root.nodeName.toLowerCase() !== "svg") return null;
  return document.importNode(root, true) as unknown as SVGElement;
}

/**
 * Inject the WP-tagged button's brand styling. Idempotent via the
 * element-id guard. Three rules:
 *
 *   1. Override the default actionbar `rounded-full` + muted-textonly
 *      with primary-bg + 4px border-radius (LoRA Manager's brand
 *      treatment).
 *   2. Hover ramp uses ComfyUI's `--primary-hover-bg` token so it
 *      stays palette-aware.
 *   3. Force `color: #fff` on the button so the icon's `currentColor`
 *      fill renders as white over the primary-bg fill (otherwise it
 *      inherits the muted-foreground gray and washes out).
 */
function injectStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    button[aria-label="${TOOLTIP}"].${BUTTON_MARKER_CLASS} {
      background-color: var(--primary-bg) !important;
      border: 1px solid transparent;
      border-radius: 4px !important;
      color: #fff !important;
      transition: all 0.2s ease;
    }
    button[aria-label="${TOOLTIP}"].${BUTTON_MARKER_CLASS}:hover {
      background-color: var(--primary-hover-bg) !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Replace the Iconify placeholder `<i>` inside every WP-tagged button
 * with our brand SVG. No inline padding/size on the SVG — ComfyUI's
 * `size-4` (1rem = 16px) class on the icon slot governs sizing so the
 * button stays the same height as its siblings.
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
    fresh.classList.add("wp-brand-icon", "size-5");
    // No explicit width/height — `size-5` (Tailwind 1.25rem = 20px)
    // handles it. Slightly larger than ComfyUI's default `size-4` (16px)
    // because the brand glyph reads better at 20px inside the h-7
    // (28px) button — same effective icon size LoRA Manager ended up
    // with via its `width: 20px; height: 20px` inline override.
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
  injectStyles();
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
    // `primary` modifier carries the LoRA-style primary-bg out of the
    // box. Default size (no padding/dimension overrides) keeps the
    // button at ComfyUI's standard topbar height.
    classList: "comfyui-button comfyui-menu-mobile-collapse primary",
  });

  button.element.setAttribute("aria-label", TOOLTIP);
  button.element.title = TOOLTIP;

  if (button.iconElement) {
    const svg = parseBrandIcon();
    if (svg) {
      svg.classList.add("wp-brand-icon", "size-5");
      // No explicit width/height — `size-5` (Tailwind 1.25rem = 20px).
      // Matches the modern-path icon size for visual parity if a host
      // running both code paths ever displays them side by side.
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
