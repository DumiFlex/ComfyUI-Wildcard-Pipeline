import { describe, expect, it } from "vitest";
import {
  applyConstraint,
  evalDerivation,
  expandInlineChoices,
  expandRefs,
  fillTemplate,
  pickWeightedOption,
  resolveWildcard,
} from "../utils/resolver";
import type {
  ConstraintPayload,
  DerivationPayload,
  ModuleRow,
  WildcardOption,
} from "../api/types";

function makeWildcard(
  name: string,
  options: Array<Partial<WildcardOption> & { value: string; weight: number }>,
  extras: Partial<{ var_binding: string; sub_categories: string[]; id: string }> = {},
): ModuleRow {
  return {
    id: extras.id ?? "aabbccdd",
    type: "wildcard",
    name,
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {
      options: options.map((o, i) => ({
        id: o.id ?? `o${i}`,
        value: o.value,
        weight: o.weight,
        sub_category: o.sub_category ?? null,
      })),
      sub_categories: extras.sub_categories ?? [],
      var_binding: extras.var_binding,
    },
    payload_hash: "0".repeat(64),
    version: 1,
    created_at: "",
    updated_at: "",
  };
}

describe("pickWeightedOption", () => {
  it("returns null for an empty option list", () => {
    expect(pickWeightedOption([])).toBeNull();
  });

  it("returns roughly proportional picks across many trials", () => {
    const opts: WildcardOption[] = [
      { id: "a", value: "a", weight: 10 },
      { id: "b", value: "b", weight: 1 },
    ];
    let aHits = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const p = pickWeightedOption(opts);
      if (p?.value === "a") aHits += 1;
    }
    // Expected ~ 10/11 ≈ 90.9%; tolerate ±5%.
    expect(aHits / N).toBeGreaterThan(0.85);
    expect(aHits / N).toBeLessThan(0.96);
  });

  it("falls back to first when all weights are zero", () => {
    const opts: WildcardOption[] = [
      { id: "a", value: "a", weight: 0 },
      { id: "b", value: "b", weight: 0 },
    ];
    expect(pickWeightedOption(opts)?.value).toBe("a");
  });
});

describe("expandInlineChoices", () => {
  it("expands {a|b|c} to one of the listed branches", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(expandInlineChoices("hello {red|green|blue}"));
    // Should have produced at least two distinct outputs across 50 tries.
    expect(seen.size).toBeGreaterThan(1);
    for (const out of seen) {
      expect(out).toMatch(/^hello (red|green|blue)$/);
    }
  });

  it("supports nested choices by resolving innermost first", () => {
    const out = expandInlineChoices("{outer-{inner1|inner2}|alt}");
    expect(out === "outer-inner1" || out === "outer-inner2" || out === "alt").toBe(true);
  });

  it("leaves single-branch braces unchanged (no |)", () => {
    expect(expandInlineChoices("{just one}")).toBe("{just one}");
  });

  it("returns an empty string unchanged", () => {
    expect(expandInlineChoices("")).toBe("");
  });
});

describe("expandRefs", () => {
  const wcs: ModuleRow[] = [
    makeWildcard("Hair Color", [{ value: "auburn", weight: 1 }], { var_binding: "hair_color" }),
  ];

  it("resolves @var against the provided context", () => {
    expect(expandRefs("the @hair_color hair", { hair_color: "blue" }, wcs)).toBe("the blue hair");
  });

  it("resolves @{var} bracketed form too", () => {
    expect(expandRefs("@{hair_color} ribbon", { hair_color: "violet" }, wcs)).toBe("violet ribbon");
  });

  it("falls back to the wildcard catalog when ctx is missing the key", () => {
    const out = expandRefs("@hair_color", {}, wcs);
    expect(out).toBe("auburn");
  });

  it("returns empty string when ref cannot be resolved", () => {
    expect(expandRefs("@unknown text", {}, wcs)).toBe(" text");
  });

  it("resolves @{8hex_uuid} via byId catalog (canonical form, spec §2.4)", () => {
    // Wildcard's id IS the 8-hex uuid post migration 004 (CLAUDE.md
    // "Module IDs"). The previous lookup walked only `byVar` (var_binding
    // map), so digit-leading uuids didn't even match the regex and a-f
    // uuids matched but resolved to "" silently.
    const colors = makeWildcard(
      "Colors",
      [{ value: "violet", weight: 1 }],
      { id: "12345678", var_binding: "color_palette" },
    );
    expect(expandRefs("ribbon: @{12345678}", {}, [colors])).toBe("ribbon: violet");
  });

  it("resolves nested @{uuid} refs across two hops", () => {
    // Outfit -> Color -> "violet" with both refs in canonical uuid form.
    // Reproduces the bug user reported: nested ref chain silently broke at
    // the SPA test runner because byVar lookup never tried the uuid path.
    const color = makeWildcard(
      "Color",
      [{ value: "violet", weight: 1 }],
      { id: "aaaaaaaa", var_binding: "color" },
    );
    const outfit = makeWildcard(
      "Outfit",
      [{ value: "dress @{aaaaaaaa}", weight: 1 }],
      { id: "bbbbbbbb", var_binding: "outfit" },
    );
    expect(expandRefs("@{bbbbbbbb}", {}, [color, outfit])).toBe("dress violet");
  });
});

describe("resolveWildcard", () => {
  it("expands inline choices and refs together", () => {
    const ctx = { hair_color: "violet" };
    const wcs: ModuleRow[] = [
      makeWildcard("Hair Color", [{ value: "violet", weight: 1 }], { var_binding: "hair_color" }),
    ];
    const outfit = makeWildcard("Outfit", [
      { value: "{linen|cotton} dress in @hair_color", weight: 1 },
    ]);
    for (let i = 0; i < 20; i++) {
      const out = resolveWildcard(outfit, ctx, wcs);
      expect(out).toMatch(/^(linen|cotton) dress in violet$/);
    }
  });

  it("handles plain text with no special syntax", () => {
    const w = makeWildcard("X", [{ value: "plain text", weight: 1 }]);
    expect(resolveWildcard(w, {}, [])).toBe("plain text");
  });

  it("returns empty string when wildcard has no options", () => {
    const w = makeWildcard("X", []);
    expect(resolveWildcard(w, {}, [])).toBe("");
  });
});

describe("fillTemplate", () => {
  it("fills $var from context", () => {
    expect(fillTemplate("Hello $name", { name: "Mira" }, [])).toBe("Hello Mira");
  });

  it("leaves $var as-is when neither context nor wildcard supplies it", () => {
    expect(fillTemplate("Hello $missing", {}, [])).toBe("Hello $missing");
  });
});

describe("applyConstraint", () => {
  it("zeroes excluded options and boosts boosted ones", () => {
    const target = makeWildcard("Outfit", [
      { value: "linen", weight: 2, sub_category: "casual" },
      { value: "tux",   weight: 1, sub_category: "formal" },
    ], { id: "wc_target", sub_categories: ["casual", "formal"] });
    const source = makeWildcard("Weather", [
      { value: "rain", weight: 1, sub_category: "wet" },
    ], { id: "wc_source", sub_categories: ["wet"] });
    const cn: ConstraintPayload = {
      source_wildcard_id: "wc_source",
      target_wildcard_id: "wc_target",
      matrix: { wet: { casual: { mode: "exclude", factor: 1 }, formal: { mode: "boost", factor: 3 } } },
      exceptions: [],
    };
    const out = applyConstraint(cn, "rain", [target, source]);
    const linen = out.find((o) => o.value === "linen");
    const tux = out.find((o) => o.value === "tux");
    expect(linen?.weight).toBe(0);
    expect(linen?._mode).toBe("exclude");
    expect(tux?.weight).toBe(3);
    expect(tux?._mode).toBe("boost");
  });

  it("exception overrides a matrix EXCLUDE — allow exception keeps original weight", () => {
    // Matrix says casual = exclude → weight 0. Exception says
    // (rain, linen) = allow → exception wins, original weight survives.
    const target = makeWildcard("Outfit", [
      { value: "linen", weight: 2, sub_category: "casual" },
    ], { id: "wc_target", sub_categories: ["casual"] });
    const source = makeWildcard("Weather", [
      { value: "rain", weight: 1, sub_category: "wet" },
    ], { id: "wc_source", sub_categories: ["wet"] });
    const cn: ConstraintPayload = {
      source_wildcard_id: "wc_source",
      target_wildcard_id: "wc_target",
      matrix: { wet: { casual: { mode: "exclude", factor: 1 } } },
      exceptions: [{ source: "rain", target: "linen", mode: "allow", factor: 1 }],
    };
    const out = applyConstraint(cn, "rain", [target, source]);
    const linen = out.find((o) => o.value === "linen");
    expect(linen?.weight).toBe(2);
    expect(linen?._mode).toBe("allow");
  });

  it("exception overrides a matrix BOOST — reduce exception applies its own factor", () => {
    const target = makeWildcard("Outfit", [
      { value: "linen", weight: 2, sub_category: "casual" },
    ], { id: "wc_target", sub_categories: ["casual"] });
    const source = makeWildcard("Weather", [
      { value: "rain", weight: 1, sub_category: "wet" },
    ], { id: "wc_source", sub_categories: ["wet"] });
    const cn: ConstraintPayload = {
      source_wildcard_id: "wc_source",
      target_wildcard_id: "wc_target",
      // Matrix wants ×3; exception wants ×0.5 → exception wins.
      matrix: { wet: { casual: { mode: "boost", factor: 3 } } },
      exceptions: [{ source: "rain", target: "linen", mode: "reduce", factor: 0.5 }],
    };
    const out = applyConstraint(cn, "rain", [target, source]);
    const linen = out.find((o) => o.value === "linen");
    expect(linen?.weight).toBe(1); // 2 * 0.5
    expect(linen?._mode).toBe("reduce");
  });

  it("exception with legacy `source_value` / `target_value` keys still wins over matrix", () => {
    // Some library payloads store exceptions under the legacy
    // `source_value` / `target_value` field names (engine accepts both).
    // The SPA test runner must too — otherwise users see exceptions
    // appearing to be ignored when they're actually applied at runtime.
    const target = makeWildcard("Outfit", [
      { value: "linen", weight: 2, sub_category: "casual" },
    ], { id: "wc_target", sub_categories: ["casual"] });
    const source = makeWildcard("Weather", [
      { value: "rain", weight: 1, sub_category: "wet" },
    ], { id: "wc_source", sub_categories: ["wet"] });
    const cn: ConstraintPayload = {
      source_wildcard_id: "wc_source",
      target_wildcard_id: "wc_target",
      matrix: { wet: { casual: { mode: "allow", factor: 1 } } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exceptions: [{ source_value: "rain", target_value: "linen", mode: "exclude", factor: 1 } as any],
    };
    const out = applyConstraint(cn, "rain", [target, source]);
    const linen = out.find((o) => o.value === "linen");
    expect(linen?.weight).toBe(0);
    expect(linen?._mode).toBe("exclude");
  });

  it("exception override only kicks in for the matching (source, target) pair", () => {
    // Two options under the same sub_cat — matrix excludes both; only
    // the specifically-exception'd one survives.
    const target = makeWildcard("Outfit", [
      { value: "linen", weight: 2, sub_category: "casual" },
      { value: "denim", weight: 2, sub_category: "casual" },
    ], { id: "wc_target", sub_categories: ["casual"] });
    const source = makeWildcard("Weather", [
      { value: "rain", weight: 1, sub_category: "wet" },
    ], { id: "wc_source", sub_categories: ["wet"] });
    const cn: ConstraintPayload = {
      source_wildcard_id: "wc_source",
      target_wildcard_id: "wc_target",
      matrix: { wet: { casual: { mode: "exclude", factor: 1 } } },
      exceptions: [{ source: "rain", target: "linen", mode: "allow", factor: 1 }],
    };
    const out = applyConstraint(cn, "rain", [target, source]);
    expect(out.find((o) => o.value === "linen")?.weight).toBe(2);
    expect(out.find((o) => o.value === "denim")?.weight).toBe(0);
  });
});

describe("evalDerivation", () => {
  it("fires the first matching branch and applies its action", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "weather", op: "contains", value: "rain" },
            action: { target_var: "subject", mode: "append", value: "wet" } },
        ],
      }],
    };
    const ctx = { weather: "rainstorm", subject: "girl" };
    const trace = evalDerivation(payload, ctx);
    expect(trace).toHaveLength(1);
    expect(trace[0].fired).toBe("branch");
    expect(ctx.subject).toBe("girl, wet");
  });

  it("falls through to else when no branch matches", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "weather", op: "equals", value: "snow" },
            action: { target_var: "subject", mode: "append", value: "cold" } },
        ],
        else: { action: { target_var: "subject", mode: "append", value: "warm" } },
      }],
    };
    const ctx = { weather: "sun", subject: "girl" };
    const trace = evalDerivation(payload, ctx);
    expect(trace[0].fired).toBe("else");
    expect(ctx.subject).toBe("girl, warm");
  });

  it("skips when no branch matches and no else", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "weather", op: "equals", value: "snow" },
            action: { target_var: "subject", mode: "append", value: "cold" } },
        ],
      }],
    };
    const ctx = { weather: "sun" };
    const trace = evalDerivation(payload, ctx);
    expect(trace[0].fired).toBe("skip");
  });
});

describe("is_empty / is_not_empty operators", () => {
  it("is_empty fires when the var is the empty string", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "color", op: "is_empty", value: "" },
            action: { target_var: "subject", mode: "replace", value: "bare" } },
        ],
      }],
    };
    const ctx = { color: "", subject: "girl" };
    evalDerivation(payload, ctx);
    expect(ctx.subject).toBe("bare");
  });

  it("is_empty does NOT fire when the var has content", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "color", op: "is_empty", value: "" },
            action: { target_var: "subject", mode: "replace", value: "bare" } },
        ],
      }],
    };
    const ctx = { color: "red", subject: "girl" };
    evalDerivation(payload, ctx);
    expect(ctx.subject).toBe("girl");
  });

  it("is_not_empty fires when the var has content", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "color", op: "is_not_empty", value: "" },
            action: { target_var: "subject", mode: "replace", value: "dressed" } },
        ],
      }],
    };
    const ctx = { color: "red", subject: "girl" };
    evalDerivation(payload, ctx);
    expect(ctx.subject).toBe("dressed");
  });

  it("is_not_empty does NOT fire when the var is empty", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "color", op: "is_not_empty", value: "" },
            action: { target_var: "subject", mode: "replace", value: "dressed" } },
        ],
      }],
    };
    const ctx = { color: "", subject: "girl" };
    evalDerivation(payload, ctx);
    expect(ctx.subject).toBe("girl");
  });
});

describe("presence ops (exists / is_set / not_exists / is_unset)", () => {
  it("exists fires when the var key is bound (any value, including empty)", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "color", op: "exists", value: "" },
            action: { target_var: "out", mode: "replace", value: "bound" } },
        ],
      }],
    };
    // Bound with non-empty value → fires.
    let ctx: Record<string, string> = { color: "red" };
    evalDerivation(payload, ctx);
    expect(ctx.out).toBe("bound");

    // Bound with empty string → still fires (null option rolled).
    ctx = { color: "" };
    evalDerivation(payload, ctx);
    expect(ctx.out).toBe("bound");
  });

  it("exists does NOT fire when the key is absent", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "color", op: "exists", value: "" },
            action: { target_var: "out", mode: "replace", value: "bound" } },
        ],
      }],
    };
    const ctx: Record<string, string> = {};
    evalDerivation(payload, ctx);
    expect(ctx.out).toBeUndefined();
  });

  it("is_set fires only when key is bound AND value is non-empty", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "color", op: "is_set", value: "" },
            action: { target_var: "out", mode: "replace", value: "with-value" } },
        ],
      }],
    };
    let ctx: Record<string, string> = { color: "red" };
    evalDerivation(payload, ctx);
    expect(ctx.out).toBe("with-value");

    // Bound but empty (null option) → DOES NOT fire.
    ctx = { color: "" };
    evalDerivation(payload, ctx);
    expect(ctx.out).toBeUndefined();
  });

  it("not_exists fires only when the var key is absent", () => {
    const payload: DerivationPayload = {
      rules: [{
        id: "r1",
        branches: [
          { condition: { var: "color", op: "not_exists", value: "" },
            action: { target_var: "out", mode: "replace", value: "missing" } },
        ],
      }],
    };
    let ctx: Record<string, string> = {};
    evalDerivation(payload, ctx);
    expect(ctx.out).toBe("missing");

    // Bound (even empty) → DOES NOT fire.
    ctx = { color: "" };
    evalDerivation(payload, ctx);
    expect(ctx.out).toBeUndefined();
  });
});

