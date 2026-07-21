import { describe, expect, it } from "vitest";
import {
  validateSubcatName,
  validateRefGrammarName,
  validateVariableName,
  isValidVariableName,
} from "../../validation/names";

describe("validation/names", () => {
  describe("validateSubcatName (re-exported engine-parity rule)", () => {
    it("accepts a clean tag", () => {
      expect(validateSubcatName("warm")).toBeNull();
    });
    it("rejects whitespace", () => {
      expect(validateSubcatName("warm tone")).toMatch(/whitespace/i);
    });
    it("rejects a reserved word", () => {
      expect(validateSubcatName("null")).toBeTruthy();
    });
    it("rejects a disallowed char", () => {
      expect(validateSubcatName("a,b")).toBeTruthy();
    });
  });

  describe("validateRefGrammarName", () => {
    it("allows spaces (display names)", () => {
      expect(validateRefGrammarName("My Wildcard")).toBeNull();
    });
    it("rejects each reserved ref-grammar char", () => {
      for (const c of ["{", "}", ":", "#", "@", ","]) {
        expect(validateRefGrammarName(`a${c}b`)).toContain(c);
      }
    });
  });

  describe("variable name", () => {
    it("accepts a valid identifier", () => {
      expect(isValidVariableName("my_var2")).toBe(true);
      expect(validateVariableName("my_var2")).toBeNull();
    });
    it("rejects spaces / leading digit / empty", () => {
      expect(isValidVariableName("my var")).toBe(false);
      expect(validateVariableName("my var")).toMatch(/letters, digits/i);
      expect(isValidVariableName("2fast")).toBe(false);
      expect(isValidVariableName("")).toBe(false);
    });
  });
});
