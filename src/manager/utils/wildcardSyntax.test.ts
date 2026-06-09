import { describe, it, expect } from "vitest";
import { getWildcardSyntax, buildWildcardGraph } from "./wildcardSyntax";
import type { ModuleRow } from "../api/types";

/** Minimal wildcard ModuleRow with the given option value strings. */
function wc(id: string, name: string, values: string[]): ModuleRow {
  return {
    id,
    type: "wildcard",
    name,
    payload: {
      options: values.map((v, i) => ({ id: `opt${i}`, value: v, weight: 1 })),
    },
  } as unknown as ModuleRow;
}

describe("wildcardSyntax — refs nested inside brace/multi blocks (SP2b)", () => {
  it("detects a @{uuid} ref nested inside a {N$$sep$$…} multi-pick block", () => {
    const flags = getWildcardSyntax(wc("aaaaaaaa", "wolf", ["wolf {3$$, $$@{ad00acd5}}"]));
    expect(flags.hasRefs).toBe(true);
    expect(flags.refTargets).toContain("ad00acd5");
  });

  it("detects a @{uuid} ref nested inside a plain {a|@{uuid}} alternation", () => {
    const flags = getWildcardSyntax(wc("bbbbbbbb", "x", ["{warm|@{ad00acd5}}"]));
    expect(flags.refTargets).toContain("ad00acd5");
  });

  it("still flags a plain top-level @{uuid} ref (no regression)", () => {
    const flags = getWildcardSyntax(wc("cccccccc", "y", ["hair @{ad00acd5} tone"]));
    expect(flags.hasRefs).toBe(true);
    expect(flags.refTargets).toContain("ad00acd5");
  });

  it("reports no refs for a block with only literal arms", () => {
    expect(getWildcardSyntax(wc("dddddddd", "z", ["{red|blue|green}"])).hasRefs).toBe(false);
  });

  it("builds an incoming graph edge for a ref nested in a multi block (referenced-by)", () => {
    const src = wc("aaaaaaaa", "wolf", ["{3$$, $$@{ad00acd5}}"]);
    const tgt = wc("ad00acd5", "mood", ["serene"]);
    const g = buildWildcardGraph([src, tgt]);
    expect(g.incoming.get("ad00acd5")?.has("aaaaaaaa")).toBe(true);
    expect(g.outgoing.get("aaaaaaaa")?.has("ad00acd5")).toBe(true);
  });
});
