// Webfonts (Inter + JetBrains Mono, latin variable axis 100-900) injected
// at extension load. We side-step `cssInjectedByJsPlugin`'s URL-inlining
// behavior by wiring the @font-face rules in JS — `new URL(path,
// import.meta.url)` keeps woff2 files as separate assets (NOT
// base64-inlined into the JS chunk) and resolves the URL at runtime
// relative to the loaded module's location, which ComfyUI serves at
// `/extensions/wildcard-pipeline/assets/...`.
//
// Trade-off vs. fontsource @import:
//   - Single latin subset only — no cyrillic/greek/vietnamese coverage.
//     If a future module entry uses non-latin glyphs they'll fall back
//     to the system stack, which is acceptable for the dev tool surface.
//   - Variable axis covers every weight from 100..900 in one file each,
//     so we don't pay per-weight asset cost.

const interUrl = new URL("../assets/fonts/inter-latin.woff2", import.meta.url).href;
const jetBrainsMonoUrl = new URL("../assets/fonts/jetbrains-mono-latin.woff2", import.meta.url).href;

let injected = false;

function ensureFontFaces(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.id = "wp-webfonts";
  // font-display: swap renders the system stack first then re-paints when
  // the woff2 lands — avoids invisible text during the 100–300ms fetch on
  // first load. font-weight `100 900` is the variable axis range.
  style.textContent = `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${interUrl}) format('woff2-variations'),
           url(${interUrl}) format('woff2');
    }
    @font-face {
      font-family: 'JetBrains Mono';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${jetBrainsMonoUrl}) format('woff2-variations'),
           url(${jetBrainsMonoUrl}) format('woff2');
    }
  `;
  document.head.appendChild(style);
}

ensureFontFaces();
