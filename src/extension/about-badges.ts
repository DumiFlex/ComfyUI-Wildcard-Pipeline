// Single ComfyUI About-panel badge for the extension. Other extensions
// (rgthree-comfy, EasyUse, ComfyUI-Manager, …) follow the convention
// "<extension name> v<version>" with monochrome icons that pick up the
// panel's text color. We mirror that so the row blends with surrounding
// badges instead of standing out as a colored sticker.
//
// The icon slot accepts a CSS class name; PrimeIcons (`pi pi-github`)
// work out of the box but here we register a custom rule that uses our
// favicon SVG as a CSS mask — `background-color: currentColor` then
// fills it with whatever color the panel applies to the icon, so the
// shape stays branded but the tone matches surrounding badges.
//
// Docs: https://docs.comfy.org/custom-nodes/js/javascript_about_panel_badges

// `?raw` returns the file contents as a string — Vite inlines into the
// JS chunk so we don't depend on a runtime asset URL. Stays self-contained.
import wpLogoSvg from "../components/shared/wp-logo.svg?raw";
import pkg from "../../package.json" with { type: "json" };

export interface AboutPageBadge {
  label: string;
  url: string;
  /** CSS class — PrimeIcons or our own. */
  icon: string;
}

const REPO = "https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline";
const ICON_CLASS = "wp-about-badge-icon";
let styleInjected = false;

/**
 * Inject the icon-class rule once. Idempotent — safe to call from main
 * boot even though we only register a single badge today.
 */
function ensureIconStyle(): void {
  if (styleInjected || typeof document === "undefined") return;
  styleInjected = true;
  const dataUri = `url("data:image/svg+xml;utf8,${encodeURIComponent(wpLogoSvg)}")`;
  const style = document.createElement("style");
  style.id = "wp-about-badge-style";
  // mask-image renders the SVG silhouette only; background-color fills
  // it with currentColor so the icon picks up the panel's badge text
  // color and matches the surrounding monochrome icons (pi pi-github,
  // pi pi-discord, etc.). 14px square matches PrimeIcons sizing on the
  // About panel badges. -webkit-* prefixed properties cover Safari /
  // older WebKit which haven't standardized the unprefixed names yet.
  style.textContent = `
    .${ICON_CLASS} {
      display: inline-block;
      width: 14px;
      height: 14px;
      background-color: currentColor;
      mask-image: ${dataUri};
      -webkit-mask-image: ${dataUri};
      mask-size: contain;
      -webkit-mask-size: contain;
      mask-repeat: no-repeat;
      -webkit-mask-repeat: no-repeat;
      mask-position: center;
      -webkit-mask-position: center;
      vertical-align: -2px;
    }
  `;
  document.head.appendChild(style);
}

ensureIconStyle();

export const ABOUT_BADGES: AboutPageBadge[] = [
  {
    label: `Wildcard Pipeline v${pkg.version}`,
    url: REPO,
    icon: ICON_CLASS,
  },
];
