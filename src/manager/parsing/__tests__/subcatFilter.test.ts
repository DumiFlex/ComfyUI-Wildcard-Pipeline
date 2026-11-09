import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { parse, matches, readsAs, validateExpression, bindVars, exprVariables } from "../subcatFilter";

// Read the shared Python/TS fixture from the repo root (cwd when vitest runs).
interface Case {
  expr: string;
  valid: boolean;
  reads_as?: string;
  matches?: Record<string, boolean>;
  error?: string;
}
const cases: Case[] = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "tests/fixtures/subcat_filter_cases.json"), "utf8"),
);
// Superset of every tag used by the valid fixture cases (mirror of Python KNOWN).
const KNOWN = new Set(["warm", "cold", "red", "pink", "green", "blue"]);

describe("subcatFilter parity (shared fixture)", () => {
  for (const c of cases) {
    it(`case: ${c.expr || "(empty)"}`, () => {
      // Route every case through the validator: covers both the syntax layer
      // (parse) and the semantic layer (reserved / unknown sub-category).
      const err = validateExpression(c.expr, KNOWN);
      if (!c.valid) {
        expect(err).not.toBeNull();
        expect(err!.toLowerCase()).toContain(c.error!);
        return;
      }
      expect(err).toBeNull();
      const ast = parse(c.expr);
      expect(readsAs(ast)).toBe(c.reads_as);
      for (const [k, want] of Object.entries(c.matches ?? {})) {
        expect(matches(ast, new Set(k.split(",")))).toBe(want);
      }
    });
  }
});

interface BindCase {
  expr: string;
  tags: string[];
  groups: Record<string, string[]>;
  values: Record<string, string[] | null>;
  reads_as: string;
  notes: string[];
  matches: Record<string, boolean>;
}
const bindCases: BindCase[] = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "tests/fixtures/subcat_filter_bind_cases.json"), "utf8"),
);

describe("subcatFilter bindVars parity (shared fixture)", () => {
  for (const c of bindCases) {
    it(`bind: ${c.expr} with ${JSON.stringify(c.values)}`, () => {
      const { ast, notes } = bindVars(parse(c.expr), (n) => c.values[n], c.tags, c.groups);
      expect(readsAs(ast)).toBe(c.reads_as);
      expect(notes.map((n) => n.reason)).toEqual(c.notes);
      for (const [k, want] of Object.entries(c.matches)) {
        expect(matches(ast, new Set(k ? k.split(",") : []))).toBe(want);
      }
    });
  }

  it("exprVariables lists $terms and ignores a malformed filter", () => {
    expect(exprVariables("$a and not ($b or c)")).toEqual(["a", "b"]);
    expect(exprVariables("warm")).toEqual([]);
    expect(exprVariables("$a and (")).toEqual([]);
  });
});
