import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guard against attributes written after a tag's closing `>`.
 *
 * `<div class="x"> data-ai-anchor="search"` is valid markup: Vue renders the
 * attribute as visible text inside the element. Two of these shipped (the
 * list search box and the options table) and showed raw attribute text.
 */
const ROOT = join(__dirname, "..");
const STRAY = />\s*(?:data-[\w-]+|aria-[\w-]+|:[\w-]+|@[\w-]+|v-[\w-]+|class|role|title)="/g;

function vueFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...vueFiles(path));
    else if (name.endsWith(".vue")) out.push(path);
  }
  return out;
}

describe("Vue templates", () => {
  it("have no attributes written as text after a tag", () => {
    const files = vueFiles(ROOT);
    expect(files.length).toBeGreaterThan(50);
    const found: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const start = src.indexOf("<template>");
      const end = src.lastIndexOf("</template>");
      if (start < 0 || end < 0) continue;
      const tpl = src.slice(start, end);
      for (const m of tpl.matchAll(STRAY)) {
        const line = src.slice(0, start + (m.index ?? 0)).split("\n").length;
        found.push(`${relative(ROOT, file)}:${line}`);
      }
    }
    expect(found).toEqual([]);
  });
});
