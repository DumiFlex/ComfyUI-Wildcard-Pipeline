// Wildcard Pipeline topbar/toolbar button — opens the manager SPA at
// `/wp/dashboard` in a new tab. Code path is a near-verbatim copy of
// ComfyUI-Lora-Manager's `top_menu_extension.js` so the rendered
// button is visually identical to LoRA Manager's.
//
// Two render paths, picked by ComfyUI frontend version:
//
//   - Frontend ≥ 1.33.9 → `actionBarButtons` extension property.
//     ComfyUI's Vue actionbar renders our entry inside the rounded
//     `actionbar-container` next to LoRA Manager's button. We swap
//     the icon + inline styles via a `requestAnimationFrame` loop
//     once Vue has mounted the button.
//   - Frontend  < 1.33.9 → legacy direct attach: build a `ComfyButton`
//     via `/scripts/ui/components/{button,buttonGroup}.js` and insert
//     before `app.menu.settingsGroup` (or after LoRA Manager's group
//     if it's there).
//
// One intentional delta from LoRA Manager: the SVG string is parsed
// through DOMParser instead of `innerHTML = ...` because the
// project's pre-tool security hook flags raw innerHTML writes.
// Outcome is identical (same DOM tree under the button) — just a
// safer construction path.
//
// Belt-and-suspenders: also register `commands` + `menuCommands` for
// the topbar dropdown so the SPA stays reachable even when
// `app.menu.settingsGroup` isn't there (older ComfyUI builds, headless
// hosts, etc.).

import wpLogoSvg from "../components/shared/wp-logo.svg?raw";

const SPA_PATH = "/wp/dashboard";
const TOOLTIP = "Launch Wildcard Pipeline (Shift+Click opens in new window)";
const POPUP_FEATURES = "width=1280,height=900,resizable=yes,scrollbars=yes,status=yes";
const BUTTON_GROUP_CLASS = "wp-top-menu-group";
const BUTTON_CLASS = "wp-top-menu-button";
const STYLE_ELEMENT_ID = "wp-top-menu-button-styles";
const LORA_GROUP_SELECTOR = ".lora-manager-top-menu-group";

// Frontend version threshold for the new actionBarButtons API. LoRA
// Manager uses the same threshold — versions below ship a different
// menu shell where the actionbar-container doesn't exist.
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
 *  zeros and stripping pre-release suffixes. Mirrors LoRA Manager's
 *  `parseVersion` exactly so any version-comparison drift between the
 *  two extensions stays at zero. */
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
 * Strip the bundled brand SVG down to a flat-white glyph and parse it
 * into a real SVGElement. Each call returns a fresh node, because we
 * re-run the icon swap (mirroring LoRA Manager's `replaceButtonIcon`
 * rAF loop) and the same node can't live in two places.
 *
 * Why explicit `#fff` and not `currentColor`: the actionBar button's
 * surrounding Vue classes set `text-muted-foreground` (a low-contrast
 * grey) on the button. With `fill="currentColor"` our paths inherited
 * that grey and looked washed out next to LoRA Manager's saturated
 * multi-color logo. Hard-coding white forces the icon to stay white
 * regardless of the parent's text color, matching the brightness of
 * LoRA Manager's icon (which uses its own per-path `#D3E2E7`/`#1B3F68`
 * fills and likewise doesn't depend on text color).
 *
 * Returns null on a malformed parse — caller handles by leaving the
 * placeholder ComfyButton mdi class in place.
 */
function parseBrandIcon(): SVGElement | null {
  if (typeof DOMParser === "undefined") return null;
  const monochrome = wpLogoSvg
    .replace(/<defs>[\s\S]*?<\/defs>/g, "")
    .replace(/\sclass="[^"]*"/g, "")
    .replace(/\sfill="[^"]*"/g, "")
    .replace(/<svg([^>]*)>/, '<svg$1 fill="#fff">');
  const doc = new DOMParser().parseFromString(monochrome, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName === "parsererror" || root.nodeName.toLowerCase() !== "svg") return null;
  return document.importNode(root, true) as unknown as SVGElement;
}

/** Inject the hover/transition style block. Idempotent via the element
 *  id guard. Mirrors LoRA Manager's `lm-top-menu-button-styles` rule
 *  set 1:1, just with our aria-label selector + class name. */
function injectStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    button[aria-label="${TOOLTIP}"].${BUTTON_CLASS} {
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }
    button[aria-label="${TOOLTIP}"].${BUTTON_CLASS}:hover {
      background-color: var(--primary-hover-bg) !important;
    }
  `;
  document.head.appendChild(style);
}

/** Apply the brand SVG + LoRA-Manager-matching inline styles to every
 *  button matching our aria-label currently in the DOM. Used by both
 *  the actionBar and legacy paths.
 *
 *  Returns the number of buttons it touched so the caller can decide
 *  whether to keep polling (button not yet mounted) or stop. */
function applyButtonStyles(): number {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    `button[aria-label="${TOOLTIP}"]`,
  );
  buttons.forEach((btn) => {
    btn.classList.add(BUTTON_CLASS);
    const fresh = parseBrandIcon();
    if (fresh) btn.replaceChildren(fresh);
    btn.style.borderRadius = "4px";
    btn.style.padding = "6px";
    btn.style.backgroundColor = "var(--primary-bg)";
    const innerSvg = btn.querySelector("svg");
    if (innerSvg) {
      innerSvg.style.width = "20px";
      innerSvg.style.height = "20px";
    }
  });
  return buttons.length;
}

/**
 * Drive the post-mount icon swap loop. Used by both paths — the
 * actionBar path needs it because Vue mounts the button asynchronously
 * (the rAF tick gives us the moment after first paint), and the
 * legacy path needs it because `comfyui-button.primary` may apply
 * child layout that the construction-time iconElement swap doesn't
 * fully tame.
 *
 * Loop terminates the first frame at least one matching button is
 * found AND has been processed. Re-applies styles too — a defensive
 * second-pass in case Vue's mount cycle reset the inline values.
 */
export function startIconReplaceLoop(): void {
  if (typeof document === "undefined") return;
  injectStyles();
  const tick = (): void => {
    const touched = applyButtonStyles();
    if (touched === 0) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

/**
 * Legacy direct-attach path for ComfyUI < 1.33.9. Mirrors LoRA
 * Manager's `attachTopMenuButton`: build a `ComfyButton` via the
 * runtime-served core JS, wrap it in a `ComfyButtonGroup`, attach to
 * the topbar before `settingsGroup` (or after LoRA's group if
 * present).
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
    classList: "comfyui-button comfyui-menu-mobile-collapse primary",
  });

  button.element.setAttribute("aria-label", TOOLTIP);
  button.element.title = TOOLTIP;

  if (button.iconElement) {
    const svg = parseBrandIcon();
    if (svg) button.iconElement.replaceChildren(svg);
    button.iconElement.style.width = "1.2rem";
    button.iconElement.style.height = "1.2rem";
  }

  button.element.addEventListener("click", openSpa as EventListener);

  const group = new groupMod.ComfyButtonGroup(button.element);
  group.element.classList.add(BUTTON_GROUP_CLASS);

  // Adjacent to LoRA Manager when present, else before-settings.
  const loraGroup = document.querySelector(LORA_GROUP_SELECTOR);
  if (loraGroup && loraGroup.parentElement) {
    loraGroup.after(group.element);
  } else {
    settingsGroup.element.before(group.element);
  }
}

// `actionBarButtons` — modern extension API path for ComfyUI ≥ 1.33.9.
// ComfyUI's Vue actionbar renders our entry inside the rounded
// `actionbar-container` next to LoRA Manager's button (extensions are
// rendered in registration order, so installation order determines
// left-to-right). The icon string is an Iconify class that ComfyUI's
// Vue button component turns into a placeholder `<i>`; we swap it for
// our brand SVG via `startIconReplaceLoop` once Vue has mounted the
// element.
export const ACTION_BAR_BUTTONS = [
  {
    icon: "icon-[mdi--puzzle-outline] size-4",
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
