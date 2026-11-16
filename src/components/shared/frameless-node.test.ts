import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* The frameless rules override the Nodes 2.0 card, whose markup changes
   between frontends. Guard the pieces each frontend needs. */
const css = readFileSync(resolve(__dirname, "frameless-node.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
}

describe("frameless-node.css", () => {
  it("clears the 1.57 card: background, border, box shadow", () => {
    const r = rule(".lg-node:has(.wp-frameless) {");
    expect(r).toContain("background: transparent !important");
    expect(r).toContain("box-shadow: none !important");
  });

  it("clears the 1.58 card: drop-shadow filter, node body background and padding, badge row", () => {
    expect(rule(".lg-node:has(.wp-frameless) { filter")).toContain("filter: none !important");
    const body = rule('.lg-node:has(.wp-frameless) [data-testid^="node-body-"] {');
    expect(body).toContain("background: transparent !important");
    expect(body).toContain("padding: 0 !important");
    expect(rule('[data-testid^="node-body-"] > .mt-auto')).toContain("display: none !important");
  });

  it("stays in the extension layer", () => {
    expect(css.trim().startsWith("@layer wp-extension {")).toBe(true);
  });
});
