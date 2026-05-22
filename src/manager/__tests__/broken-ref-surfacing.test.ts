/**
 * Task 21 — broken-ref discovery after a successful import.
 *
 * The function under test walks committed wildcard option values and
 * constraint source/target ids; anything not present in the local
 * library id set becomes a ResolveWarning the surfacing layer feeds
 * into the manager's warning store.
 *
 * Coverage:
 *   - per-option @{id} walking (incl. position / source_field shape)
 *   - clean-library no-emit path
 *   - constraint source-side break
 *   - constraint target-side break (both broken sides = 2 warnings)
 *   - id field convention (no .uuid leakage from old plan body)
 *   - constraint payload nesting convention
 *   - defensive shape guards (missing options, non-string opt.value)
 */
import { describe, expect, it } from "vitest";
import {
  discoverBrokenRefsForImport,
  type ImportedConstraint,
  type ImportedWildcard,
} from "../import-export/broken-refs";
import type { ResolveWarning } from "../utils/resolveTokens";

function bySourceField(field: string) {
  return (w: ResolveWarning) => w.source_field === field;
}

describe("discoverBrokenRefsForImport — wildcard option refs", () => {
  it("emits one warning per dangling @{id} in wildcard options", () => {
    const wildcards: ImportedWildcard[] = [
      {
        id: "aaaa1111",
        options: [{ value: "see @{deadbeef} now", weight: 1 }],
      },
      {
        id: "aaaa2222",
        options: [{ value: "plain text no refs", weight: 1 }],
      },
    ];
    const warnings = discoverBrokenRefsForImport(wildcards, [], new Set());
    expect(warnings).toHaveLength(1);
    expect(warnings).toEqual([
      {
        type: "broken_ref_on_import",
        severity: "warn",
        module_id: "aaaa1111",
        source_field: "options[0].value",
        // Position points at the start of the @{ token within "see @{...".
        position: "see ".length,
        token_index: null,
        detail: { target_id: "deadbeef" },
        message: "Reference @{deadbeef} not found in library",
      },
    ]);
  });

  it("emits zero warnings when every ref resolves against the library", () => {
    const wildcards: ImportedWildcard[] = [
      {
        id: "aaaa1111",
        options: [{ value: "see @{deadbeef} now", weight: 1 }],
      },
    ];
    const library = new Set<string>(["deadbeef"]);
    const warnings = discoverBrokenRefsForImport(wildcards, [], library);
    expect(warnings).toEqual([]);
  });
});

describe("discoverBrokenRefsForImport — constraint refs", () => {
  it("emits warning for broken constraint source while target resolves", () => {
    const constraints: ImportedConstraint[] = [
      {
        id: "cccc1111",
        payload: {
          source_wildcard_id: "missing0",
          target_wildcard_id: "present0",
        },
      },
    ];
    const library = new Set<string>(["present0"]);
    const warnings = discoverBrokenRefsForImport([], constraints, library);
    expect(warnings).toHaveLength(1);
    expect(warnings).toEqual([
      {
        type: "broken_ref_on_import",
        severity: "warn",
        module_id: "cccc1111",
        source_field: "payload.source_wildcard_id",
        position: 0,
        token_index: null,
        detail: { target_id: "missing0" },
        message: "Reference @{missing0} not found in library",
      },
    ]);
  });

  it("emits 2 warnings when both source and target are missing", () => {
    const constraints: ImportedConstraint[] = [
      {
        id: "cccc1111",
        payload: {
          source_wildcard_id: "missing1",
          target_wildcard_id: "missing2",
        },
      },
    ];
    const warnings = discoverBrokenRefsForImport([], constraints, new Set());
    expect(warnings).toHaveLength(2);
    const sourceWarn = warnings.find(bySourceField("payload.source_wildcard_id"));
    const targetWarn = warnings.find(bySourceField("payload.target_wildcard_id"));
    expect(sourceWarn?.detail).toEqual({ target_id: "missing1" });
    expect(sourceWarn?.module_id).toBe("cccc1111");
    expect(targetWarn?.detail).toEqual({ target_id: "missing2" });
    expect(targetWarn?.module_id).toBe("cccc1111");
  });
});

describe("discoverBrokenRefsForImport — field-shape conventions", () => {
  // Entity key convention (Task 17 alignment): every imported entity is
  // keyed by `id`, never `uuid`. The fixture below uses `id` exclusively;
  // a regression that re-introduced `.uuid` reads would surface here as
  // module_id becoming empty/undefined.
  it("uses `id` for module attribution (no `uuid` reads)", () => {
    const wildcards: ImportedWildcard[] = [
      { id: "ffff8888", options: [{ value: "@{cafebabe}", weight: 1 }] },
    ];
    const warnings = discoverBrokenRefsForImport(wildcards, [], new Set());
    expect(warnings).toHaveLength(1);
    expect(warnings.map((w) => w.module_id)).toEqual(["ffff8888"]);
  });

  // Constraint payload nesting (Task 17 alignment): source/target ids
  // live under `payload.source_wildcard_id` / `payload.target_wildcard_id`,
  // not at the top level under `source_uuid`. The fixture below proves
  // the walker reads from the nested shape; a regression that reverted
  // to top-level `source_uuid` reads would yield zero warnings here.
  it("reads constraint refs from nested payload.{source,target}_wildcard_id", () => {
    const constraints: ImportedConstraint[] = [
      {
        id: "cccc2222",
        payload: {
          source_wildcard_id: "missing1",
          target_wildcard_id: "missing2",
        },
      },
    ];
    const warnings = discoverBrokenRefsForImport([], constraints, new Set());
    // Both refs missing → 2 warnings. If the walker were reading from
    // a top-level `source_uuid`, it'd find nothing and emit 0.
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.source_field).sort()).toEqual([
      "payload.source_wildcard_id",
      "payload.target_wildcard_id",
    ]);
  });
});

describe("discoverBrokenRefsForImport — defensive guards", () => {
  it("returns no warnings (and does not throw) when options is missing", () => {
    const wildcards: ImportedWildcard[] = [{ id: "aaaa3333" }];
    expect(() => discoverBrokenRefsForImport(wildcards, [], new Set())).not.toThrow();
    expect(discoverBrokenRefsForImport(wildcards, [], new Set())).toEqual([]);
  });

  it("returns no warnings (and does not throw) for non-string option values", () => {
    const wildcards: ImportedWildcard[] = [
      {
        id: "aaaa4444",
        options: [
          { value: null, weight: 1 },
          { value: 123, weight: 1 },
          { value: undefined, weight: 1 },
          { value: { not: "a string" }, weight: 1 },
        ],
      },
    ];
    expect(() => discoverBrokenRefsForImport(wildcards, [], new Set())).not.toThrow();
    expect(discoverBrokenRefsForImport(wildcards, [], new Set())).toEqual([]);
  });
});
