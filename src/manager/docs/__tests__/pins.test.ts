import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NODE_FIELDS } from "../node-fields";
import { PIN_GAP, PIN_SETS, fieldFor, firstSentence, numberedPins } from "../pins";

const ROOT = resolve(__dirname, "../../../..");
const NODE_PAGES = resolve(__dirname, "../pages/nodes");

describe("node picture pins", () => {
  const sets = Object.values(PIN_SETS);

  it("has a pin set for every annotated picture", () => {
    const srcs = readdirSync(NODE_PAGES).flatMap((f) =>
      [...readFileSync(join(NODE_PAGES, f), "utf8").matchAll(/<DocAnnotated[^>]*?\ssrc="([^"]+)"/g)].map((m) => m[1] ?? ""),
    );
    expect(srcs.length).toBeGreaterThan(15);
    for (const src of srcs) expect(PIN_SETS[src.replace(/^\/+/, "")], `no pins for ${src}`).toBeTruthy();
  });

  it("points every pin at a field of a real node, inside a picture that exists", () => {
    expect(sets.length).toBeGreaterThan(15);
    for (const set of sets) {
      expect(NODE_FIELDS, `${set.image}: unknown node ${set.node}`).toHaveProperty(set.node);
      expect(existsSync(join(ROOT, "public", set.image)), `${set.image} is missing`).toBe(true);
      expect(set.pins.length).toBeGreaterThan(0);
      for (const p of set.pins) {
        expect(fieldFor(set.node, p), `${set.image}: ${p.group} › ${p.term} is not a field`).not.toBeNull();
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never pins one field twice on a picture", () => {
    for (const set of sets) {
      const keys = set.pins.map((p) => `${p.group}/${p.term}`);
      expect(new Set(keys).size, set.image).toBe(keys.length);
    }
  });

  it("numbers pins top to bottom, then left to right", () => {
    const pins = numberedPins("images/docs/wp-toggles.png");
    expect(pins.map((p) => p.n)).toEqual(pins.map((_, i) => i + 1));
    for (let i = 1; i < pins.length; i++) {
      const [a, b] = [pins[i - 1], pins[i]];
      if (!a || !b) continue;
      const rowA = Math.round(a.y * 24), rowB = Math.round(b.y * 24);
      expect(rowA < rowB || (rowA === rowB && a.x <= b.x)).toBe(true);
    }
    expect(numberedPins("/images/docs/wp-toggles.png")).toHaveLength(pins.length);
    expect(numberedPins("images/docs/nope.png")).toEqual([]);
  });

  it("takes the first sentence for the legend", () => {
    expect(firstSentence("Runs once. Then stops.")).toBe("Runs once.");
    expect(firstSentence("  No full stop  ")).toBe("No full stop");
    expect(firstSentence("v1.2 is kept. Rest.")).toBe("v1.2 is kept.");
  });
});

describe("pin spacing", () => {
  it("keeps every pin clear of the others on every picture", () => {
    for (const set of Object.values(PIN_SETS)) {
      const pins = numberedPins(set.image, 0.5);
      for (const a of pins) for (const b of pins) {
        if (a.n >= b.n) continue;
        expect(Math.hypot(a.x - b.x, (a.y - b.y) * 0.5), `${set.image}: pins ${a.n} and ${b.n}`).toBeGreaterThanOrEqual(PIN_GAP - 1e-6);
      }
    }
  });
});
