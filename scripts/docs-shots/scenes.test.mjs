// The scenes pick nodes out of the example workflows by id. When an example
// is rebuilt its ids move, and the shoot then fails (or pins the wrong node)
// only on someone's PC. This checks the ids here instead.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCENES } from "./scenes.mjs";

const FILES = { one: "1 - One image.json", grids: "2 - Batches and grids.json", pick: "3 - Pick and refine.json" };
const root = join(import.meta.dirname, "..", "..", "example_workflows");

function types(from) {
  const wf = JSON.parse(readFileSync(join(root, FILES[from]), "utf8"));
  return new Map(wf.nodes.map((n) => [Number(n.id), n.type]));
}

describe("docs-shot scenes", () => {
  for (const scene of SCENES.filter((s) => s.from)) {
    it(`${scene.image} uses ids that exist in "${scene.from}"`, () => {
      const nodes = types(scene.from);
      const src = scene.build.toString();
      const kept = (src.match(/S\.only\(\[([^\]]*)\]\)/)?.[1] ?? "")
        .split(",").map((x) => x.trim()).filter(Boolean)
        .map((x) => (x.startsWith("a.") ? scene.arg[x.slice(2)] : Number(x)));
      expect(kept.length).toBeGreaterThan(0);
      for (const id of kept) expect(nodes.has(id), `node ${id}`).toBe(true);
      const ret = src.match(/return (a\.id|\d+);\s*}\s*$/)?.[1];
      if (ret && scene.node) {
        const id = ret === "a.id" ? scene.arg.id : Number(ret);
        expect(nodes.get(id)).toBe(scene.node);
      }
    });
  }
});
