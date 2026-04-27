import { describe, expect, it } from "vitest";
import {
  buildWildcardGraph,
  getWildcardSyntax,
  wildcardVarName,
} from "../utils/wildcardSyntax";
import type { ModuleRow, WildcardOption } from "../api/types";

function wc(
  partial: Partial<ModuleRow> & {
    name: string;
    id?: string;
    options?: WildcardOption[];
    var_binding?: string | undefined;
  },
): ModuleRow {
  const opts = partial.options ?? [];
  const payload: Record<string, unknown> = { options: opts, sub_categories: [] };
  if ("var_binding" in partial) {
    if (partial.var_binding !== undefined) payload.var_binding = partial.var_binding;
  } else {
    payload.var_binding = partial.name;
  }
  return {
    id: partial.id ?? `wc_${partial.name}`,
    type: "wildcard",
    name: partial.name,
    description: partial.description ?? "",
    category_id: partial.category_id ?? null,
    tags: partial.tags ?? [],
    is_favorite: partial.is_favorite ?? false,
    payload,
    version: partial.version ?? 1,
    created_at: partial.created_at ?? "",
    updated_at: partial.updated_at ?? "",
  };
}

function opt(value: string, weight = 1, id = "o1"): WildcardOption {
  return { id, value, weight };
}

describe("getWildcardSyntax", () => {
  it("flags no refs / no inline for a plain string", () => {
    const m = wc({ name: "color", options: [opt("red"), opt("blue")] });
    const sx = getWildcardSyntax(m);
    expect(sx.hasRefs).toBe(false);
    expect(sx.hasInline).toBe(false);
    expect(sx.refTargets).toEqual([]);
  });

  it("detects @ref tokens in option values", () => {
    const m = wc({
      name: "outfit",
      options: [opt("a @hat"), opt("a @shoes and a @hat"), opt("plain")],
    });
    const sx = getWildcardSyntax(m);
    expect(sx.hasRefs).toBe(true);
    // dedupes targets across options
    expect(sx.refTargets.sort()).toEqual(["hat", "shoes"]);
  });

  it("ignores @@ literal escapes", () => {
    const m = wc({ name: "msg", options: [opt("email me at name@@host")] });
    const sx = getWildcardSyntax(m);
    expect(sx.hasRefs).toBe(false);
  });

  it("detects inline {a|b|c} choice blocks", () => {
    const m = wc({ name: "tone", options: [opt("look {happy|sad|angry}")] });
    const sx = getWildcardSyntax(m);
    expect(sx.hasInline).toBe(true);
  });

  it("does not flag inline for a brace block with no pipes", () => {
    const m = wc({ name: "blank", options: [opt("nothing here {literal}")] });
    expect(getWildcardSyntax(m).hasInline).toBe(false);
  });
});

describe("buildWildcardGraph", () => {
  it("creates bidirectional edges between two wildcards that reference each other", () => {
    const a = wc({ name: "alpha", var_binding: "alpha", options: [opt("see @beta")] });
    const b = wc({ name: "beta", var_binding: "beta", options: [opt("see @alpha")] });
    const g = buildWildcardGraph([a, b]);
    expect(g.outgoing.get("alpha")).toEqual(new Set(["beta"]));
    expect(g.outgoing.get("beta")).toEqual(new Set(["alpha"]));
    expect(g.incoming.get("alpha")).toEqual(new Set(["beta"]));
    expect(g.incoming.get("beta")).toEqual(new Set(["alpha"]));
  });

  it("yields empty edge sets for a wildcard with no references", () => {
    const a = wc({ name: "lonely", var_binding: "lonely", options: [opt("just text")] });
    const g = buildWildcardGraph([a]);
    expect(g.outgoing.get("lonely")?.size ?? -1).toBe(0);
    expect(g.incoming.get("lonely")?.size ?? -1).toBe(0);
  });

  it("drops dangling @ref targets that don't resolve to a known wildcard", () => {
    const a = wc({ name: "alpha", var_binding: "alpha", options: [opt("@ghost or @beta")] });
    const b = wc({ name: "beta", var_binding: "beta", options: [opt("plain")] });
    const g = buildWildcardGraph([a, b]);
    expect(g.outgoing.get("alpha")).toEqual(new Set(["beta"]));
    expect(g.incoming.get("ghost")).toBeUndefined();
  });

  it("falls back to slug(name) when var_binding is missing", () => {
    const m = wc({ name: "Hat Color", var_binding: undefined, options: [] });
    expect(wildcardVarName(m)).toBe("hat_color");
  });
});
