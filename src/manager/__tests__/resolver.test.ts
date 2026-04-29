import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyConstraint,
  evalDerivation,
  expandInlineChoices,
  expandRefs,
  fillTemplate,
  pickWeightedOption,
  resolveWildcard,
  runStep,
} from "../utils/resolver";
import type {
  ConstraintPayload,
  DerivationPayload,
  ModuleRow,
  PipelineStep,
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

describe("runStep", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0.0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a wildcard step and writes its $var binding into ctx", () => {
    const w = makeWildcard("Hair Color", [{ value: "auburn", weight: 1 }], { var_binding: "hair_color" });
    const step: PipelineStep = { id: "s1", module_id: w.id, enabled: true };
    const ctx: Record<string, string> = {};
    const out = runStep(step, [w], ctx);
    expect(out.kind).toBe("wildcard");
    expect(ctx.hair_color).toBe("auburn");
  });

  it("runs a fixed_values step writing every binding into ctx", () => {
    const f: ModuleRow = {
      id: "aabbccdd", type: "fixed_values", name: "Pack",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { values: [{ var: "city", value: "Tokyo" }, { name: "$ward", value: "Shibuya" }] },
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    };
    const step: PipelineStep = { id: "s1", module_id: f.id, enabled: true };
    const ctx: Record<string, string> = {};
    runStep(step, [f], ctx);
    expect(ctx).toEqual({ city: "Tokyo", ward: "Shibuya" });
  });

  it("returns a missing trace when module_id is unknown", () => {
    const step: PipelineStep = { id: "s1", module_id: "nope", enabled: true };
    const out = runStep(step, [], {});
    expect(out.kind).toBe("missing");
  });

  it("respects enabled=false and emits a skipped note", () => {
    const w = makeWildcard("X", [{ value: "v", weight: 1 }]);
    const step: PipelineStep = { id: "s1", module_id: w.id, enabled: false };
    const ctx: Record<string, string> = {};
    const out = runStep(step, [w], ctx);
    expect(out.note).toMatch(/skipped/);
    expect(ctx).toEqual({});
  });
});
