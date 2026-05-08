// Static regression test for theme.css token parity.
//
// JSDOM doesn't compute CSS so we can't assert resolved `var()` values
// from a mounted component. Instead read the source file and check
// each light-affecting token name is declared BOTH outside the
// `.wp-theme-light` block (dark is the default, comes from `:root`)
// AND inside it. Catches the regression where someone adds a new
// token to one branch but forgets the other — which silently
// degrades the off-branch theme.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const themeCss = readFileSync(
  resolve(__dirname, "./theme.css"),
  "utf8",
);

/** Walk forward from an opening brace counting depth so nested
 *  blocks (media queries, future @container rules) don't confuse the
 *  extractor. Returns the closing-brace index. */
function findMatchingClose(css: string, openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return i - 1;
}

/** Match the `.wp-theme-light` SELECTOR — the trailing `\s*{` ensures
 *  we land on the actual block opening, not a prose reference inside
 *  a comment block. */
const LIGHT_SELECTOR_RE = /\.wp-theme-light\s*\{/;

function findLightBlockBounds(css: string): { open: number; close: number } | null {
  const match = LIGHT_SELECTOR_RE.exec(css);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = findMatchingClose(css, open);
  return { open, close };
}

const bounds = findLightBlockBounds(themeCss);
const lightBlock = bounds ? themeCss.slice(bounds.open + 1, bounds.close) : "";
// Everything OUTSIDE the light block — dark theme defaults can live in
// any of `:root`, `:root, .wp-theme-dark`, or scattered top-level
// declarations. Stripping the light block leaves all of those intact.
const darkBlock = bounds
  ? themeCss.slice(0, bounds.open) + themeCss.slice(bounds.close + 1)
  : themeCss;

/** Tokens that MUST exist in both theme blocks. Visual-affecting
 *  tokens with a meaningful difference between dark and light
 *  surfaces — pure brand tokens (accent colors, kind colors)
 *  intentionally cascade from `:root` and don't need light overrides. */
const PARITY_TOKENS = [
  // Surfaces
  "--wp-bg",
  "--wp-bg2",
  "--wp-bg3",
  "--wp-bg-deep",
  // Text
  "--wp-text",
  "--wp-text2",
  "--wp-text3",
  // Borders
  "--wp-border",
  "--wp-border-soft",
  // Phase 4 additions — shadow + hover + scrollbar + input-shade
  "--wp-shadow-sm",
  "--wp-shadow-md",
  "--wp-shadow-lg",
  "--wp-overlay-bg",
  "--wp-row-hover",
  "--wp-scrollbar-thumb",
  "--wp-input-shade",
  // Status colors — light theme nudges these darker for legibility
  "--wp-warn",
  "--wp-danger",
  "--wp-status-modified",
  "--wp-amber",
  "--wp-red",
  // Canvas + node namespace mirrors ComfyUI chrome per theme
  "--wp-canvas-bg",
  "--wp-node-bg",
  "--wp-node-border",
  "--wp-node-text",
];

describe("theme.css token parity", () => {
  it("light block (.wp-theme-light) is non-empty", () => {
    expect(lightBlock.length).toBeGreaterThan(0);
  });

  for (const token of PARITY_TOKENS) {
    it(`${token} declared in both dark + light blocks`, () => {
      expect(darkBlock).toContain(`${token}:`);
      expect(lightBlock).toContain(`${token}:`);
    });
  }

  it("Phase 4 shadow tokens use lighter alpha values in light theme", () => {
    // Sanity check the light overrides actually dial down the alpha —
    // catches "I copied the dark value into the light block" mistakes.
    const lightShadowLg = lightBlock.match(/--wp-shadow-lg:\s*([^;]+);/);
    expect(lightShadowLg).not.toBeNull();
    // Light shadow uses 0.12 alpha vs dark's 0.5 — assert the literal
    // text contains the lighter alpha so a future edit that copies the
    // dark value into light fails this test.
    expect(lightShadowLg?.[1]).toContain("0.12");
  });

  it("light theme row-hover uses dark tint (not white-on-white)", () => {
    const lightHover = lightBlock.match(/--wp-row-hover:\s*([^;]+);/);
    expect(lightHover).not.toBeNull();
    // Should NOT contain "255" (which would be a white tint from dark
    // theme accidentally copied over). Dark tint uses 15, 15, 30.
    expect(lightHover?.[1]).not.toContain("255");
    expect(lightHover?.[1]).toContain("15");
  });
});
