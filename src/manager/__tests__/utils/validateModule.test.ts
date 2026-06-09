import { describe, expect, it } from "vitest";

import type { BundleRow, ModuleRow } from "../../api/types";
import {
  validateBundle,
  validateModule,
  worstSeverity,
} from "../../utils/validateModule";

function mkWildcard(
  id: string,
  name: string,
  payload: Record<string, unknown> = {},
): ModuleRow {
  return {
    id, name, type: "wildcard",
    description: "", category_id: null, tags: [], is_favorite: false,
    payload, payload_hash: "0".repeat(64),
    version: 1, created_at: "", updated_at: "",
  };
}
function mkConstraint(id: string, name: string, payload: Record<string, unknown>): ModuleRow {
  return {
    id, name, type: "constraint",
    description: "", category_id: null, tags: [], is_favorite: false,
    payload, payload_hash: "0".repeat(64),
    version: 1, created_at: "", updated_at: "",
  };
}
function mkDerivation(id: string, name: string, rules: unknown[]): ModuleRow {
  return {
    id, name, type: "derivation",
    description: "", category_id: null, tags: [], is_favorite: false,
    payload: { rules }, payload_hash: "0".repeat(64),
    version: 1, created_at: "", updated_at: "",
  };
}

describe("validateModule - wildcards", () => {
  it("flags empty options array as warn", () => {
    const row = mkWildcard("aaaaaaaa", "w", { options: [], sub_categories: [] });
    const issues = validateModule(row, [row]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warn");
    expect(issues[0].message).toMatch(/no options/i);
  });

  it("returns empty issues for a wildcard with valid options", () => {
    const row = mkWildcard("aaaaaaaa", "w", {
      options: [{ id: "o1", value: "red", weight: 1 }],
      sub_categories: [],
    });
    expect(validateModule(row, [row])).toEqual([]);
  });

  it("flags broken @{uuid} ref as error", () => {
    const row = mkWildcard("aaaaaaaa", "src", {
      options: [{ id: "o1", value: "uses @{deadbeef}", weight: 1 }],
      sub_categories: [],
    });
    const issues = validateModule(row, [row]);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toMatch(/missing ref/);
  });

  it("flags @{uuid:subcat} when subcat does not exist on target", () => {
    const target = mkWildcard("bbbbbbbb", "mood", {
      options: [], sub_categories: ["positive"],
    });
    const referrer = mkWildcard("aaaaaaaa", "ref", {
      options: [{ id: "o1", value: "uses @{bbbbbbbb:notreal}", weight: 1 }],
      sub_categories: [],
    });
    const issues = validateModule(referrer, [target, referrer]);
    expect(issues.some((i) => i.message.includes("notreal"))).toBe(true);
  });

  it("flags an unknown tag inside a v2 boolean ref filter", () => {
    // SP1: `:warm or intense!null` is a boolean expression, not a single
    // sub-category named "warm or intense!null". The validator must parse
    // the expression and check each *tag*: `warm` is fine, `intense` is not
    // a sub-category of mood, and the trailing `!null` marker is not a tag.
    const target = mkWildcard("bbbbbbbb", "mood", {
      options: [], sub_categories: ["warm"],
    });
    const referrer = mkWildcard("aaaaaaaa", "ref", {
      options: [{ id: "o1", value: "uses @{bbbbbbbb:warm or intense!null}", weight: 1 }],
      sub_categories: [],
    });
    const issues = validateModule(referrer, [target, referrer]);
    expect(
      issues.some((i) => i.message.includes("Unknown sub-category: 'intense'")),
    ).toBe(true);
  });

  it("accepts a valid v2 boolean ref filter and ignores the !null marker", () => {
    const target = mkWildcard("bbbbbbbb", "mood", {
      options: [], sub_categories: ["warm", "intense"],
    });
    const referrer = mkWildcard("aaaaaaaa", "ref", {
      options: [{ id: "o1", value: "uses @{bbbbbbbb:warm or intense!null}", weight: 1 }],
      sub_categories: [],
    });
    expect(validateModule(referrer, [target, referrer])).toEqual([]);
  });
});

describe("validateModule - constraints", () => {
  it("flags missing source wildcard as error", () => {
    const con = mkConstraint("cccccccc", "c", {
      source_wildcard_id: null,
      target_wildcard_id: "bbbbbbbb",
      matrix: {},
      exceptions: [],
    });
    const tgt = mkWildcard("bbbbbbbb", "tgt", { options: [], sub_categories: [] });
    const issues = validateModule(con, [con, tgt]);
    expect(issues.some((i) => i.severity === "error" && /source/i.test(i.message))).toBe(true);
  });

  it("flags deleted target wildcard as error", () => {
    const con = mkConstraint("cccccccc", "c", {
      source_wildcard_id: "aaaaaaaa",
      target_wildcard_id: "ghostidd",
      matrix: {},
      exceptions: [],
    });
    const src = mkWildcard("aaaaaaaa", "src", { options: [], sub_categories: [] });
    const issues = validateModule(con, [con, src]);
    expect(issues.some((i) => i.severity === "error" && /target.*deleted/i.test(i.message))).toBe(true);
  });

  it("valid when source + target both exist", () => {
    const src = mkWildcard("aaaaaaaa", "src", {
      options: [], sub_categories: ["a"],
    });
    const tgt = mkWildcard("bbbbbbbb", "tgt", {
      options: [], sub_categories: ["b"],
    });
    const con = mkConstraint("cccccccc", "c", {
      source_wildcard_id: "aaaaaaaa",
      target_wildcard_id: "bbbbbbbb",
      matrix: { a: { b: { mode: "allow", factor: 1 } } },
      exceptions: [],
    });
    expect(validateModule(con, [src, tgt, con])).toEqual([]);
  });
});

describe("validateModule - inline brace syntax", () => {
  it("does not flag $ tokens inside {a|b|c} inline blocks as unbound vars", () => {
    // `{leather|wool}` is an inline-choice block; nothing inside is a
    // `$var` ref. Validator pre-fix incorrectly extracted `$silver`,
    // `$gold`, `$pearl` from `{2$$, $$silver|gold|pearl}` and warned
    // each as unbound.
    const row = mkWildcard("aaaaaaaa", "outfit", {
      sub_categories: [],
      options: [
        { id: "o1", value: "{leather|wool} jacket over", weight: 1 },
        { id: "o2", value: "{2$$, $$silver|gold|pearl} jewelry", weight: 1 },
      ],
    });
    const issues = validateModule(row, [row]);
    const unboundVars = issues.filter((i) => /not bound/i.test(i.message));
    expect(unboundVars).toEqual([]);
  });

  it("still flags top-level $var refs that are unbound", () => {
    const row = mkWildcard("aaaaaaaa", "ref", {
      sub_categories: [],
      options: [{ id: "o1", value: "uses $ghost", weight: 1 }],
    });
    const issues = validateModule(row, [row]);
    expect(issues.some((i) => /\$ghost/.test(i.message))).toBe(true);
  });

  it("treats $colors.0 (SP2a accessor) as a reference to the bound $colors var", () => {
    // The list accessor must validate against the BASE var name — not flag
    // `colors.0` as an unbound variable.
    const producer = mkWildcard("aaaaaaaa", "colors", {
      sub_categories: [], options: [], var_binding: "colors",
    });
    const referrer = mkWildcard("bbbbbbbb", "ref", {
      sub_categories: [],
      options: [{ id: "o1", value: "uses $colors.0 here", weight: 1 }],
    });
    const issues = validateModule(referrer, [producer, referrer]);
    expect(issues.some((i) => /not bound/i.test(i.message))).toBe(false);
  });
});

describe("validateModule - derivations", () => {
  it("treats $mood.0 (SP2a accessor) as a reference to the bound $mood var", () => {
    // The derivation condition `var: "mood.0"` must validate against the
    // BASE var `mood` (bound by the producer wildcard), not a phantom
    // `mood.0` binding that would wrongly read as "not bound".
    const producer = mkWildcard("aaaaaaaa", "mood", {
      sub_categories: [], options: [], var_binding: "mood",
    });
    const deriv = mkDerivation("bbbbbbbb", "d", [{
      id: "r1",
      branches: [{
        condition: { var: "mood.0", op: "equals", value: "calm" },
        action: { target_var: "tone", mode: "replace", value: "x" },
      }],
    }]);
    const issues = validateModule(deriv, [producer, deriv]);
    expect(issues.some((i) => /not bound/i.test(i.message))).toBe(false);
  });

  it("still flags an unbound derivation condition var carrying an accessor", () => {
    const deriv = mkDerivation("bbbbbbbb", "d", [{
      id: "r1",
      branches: [{
        condition: { var: "ghost.0", op: "equals", value: "x" },
        action: { target_var: "tone", mode: "replace", value: "y" },
      }],
    }]);
    const issues = validateModule(deriv, [deriv]);
    // Base name `ghost` is unbound -> warns, and the message shows the raw
    // accessor the user typed.
    expect(issues.some((i) => /\$ghost\.0 not bound/.test(i.message))).toBe(true);
  });
});

describe("validateModule - variable name grammar", () => {
  // A produced var name must be a clean identifier (letters/digits/underscore,
  // no leading digit) — anything else can never be referenced as `$name`
  // (the tokenizer + the editor's settle delimiters `,;:/(){}[]!?`+space all
  // break on it). The editors block it at input; this is the catch-all that
  // also flags bad names arriving via import / embed override / legacy data.
  function mkCombine(id: string, payload: Record<string, unknown>): ModuleRow {
    return {
      id, name: "c", type: "combine",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload, payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    };
  }
  function mkFixed(id: string, values: unknown[]): ModuleRow {
    return {
      id, name: "f", type: "fixed_values",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { values }, payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    };
  }

  it("combine: flags output_var containing a comma as error", () => {
    const row = mkCombine("aaaaaaaa", { template: "$x", output_var: "scene,bad" });
    const issues = validateModule(row, [row]);
    expect(issues.some((i) => i.severity === "error" && /not a valid name/i.test(i.message))).toBe(true);
  });

  it("combine: a clean output_var raises no name-grammar error", () => {
    const row = mkCombine("aaaaaaaa", { template: "portrait", output_var: "scene" });
    const issues = validateModule(row, [row]);
    expect(issues.some((i) => /not a valid name/i.test(i.message))).toBe(false);
  });

  it("combine: empty output_var stays a single 'missing' warn, no grammar error", () => {
    const row = mkCombine("aaaaaaaa", { template: "portrait", output_var: "" });
    const issues = validateModule(row, [row]);
    expect(issues.some((i) => /not a valid name/i.test(i.message))).toBe(false);
    expect(issues.some((i) => i.severity === "warn" && /missing/i.test(i.message))).toBe(true);
  });

  it("combine: flags a leading-digit output_var as error", () => {
    const row = mkCombine("aaaaaaaa", { template: "x", output_var: "3scene" });
    const issues = validateModule(row, [row]);
    expect(issues.some((i) => i.severity === "error" && /not a valid name/i.test(i.message))).toBe(true);
  });

  it("wildcard: flags var_binding containing punctuation as error", () => {
    const row = mkWildcard("aaaaaaaa", "w", {
      options: [{ id: "o1", value: "red", weight: 1 }],
      sub_categories: [], var_binding: "mood;bad",
    });
    const issues = validateModule(row, [row]);
    expect(issues.some((i) => i.severity === "error" && /not a valid name/i.test(i.message))).toBe(true);
  });

  it("fixed_values: flags a value name containing a comma as error", () => {
    const row = mkFixed("aaaaaaaa", [{ id: "v1", name: "col,or", value: "red" }]);
    const issues = validateModule(row, [row]);
    expect(issues.some((i) => i.severity === "error" && /not a valid name/i.test(i.message))).toBe(true);
  });

  it("fixed_values: a clean value name raises no grammar error", () => {
    const row = mkFixed("aaaaaaaa", [{ id: "v1", name: "color", value: "red" }]);
    const issues = validateModule(row, [row]);
    expect(issues.some((i) => /not a valid name/i.test(i.message))).toBe(false);
  });
});

describe("validateBundle", () => {
  it("flags bundle with no children as warn", () => {
    const b: BundleRow = {
      id: "bbbbbbbb", name: "empty",
      description: "", category_id: null, tags: [], is_favorite: false, color: null,
      children:[], payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    };
    const issues = validateBundle(b, []);
    expect(issues.some((i) => i.severity === "warn")).toBe(true);
  });

  it("recognises nested bundle children when bundles map is passed", () => {
    const inner: BundleRow = {
      id: "innerbun", name: "inner",
      description: "", category_id: null, tags: [], is_favorite: false, color: null,
      children: [], payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    };
    const outer: BundleRow = {
      id: "outerbun", name: "outer",
      description: "", category_id: null, tags: [], is_favorite: false, color: null,
      children: [{ id: "innerbun", type: "bundle" }],
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    };
    // Without bundles arg: inner gets flagged as missing module.
    expect(validateBundle(outer, []).some((i) => i.severity === "error")).toBe(true);
    // With bundles arg: inner resolves.
    expect(validateBundle(outer, [], [inner])).toEqual([]);
  });

  it("flags missing child module as error", () => {
    const b: BundleRow = {
      id: "bbbbbbbb", name: "b",
      description: "", category_id: null, tags: [], is_favorite: false, color: null,
      children:[{ id: "deleted0", type: "module" }],
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    };
    const issues = validateBundle(b, []);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });
});

describe("worstSeverity", () => {
  it("returns null for empty list", () => {
    expect(worstSeverity([])).toBeNull();
  });
  it("returns error when any issue is an error", () => {
    expect(worstSeverity([
      { severity: "warn", message: "w" },
      { severity: "error", message: "e" },
    ])).toBe("error");
  });
  it("returns warn when all issues are warns", () => {
    expect(worstSeverity([
      { severity: "warn", message: "a" },
      { severity: "warn", message: "b" },
    ])).toBe("warn");
  });
});
