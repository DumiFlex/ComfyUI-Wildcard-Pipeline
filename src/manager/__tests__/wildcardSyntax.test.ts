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
    id: partial.id ?? "aabbccdd",
    type: "wildcard",
    name: partial.name,
    description: partial.description ?? "",
    category_id: partial.category_id ?? null,
    tags: partial.tags ?? [],
    is_favorite: partial.is_favorite ?? false,
    payload,
    payload_hash: partial.payload_hash ?? "0".repeat(64),
    version: partial.version ?? 1,
    created_at: partial.created_at ?? "",
    updated_at: partial.updated_at ?? "",
  };
}

function opt(value: string, weight = 1, id = "o1"): WildcardOption {
  return { id, value, weight, sub_categories: [] };
}

describe("getWildcardSyntax", () => {
  it("flags no refs / no inline for a plain string", () => {
    const m = wc({ name: "color", options: [opt("red"), opt("blue")] });
    const sx = getWildcardSyntax(m);
    expect(sx.hasRefs).toBe(false);
    expect(sx.hasInline).toBe(false);
    expect(sx.refTargets).toEqual([]);
  });

  it("detects @{uuid} ref tokens in option values", () => {
    // Use @{8hex} UUID form — the only form tokeniseRich recognises as ref.
    const hatId = "aabbccdd";
    const shoesId = "11223344";
    const m = wc({
      name: "outfit",
      options: [
        opt(`a @{${hatId}}`),
        opt(`a @{${shoesId}} and a @{${hatId}}`),
        opt("plain"),
      ],
    });
    const sx = getWildcardSyntax(m);
    expect(sx.hasRefs).toBe(true);
    // dedupes UUID targets across options
    expect(sx.refTargets.sort()).toEqual([hatId, shoesId].sort());
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
  // Post DB migration 004 every module's `id` IS the canonical 8-hex
  // uuid the tokenizer's `@{8hex}` ref captures. Fixtures use the
  // bare 8-hex form directly — no slug prefix.
  it("creates bidirectional UUID edges between two wildcards that reference each other", () => {
    const a = wc({ id: "aaaaaaaa", name: "alpha", var_binding: "alpha", options: [opt("see @{bbbbbbbb}")] });
    const b = wc({ id: "bbbbbbbb", name: "beta",  var_binding: "beta",  options: [opt("see @{aaaaaaaa}")] });
    const g = buildWildcardGraph([a, b]);
    expect(g.outgoing.get("aaaaaaaa")).toEqual(new Set(["bbbbbbbb"]));
    expect(g.outgoing.get("bbbbbbbb")).toEqual(new Set(["aaaaaaaa"]));
    expect(g.incoming.get("aaaaaaaa")).toEqual(new Set(["bbbbbbbb"]));
    expect(g.incoming.get("bbbbbbbb")).toEqual(new Set(["aaaaaaaa"]));
  });

  it("populates uuidToName from var_binding", () => {
    const a = wc({ id: "aaaaaaaa", name: "alpha", var_binding: "alpha", options: [] });
    const g = buildWildcardGraph([a]);
    expect(g.uuidToName.get("aaaaaaaa")).toBe("alpha");
  });

  it("yields empty edge sets for a wildcard with no references", () => {
    const a = wc({ id: "cccccccc", name: "lonely", var_binding: "lonely", options: [opt("just text")] });
    const g = buildWildcardGraph([a]);
    expect(g.outgoing.get("cccccccc")?.size ?? -1).toBe(0);
    expect(g.incoming.get("cccccccc")?.size ?? -1).toBe(0);
  });

  it("drops dangling @{uuid} refs that don't resolve to a known wildcard", () => {
    // `ddddddd1` is not in the module list — should be dropped.
    const a = wc({ id: "aaaaaaaa", name: "alpha", var_binding: "alpha", options: [opt("@{ddddddd1} or @{bbbbbbbb}")] });
    const b = wc({ id: "bbbbbbbb", name: "beta",  var_binding: "beta",  options: [opt("plain")] });
    const g = buildWildcardGraph([a, b]);
    expect(g.outgoing.get("aaaaaaaa")).toEqual(new Set(["bbbbbbbb"]));
    expect(g.incoming.get("ddddddd1")).toBeUndefined();
  });

  it("falls back to slug(name) when var_binding is missing", () => {
    const m = wc({ name: "Hat Color", var_binding: undefined, options: [] });
    expect(wildcardVarName(m)).toBe("hat_color");
  });
});
