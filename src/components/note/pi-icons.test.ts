import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { PI_ICONS } from "./pi-icons";

const require = createRequire(import.meta.url);

describe("PI_ICONS", () => {
  it("is every glyph in the installed primeicons.css", () => {
    const css = readFileSync(require.resolve("primeicons/primeicons.css"), "utf8");
    const have = [...new Set([...css.matchAll(/\.pi-([a-z0-9-]+):before/g)].map((m) => m[1]))].sort();
    expect(have.length).toBeGreaterThan(200);
    expect([...PI_ICONS]).toEqual(have);
  });
});
