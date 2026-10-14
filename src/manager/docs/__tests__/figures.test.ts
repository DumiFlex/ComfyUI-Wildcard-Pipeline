import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FIGURE_TEXT } from "../figures";

const PAGES = resolve(__dirname, "../pages");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".vue") ? [p] : [];
  });
}

describe("docs figure descriptions", () => {
  it("every screenshot and diagram on a docs page has a written description", () => {
    const keys = new Set<string>();
    for (const f of files(PAGES)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<DocImage[^>]*?\ssrc="([^"]+)"/g)) keys.add(m[1]!);
      for (const m of src.matchAll(/<Doc(?:Flow|Figure|FigureText)[^>]*?\sfigure="([^"]+)"/g)) keys.add(m[1]!);
      for (const m of src.matchAll(/<(?:DocFlow|DocFigure)(?=[\s>])([^>]*)>/g)) {
        expect(m[1], `${f}: a DocFlow / DocFigure without a figure id`).toMatch(/\sfigure="/);
      }
    }
    expect(keys.size).toBeGreaterThan(30);
    for (const k of keys) {
      expect(FIGURE_TEXT[k], `no description for ${k}`).toBeTruthy();
      expect(FIGURE_TEXT[k]!.length, `${k} is too short to explain the figure`).toBeGreaterThan(120);
    }
    // No stale entries.
    for (const k of Object.keys(FIGURE_TEXT)) expect(keys.has(k), `${k} is not used`).toBe(true);
  });
});
