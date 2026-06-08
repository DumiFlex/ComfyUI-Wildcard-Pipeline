// Tests for the surface-aware preview-tokens tokenizer. Confirms the
// 5 visible token kinds (VAR / REF / alt / repeat / escape) tokenize
// correctly across all 5 surfaces, and that surface-disallowed kinds
// are flagged with `invalid: true` per the support matrix.

import { describe, it, expect } from "vitest";

import { tokenize, type Surface } from "./preview-tokens";

describe("preview-tokens", () => {
  describe("VAR token", () => {
    it("emits VAR for $name on combine surface (valid)", () => {
      const toks = tokenize("hello $name", "combine");
      expect(toks).toEqual([
        { kind: "text", raw: "hello " },
        { kind: "var", raw: "$name", varName: "name", invalid: false },
      ]);
    });

    it("flags VAR as invalid on wildcard surface", () => {
      const toks = tokenize("$name", "wildcard");
      expect(toks[0]).toMatchObject({ kind: "var", varName: "name", invalid: true });
    });

    it("flags VAR as invalid on fixed_values surface", () => {
      const toks = tokenize("$name", "fixed_values");
      expect(toks[0]).toMatchObject({ kind: "var", varName: "name", invalid: true });
    });

    it("VAR valid on derivation + assembler surfaces", () => {
      expect(tokenize("$x", "derivation")[0]).toMatchObject({ kind: "var", invalid: false });
      expect(tokenize("$x", "assembler")[0]).toMatchObject({ kind: "var", invalid: false });
    });

    it("tokenizes a $mood.0 list accessor as ONE var token with index (SP2a)", () => {
      const toks = tokenize("$mood.0", "combine");
      expect(toks).toHaveLength(1);
      expect(toks[0]).toMatchObject({ kind: "var", varName: "mood", index: 0, raw: "$mood.0" });
    });

    it("bare $mood has no index; $mood.12 captures a multi-digit index (SP2a)", () => {
      expect(tokenize("$mood", "combine")[0].index).toBeUndefined();
      expect(tokenize("$mood.12", "combine")[0]).toMatchObject({ varName: "mood", index: 12 });
    });
  });

  describe("REF token", () => {
    it("emits REF for @{uuid} on wildcard surface (valid)", () => {
      const toks = tokenize("@{abcdef12}", "wildcard");
      expect(toks[0]).toMatchObject({ kind: "ref", refUuid: "abcdef12", invalid: false });
    });

    it("flags REF as invalid on combine surface", () => {
      const toks = tokenize("@{abcdef12}", "combine");
      expect(toks[0]).toMatchObject({ kind: "ref", invalid: true });
    });

    it("flags REF as invalid on fixed_values surface", () => {
      const toks = tokenize("@{abcdef12}", "fixed_values");
      expect(toks[0]).toMatchObject({ kind: "ref", invalid: true });
    });
  });

  describe("DP_BRACE alternation", () => {
    it("emits alt token with branches for {a|b|c}", () => {
      const toks = tokenize("{a|b|c}", "combine");
      expect(toks[0]).toMatchObject({
        kind: "alt",
        branches: ["a", "b", "c"],
      });
    });

    it("does not match single-branch {x} (no pipe)", () => {
      // Engine grammar requires at least one pipe inside DP_BRACE.
      // {x} should fall through as text.
      const toks = tokenize("{x}", "combine");
      expect(toks.find((t) => t.kind === "alt")).toBeUndefined();
    });
  });

  describe("DP_MULTI repeat", () => {
    it("emits repeat token with count + sep + branches", () => {
      const toks = tokenize("{2$$, $$a|b|c}", "combine");
      expect(toks[0]).toMatchObject({
        kind: "repeat",
        count: 2,
        separator: ", ",
        branches: ["a", "b", "c"],
      });
    });
  });

  describe("ESCAPE token", () => {
    it("emits escape token for $$", () => {
      const toks = tokenize("$$", "combine");
      expect(toks[0]).toMatchObject({ kind: "escape", literal: "$" });
    });

    it("emits escape token for @@", () => {
      const toks = tokenize("@@", "combine");
      expect(toks[0]).toMatchObject({ kind: "escape", literal: "@" });
    });

    it("escape takes precedence over VAR/REF detection", () => {
      const toks = tokenize("$$5", "combine");
      expect(toks[0]).toMatchObject({ kind: "escape", literal: "$" });
      expect(toks[1]).toMatchObject({ kind: "text", raw: "5" });
    });
  });

  describe("Mixed input", () => {
    it("tokenizes complex template across all kinds (combine surface)", () => {
      const toks = tokenize(
        "{a|b} $name $$5 @{12345678}",
        "combine",
      );
      const kinds = toks.map((t) => t.kind);
      expect(kinds).toEqual(["alt", "text", "var", "text", "escape", "text", "ref"]);
      // REF on combine surface = invalid
      expect(toks[6]).toMatchObject({ kind: "ref", invalid: true });
      // VAR on combine surface = valid
      expect(toks[2]).toMatchObject({ kind: "var", invalid: false });
    });
  });

  describe("Invalid-only surfaces", () => {
    const surfaces: Surface[] = ["wildcard", "fixed_values"];
    surfaces.forEach((s) => {
      it(`flags VAR invalid on ${s}`, () => {
        const t = tokenize("$x", s)[0];
        expect(t.kind).toBe("var");
        expect(t.invalid).toBe(true);
      });
    });
  });
});
