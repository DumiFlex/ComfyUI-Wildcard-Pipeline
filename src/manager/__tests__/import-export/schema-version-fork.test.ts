import { describe, it, expect } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  MAX_KNOWN_SCHEMA_VERSION,
  FALLBACK_SCHEMA_VERSION,
} from "@/manager/import-export/migrations";
import { MAX_KNOWN_SCHEMA_VERSION as MAX_KNOWN_VIA_INSTALL } from "@/manager/import-export/install";
import { schemaVersionForPayload } from "@/manager/import-export/single-row-publish";

/**
 * Pins the deliberate fork between the two schema constants (see
 * `docs/superpowers/specs/2026-06-14-schema-gate-max-known-version-design.md`):
 *
 *   - CURRENT_SCHEMA_VERSION = 2  — head of the migration chain (v2→v3
 *     through v8→v9 are no-ops, so the chain genuinely stops at 2).
 *   - MAX_KNOWN_SCHEMA_VERSION = 9 — highest version this runtime can READ +
 *     WRITE; the value advertised to the community publish-gate / boot
 *     catalog-probe.
 *
 * The community gate predicate is `hostSchema < minCompatible` where
 * `minCompatible = max(breaking versions) = 3`. Advertising CURRENT (2)
 * fails the gate (`2 < 3`); advertising MAX_KNOWN (9) clears it.
 */
describe("schema-version fork: MAX_KNOWN vs CURRENT", () => {
  it("CURRENT_SCHEMA_VERSION is the migration-chain head (2)", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
  });

  it("MAX_KNOWN_SCHEMA_VERSION is the support ceiling (9)", () => {
    expect(MAX_KNOWN_SCHEMA_VERSION).toBe(9);
  });

  it("the ceiling is strictly above the chain head (the whole point of the fork)", () => {
    expect(MAX_KNOWN_SCHEMA_VERSION).toBeGreaterThan(CURRENT_SCHEMA_VERSION);
  });

  it("MAX_KNOWN reaches the bridge via the install.ts re-export (same path as CURRENT)", () => {
    // main.ts imports the advertised constant from `./import-export/install`,
    // not migrations.ts directly — so the value the host bridge advertises is
    // whatever install.ts re-exports. Pin that it is MAX_KNOWN, identical to
    // the source-of-truth constant.
    expect(MAX_KNOWN_VIA_INSTALL).toBe(MAX_KNOWN_SCHEMA_VERSION);
    expect(MAX_KNOWN_VIA_INSTALL).toBe(9);
  });

  it("a plain v2-content payload still stamps at the chain head (unchanged)", () => {
    // No SP2b grammar, no target_select reach → content version is the
    // baseline. The fork must not perturb content stamping.
    expect(schemaVersionForPayload({ template: "a {red|blue} c" })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
  });

  it("drift-guard: MAX_KNOWN covers the highest version schemaVersionForPayload can stamp", () => {
    // Build a payload exercising the highest feature the runtime knows how to
    // content-stamp today: a bundle holding a wildcard with a fallback option
    // next to a derivation with an AND / OR group and an "Add to negative"
    // action → stamps FALLBACK_SCHEMA_VERSION (9).
    const highestFeaturePayload = { children: [{
      id: "wc-001abc",
      type: "wildcard",
      payload: { var_binding: "w", options: [{ id: "o1", value: "x", fallback: true }] },
    }, {
      id: "dv-001abc",
      type: "derivation",
      payload: {
        rules: [{
          id: "r1",
          branches: [{
            condition: {
              match: "all",
              conditions: [
                { var: "a", op: "equals", value: "1" },
                { var: "b", op: "equals", value: "2" },
              ],
            },
            action: { target_var: "c", mode: "negative", value: "3" },
          }],
        }],
      },
    }] };
    const stamped = schemaVersionForPayload(highestFeaturePayload);
    expect(stamped).toBe(FALLBACK_SCHEMA_VERSION);

    // The mechanical maintenance contract from the spec: if someone teaches
    // schemaVersionForPayload a higher stamp without bumping MAX_KNOWN, update
    // `highestFeaturePayload` above to exercise it — this assertion then fails
    // until MAX_KNOWN_SCHEMA_VERSION is bumped to match.
    expect(MAX_KNOWN_SCHEMA_VERSION).toBeGreaterThanOrEqual(stamped);
  });
});
