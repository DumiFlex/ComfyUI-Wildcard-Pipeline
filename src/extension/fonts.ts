// Webfonts (Inter + JetBrains Mono, latin variable axis 100-900) linked at
// extension load.
//
// The @font-face rules live in `src/assets/fonts/wp-fonts.css`, copied verbatim
// into `js/assets/fonts/` by `scripts/copy-fonts.mjs`. This module only points a
// <link> at them; the browser resolves each woff2 URL relative to the
// stylesheet, so there is no path arithmetic here.
//
// WHY NOT AN IMPORT. This file used to do
//   new URL("../assets/fonts/inter-latin.woff2", import.meta.url)
// in the belief that it kept the woff2 as separate assets. It did not — Vite
// ignores `build.assetsInlineLimit` whenever `build.lib` is set and inlines
// every asset unconditionally. Both fonts were base64'd into the chunk: 88,660
// bytes of woff2 became a 118,896-byte JS file, downloaded and parsed as
// JavaScript before ComfyUI could finish registering the extension.
//
// Do NOT turn `CSS_HREF` below back into a string literal. Vite's asset
// transform fires on `new URL(<literal>, import.meta.url)` specifically, and
// making it a literal would silently re-inline the stylesheet — undoing all of
// this with no build error and no test failure.
//
// Trade-off vs. fontsource @import:
//   - Single latin subset only — no cyrillic/greek/vietnamese coverage.
//     If a future module entry uses non-latin glyphs they'll fall back
//     to the system stack, which is acceptable for the dev tool surface.
//   - Variable axis covers every weight from 100..900 in one file each,
//     so we don't pay per-weight asset cost.

/** Built from parts so Vite's `new URL(<literal>, ...)` transform cannot see a
 *  literal path to resolve. See the note above before "simplifying" this. */
const CSS_HREF = ["fonts", "wp-fonts.css"].join("/");

let injected = false;

function ensureFontFaces(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const link = document.createElement("link");
  link.id = "wp-webfonts";
  link.rel = "stylesheet";
  // Resolved against this chunk's own URL — `/extensions/<package>/assets/` —
  // so a renamed install directory still works. Hardcoding the package name
  // would break for anyone who cloned to a different folder name.
  link.href = new URL(CSS_HREF, import.meta.url).href;
  document.head.appendChild(link);
}

ensureFontFaces();
