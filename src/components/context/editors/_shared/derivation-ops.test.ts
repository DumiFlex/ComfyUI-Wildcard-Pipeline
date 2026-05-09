// Derivation ops registry — single source of truth for the SPA editor's
// op dropdown labels, tooltips, operator-specific placeholders, and the
// "value-disabled" set. Keeps the engine's `_VALID_OPS` in sync with the
// frontend by enumerating both in one place. No Vue dep — plain TS so
// engine cross-checks (future) can import without a Vue runtime.

import { describe, it, expect } from "vitest";

import {
  DERIVATION_OPS,
  OP_LABELS,
  OP_TOOLTIPS,
  OP_PLACEHOLDERS,
  VALUE_DISABLED_OPS,
  type DerivationOp,
} from "./derivation-ops";

describe("derivation-ops registry", () => {
  it("DERIVATION_OPS lists exactly the 8 ops in spec'd order", () => {
    expect(DERIVATION_OPS).toEqual([
      "equals",
      "not_equals",
      "contains",
      "matches",
      "exists",
      "not_exists",
      "is_set",
      "is_unset",
    ]);
  });

  it("OP_LABELS provides a display string for every op", () => {
    for (const op of DERIVATION_OPS) {
      expect(typeof OP_LABELS[op]).toBe("string");
      expect(OP_LABELS[op].length).toBeGreaterThan(0);
    }
  });

  it("OP_TOOLTIPS provides semantic tooltip text for every op", () => {
    for (const op of DERIVATION_OPS) {
      expect(typeof OP_TOOLTIPS[op]).toBe("string");
      expect(OP_TOOLTIPS[op].length).toBeGreaterThan(8);
    }
    // matches op should reference regex / regex101 conceptually — used
    // by the matches-specific help affordance in the editor.
    expect(OP_TOOLTIPS.matches.toLowerCase()).toMatch(/regex|re\.search|regex101/);
  });

  it("OP_PLACEHOLDERS provides operator-specific placeholders for compare ops", () => {
    // Compare ops need real example placeholders so the user knows what
    // shape of input is expected.
    expect(OP_PLACEHOLDERS.equals).toBeTruthy();
    expect(OP_PLACEHOLDERS.contains).toBeTruthy();
    expect(OP_PLACEHOLDERS.matches).toBeTruthy();
    expect(OP_PLACEHOLDERS.matches).toMatch(/[\^.*$]/); // regex-shaped
  });

  it("VALUE_DISABLED_OPS contains exactly the 4 presence-check ops", () => {
    expect(VALUE_DISABLED_OPS).toEqual(
      new Set<DerivationOp>(["exists", "not_exists", "is_set", "is_unset"]),
    );
  });

  it("VALUE_DISABLED_OPS does NOT include compare ops", () => {
    for (const op of ["equals", "not_equals", "contains", "matches"] as const) {
      expect(VALUE_DISABLED_OPS.has(op)).toBe(false);
    }
  });
});
