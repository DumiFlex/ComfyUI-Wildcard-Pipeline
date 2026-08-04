import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { kindIcon, KIND_ICON_MAP } from "./kind-icons";

const require = createRequire(import.meta.url);

/** Glyph names the installed PrimeIcons actually ships. The stylesheet is the
 *  authority; a hard-coded list would go stale on the next upgrade. */
function installedGlyphs(): Set<string> {
  const css = readFileSync(require.resolve("primeicons/primeicons.css"), "utf8");
  return new Set([...css.matchAll(/\.pi-([a-z0-9-]+):before/g)].map((m) => m[1]));
}

describe("kind-icons", () => {
  it("returns the canonical PrimeIcons class for each module kind", () => {
    expect(kindIcon("wildcard")).toBe("pi pi-sparkles");
    expect(kindIcon("fixed_values")).toBe("pi pi-tag");
    expect(kindIcon("combine")).toBe("pi pi-link");
    expect(kindIcon("derivation")).toBe("pi pi-arrow-right-arrow-left");
    expect(kindIcon("constraint")).toBe("pi pi-filter");
    expect(kindIcon("loop")).toBe("pi pi-replay");
    expect(kindIcon("injector")).toBe("pi pi-sign-in");
  });

  it("names only glyphs that exist — a typo renders an empty ring, not an error", () => {
    // How `brush` shipped broken in the icon picker. A kind whose glyph does
    // not exist falls back to nothing visible, which reads as "this kind has
    // no icon" rather than as a mistake, so nobody reports it.
    const have = installedGlyphs();
    expect(have.size).toBeGreaterThan(200);
    const missing = Object.entries(KIND_ICON_MAP)
      .map(([kind, cls]) => [kind, cls.replace(/^pi pi-/, "")] as const)
      .filter(([, glyph]) => !have.has(glyph));
    expect(missing).toEqual([]);
  });

  it("covers every kind a canvas producer can report", () => {
    // `collectUpstreamProducers` emits these three alongside the module kinds;
    // `injector` was absent and every injected $var rendered as a bare circle.
    for (const kind of ["injector", "loop", "wildcard"]) {
      expect(kindIcon(kind)).not.toBe("pi pi-circle");
    }
  });

  it("falls back to a neutral circle icon for unknown kinds", () => {
    // We pass an unknown string explicitly; cast keeps strict TS happy.
    expect(kindIcon("mystery" as unknown as keyof typeof KIND_ICON_MAP)).toBe("pi pi-circle");
  });
});
