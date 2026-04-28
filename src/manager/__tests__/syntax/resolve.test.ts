import { describe, expect, it } from "vitest";
import {
  resolveTokens,
  type ResolveContext,
  type ResolveModule,
  UnknownRefError,
  RefOutOfSurfaceError,
} from "../../utils/resolveTokens";
import { mulberry32 } from "./_rng-helper";

function makeCtx(opts: Partial<ResolveContext> = {}): ResolveContext {
  return {
    rng: mulberry32(opts.rngSeed ?? 42),
    maxRefDepth: 8,
    strict: false,
    surface: "wildcard",
    developerMode: false,
    warnings: [],
    vars: {},
    modules: {},
    ...opts,
  } as ResolveContext;
}

describe("resolveTokens — text/escape/var", () => {
  it("empty input returns empty string", () => {
    expect(resolveTokens("", makeCtx())).toBe("");
  });

  it("plain text passthrough", () => {
    expect(resolveTokens("hello world", makeCtx())).toBe("hello world");
  });

  it("escape sequences resolve to literals", () => {
    expect(resolveTokens("price: $$5", makeCtx())).toBe("price: $5");
    expect(resolveTokens("user@@host", makeCtx())).toBe("user@host");
  });

  it("var resolves from ctx.vars", () => {
    const ctx = makeCtx({ vars: { color: "red" } });
    expect(resolveTokens("$color thing", ctx)).toBe("red thing");
  });

  it("missing var emits empty string", () => {
    expect(resolveTokens("$missing thing", makeCtx())).toBe(" thing");
  });
});

describe("resolveTokens — ref", () => {
  const wcModule = (_uuid: string, varBinding: string, options: Array<{ value: string; weight: number }> = [{ value: "default", weight: 1 }]): ResolveModule => ({
    type: "wildcard",
    var_binding: varBinding,
    options,
  });

  it("ref in wildcard surface picks an option", () => {
    const ctx = makeCtx({
      modules: { a4f7b2e1: wcModule("a4f7b2e1", "color", [{ value: "red", weight: 1 }]) },
    });
    expect(resolveTokens("@{a4f7b2e1}", ctx)).toBe("red");
  });

  it("unknown ref strict raises", () => {
    expect(() => resolveTokens("@{00000000}", makeCtx({ strict: true }))).toThrow(UnknownRefError);
  });

  it("unknown ref lenient emits empty + warning", () => {
    const ctx = makeCtx({ strict: false });
    const out = resolveTokens("a @{00000000} b", ctx);
    expect(out).toBe("a  b");
    expect(ctx.warnings.find((w) => w.type === "unknown_ref")).toBeDefined();
  });

  it("ref out of surface lenient emits empty", () => {
    const ctx = makeCtx({
      surface: "combine",
      modules: { a4f7b2e1: wcModule("a4f7b2e1", "color") },
    });
    expect(resolveTokens("a @{a4f7b2e1} b", ctx)).toBe("a  b");
    expect(ctx.warnings.find((w) => w.type === "ref_out_of_surface")).toBeDefined();
  });

  it("ref out of surface strict raises", () => {
    const ctx = makeCtx({
      surface: "combine",
      strict: true,
      modules: { a4f7b2e1: wcModule("a4f7b2e1", "color") },
    });
    expect(() => resolveTokens("@{a4f7b2e1}", ctx)).toThrow(RefOutOfSurfaceError);
  });

  it("cycle detected lenient emits empty + warning", () => {
    const ctx = makeCtx({
      modules: {
        a0000001: wcModule("a0000001", "a", [{ value: "@{b0000002}", weight: 1 }]),
        b0000002: wcModule("b0000002", "b", [{ value: "@{a0000001}", weight: 1 }]),
      },
    });
    expect(resolveTokens("@{a0000001}", ctx)).toBe("");
    expect(ctx.warnings.find((w) => w.type === "cycle_detected")).toBeDefined();
  });
});

describe("resolveTokens — inline + multi-pick", () => {
  it("inline pick returns one of branches", () => {
    const out = resolveTokens("{a|b|c}", makeCtx());
    expect(["a", "b", "c"]).toContain(out);
  });

  it("multi-pick zero count empty", () => {
    expect(resolveTokens("{0$$, $$a|b|c}", makeCtx())).toBe("");
  });

  it("multi-pick returns joined picks", () => {
    const out = resolveTokens("{2$$, $$a|b|c|d}", makeCtx());
    const parts = out.split(", ");
    expect(parts.length).toBe(2);
    parts.forEach((p) => expect(["a", "b", "c", "d"]).toContain(p));
  });

  it("multi-pick clamps when N > branches", () => {
    const out = resolveTokens("{5$$, $$a|b|c}", makeCtx());
    expect(out.split(", ").length).toBe(3);
  });
});
