import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Tailwind 4's preflight (`@layer base`) sets padding/margin/border to 0 on
// every element. The kit's `@layer wp-extension` rules (Popover padding …)
// only survive when that layer ranks above `base`, and the rank is fixed by
// the first sheet that names the layer, so layers.css must load first.
const root = resolve(__dirname, "../../..");

describe("manager cascade layer order", () => {
  it("ranks wp-extension above Tailwind's base layer", () => {
    const css = readFileSync(resolve(root, "src/manager/styles/layers.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const order = /@layer\s+([^;{]+);/.exec(css)?.[1]?.split(",").map((s) => s.trim()) ?? [];
    expect(order.indexOf("wp-extension")).toBeGreaterThan(order.indexOf("base"));
    expect(order.indexOf("base")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("wp-extension")).toBeLessThan(order.indexOf("utilities"));
  });

  it("imports layers.css before any other stylesheet in main.ts", () => {
    const main = readFileSync(resolve(root, "src/manager/main.ts"), "utf8");
    const imports = [...main.matchAll(/^import\s+(?:.+\s+from\s+)?["']([^"']+)["'];/gm)].map((m) => m[1] ?? "");
    const firstCss = imports.find((p) => p.endsWith(".css"));
    expect(firstCss).toBe("./styles/layers.css");
  });
});
