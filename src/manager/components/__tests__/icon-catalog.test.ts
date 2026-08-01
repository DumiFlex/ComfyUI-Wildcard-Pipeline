import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ICON_GROUPS, allCuratedIcons } from "../icon-catalog";

/**
 * Guard against offering a glyph PrimeIcons doesn't have.
 *
 * A bad name doesn't throw and doesn't warn — `<i class="pi pi-brush">` just
 * renders an empty box, which reads as a broken grid cell rather than a typo.
 * `brush` shipped that way. The authority is the installed stylesheet, so this
 * parses it rather than hard-coding a name list that would itself go stale.
 */
const require = createRequire(import.meta.url);

function installedGlyphs(): Set<string> {
  const cssPath = require.resolve("primeicons/primeicons.css");
  const css = readFileSync(cssPath, "utf8");
  return new Set([...css.matchAll(/\.pi-([a-z0-9-]+):before/g)].map((m) => m[1]));
}

describe("icon-catalog", () => {
  it("offers only glyphs that exist in the installed PrimeIcons", () => {
    const have = installedGlyphs();
    // Sanity: if the parse broke, every name would "fail" for the wrong reason.
    expect(have.size).toBeGreaterThan(200);
    const missing = allCuratedIcons().filter((name) => !have.has(name));
    expect(missing).toEqual([]);
  });

  it("stores names without the `pi-` prefix, which is what the engine holds", () => {
    for (const name of allCuratedIcons()) {
      expect(name.startsWith("pi-")).toBe(false);
      expect(name.startsWith("pi ")).toBe(false);
    }
  });

  it("has no duplicate glyph across groups", () => {
    const all = allCuratedIcons();
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps every group a full row of 8, so the grid has no ragged gap", () => {
    for (const g of ICON_GROUPS) {
      expect(g.icons.length % 8).toBe(0);
    }
  });
});
