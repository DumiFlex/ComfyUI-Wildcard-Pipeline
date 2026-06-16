import { describe, expect, it } from "vitest";
import {
  migrateImportEnvelope,
  CURRENT_SCHEMA_VERSION,
  MAX_KNOWN_SCHEMA_VERSION,
} from "../migrations";

describe("migrateImportEnvelope", () => {
  it("returns payload as-is if version matches CURRENT_SCHEMA_VERSION", () => {
    const payload = {
      schema_version: CURRENT_SCHEMA_VERSION,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [], templates: [],
    };
    const result = migrateImportEnvelope(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toEqual(payload);
      expect(result.migratedEntityCount).toBe(0);
    }
  });

  it("rejects payload with version > MAX_KNOWN_SCHEMA_VERSION", () => {
    const payload = {
      schema_version: MAX_KNOWN_SCHEMA_VERSION + 1,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
    };
    const result = migrateImportEnvelope(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/future schema version/i);
  });

  it("rejects payload with missing schema_version", () => {
    const payload = {
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
    } as Record<string, unknown>;
    const result = migrateImportEnvelope(payload);
    expect(result.ok).toBe(false);
  });

  it("walks chain from older version up to current", () => {
    const v0Payload = {
      schema_version: 0,
      bundles: [], wildcards: [{ uuid: "u", name: "old" }],
      fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
    };
    const result = migrateImportEnvelope(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated.schema_version).toBe(CURRENT_SCHEMA_VERSION);
      // 2 chain steps (v0->v1, v1->v2) each pass the 1 wildcard => 2.
      expect(result.migratedEntityCount).toBe(2);
    }
  });

  it("tags individual entities with migrated_from when migration runs", () => {
    const v0Payload = {
      schema_version: 0,
      bundles: [], wildcards: [{ uuid: "u", name: "x" }],
      fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
    };
    const result = migrateImportEnvelope(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const w = result.migrated.wildcards[0] as Record<string, unknown>;
      expect(w.migrated_from).toBe(0);
    }
  });

  it("tags fixed_values, combines, derivations, categories with migrated_from when migration runs", () => {
    const v0Payload = {
      schema_version: 0,
      bundles: [],
      wildcards: [],
      fixed_values: [{ uuid: "fv1", name: "fv" }],
      combines: [{ uuid: "cb1", name: "cb" }],
      derivations: [{ uuid: "dr1", name: "dr" }],
      constraints: [],
      categories: [{ uuid: "cat1", name: "cat" }],
    };
    const result = migrateImportEnvelope(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.migrated.fixed_values[0] as Record<string, unknown>).migrated_from).toBe(0);
      expect((result.migrated.combines[0] as Record<string, unknown>).migrated_from).toBe(0);
      expect((result.migrated.derivations[0] as Record<string, unknown>).migrated_from).toBe(0);
      expect((result.migrated.categories[0] as Record<string, unknown>).migrated_from).toBe(0);
    }
  });

  it("walks chain on empty payload, returns zero migrated entities", () => {
    const v0Empty = {
      schema_version: 0,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
    };
    const result = migrateImportEnvelope(v0Empty);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated.schema_version).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.migratedEntityCount).toBe(0);
    }
  });

  it("sums all 7 array lengths for migratedEntityCount", () => {
    const v0Payload = {
      schema_version: 0,
      bundles: [{ uuid: "b1" }],
      wildcards: [{ uuid: "w1" }],
      fixed_values: [{ uuid: "fv1" }],
      combines: [{ uuid: "cb1" }],
      derivations: [{ uuid: "dr1" }],
      constraints: [{ uuid: "c1" }],
      categories: [{ uuid: "cat1" }],
    };
    const result = migrateImportEnvelope(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 7 entities x 2 chain steps (v0->v1, v1->v2) = 14.
      expect(result.migratedEntityCount).toBe(14);
    }
  });

  it("defaults missing arrays to empty (partial payload from older format)", () => {
    // A payload with only schema_version + wildcards should still succeed
    const partial = { schema_version: CURRENT_SCHEMA_VERSION, wildcards: [{ uuid: "w1" }] } as Record<string, unknown>;
    const result = migrateImportEnvelope(partial);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated.fixed_values).toEqual([]);
      expect(result.migrated.combines).toEqual([]);
      expect(result.migrated.derivations).toEqual([]);
      expect(result.migrated.categories).toEqual([]);
    }
  });

  it("defaults missing templates bucket to [] (back-compat: pre-templates export)", () => {
    // Old exports predate the templates bucket and lack the key entirely;
    // the normalizer must default it so downstream code never sees undefined.
    const noTemplates = {
      schema_version: CURRENT_SCHEMA_VERSION,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
    } as Record<string, unknown>;
    const result = migrateImportEnvelope(noTemplates);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated.templates).toEqual([]);
    }
  });

  it("tags templates with migrated_from when migration runs", () => {
    const v0Payload = {
      schema_version: 0,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
      templates: [{ id: "t1", name: "hero" }],
    };
    const result = migrateImportEnvelope(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.migrated.templates[0] as Record<string, unknown>).migrated_from).toBe(0);
    }
  });

  it("includes templates in the migratedEntityCount sum", () => {
    const v0Payload = {
      schema_version: 0,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
      templates: [{ id: "t1" }, { id: "t2" }],
    };
    const result = migrateImportEnvelope(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 2 templates x 2 chain steps (v0->v1, v1->v2) = 4.
      expect(result.migratedEntityCount).toBe(4);
    }
  });
});

/**
 * Install-path fork (spec §"Install path: accept natively-supported future
 * versions"): the reject threshold reads MAX_KNOWN_SCHEMA_VERSION (4), not
 * CURRENT_SCHEMA_VERSION (2). A payload at CURRENT < v <= MAX_KNOWN (v3 =
 * text-grammar only, v4 = additive `target_select`) is shape-compatible with
 * v2 and natively handled at runtime, so it must pass through AS-IS: not
 * rejected, not migrated (the chain loop bound stays CURRENT so there is
 * nothing to do), schema_version preserved. Only v > MAX_KNOWN still rejects.
 */
describe("migrateImportEnvelope — accepts natively-supported future versions (<= MAX_KNOWN)", () => {
  it("passes a v3 (range-syntax) payload through unchanged — not rejected, not migrated", () => {
    const v3Payload = {
      schema_version: 3,
      bundles: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [], templates: [],
      wildcards: [
        { id: "wc-aaa", type: "wildcard", name: "w", payload: { options: [{ id: "o", value: "{1-2$$a|b}", weight: 1 }] } },
      ],
    };
    const result = migrateImportEnvelope(v3Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // No migration ran: schema_version stays 3 and nothing was touched.
      expect(result.migrated.schema_version).toBe(3);
      expect(result.migrated).toEqual(v3Payload);
      expect(result.migratedEntityCount).toBe(0);
    }
  });

  it("passes a v4 (target_select reach) constraint payload through unchanged", () => {
    const v4Payload = {
      schema_version: 4,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], categories: [], templates: [],
      constraints: [
        {
          id: "cn-001abc",
          type: "constraint",
          name: "c",
          payload: {
            source_wildcard_id: "wc-aaa",
            target_wildcard_id: "wc-bbb",
            matrix: {},
            exceptions: [],
            target_select: { mode: "next", count: 2 },
          },
        },
      ],
    };
    const result = migrateImportEnvelope(v4Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated.schema_version).toBe(4);
      expect(result.migrated).toEqual(v4Payload);
      expect(result.migratedEntityCount).toBe(0);
      // The additive `target_select` field survives the pass-through verbatim.
      const cn = result.migrated.constraints[0] as Record<string, unknown>;
      expect((cn.payload as Record<string, unknown>).target_select).toEqual({ mode: "next", count: 2 });
    }
  });

  it("a v2 payload still migrates to the chain head (chain unchanged)", () => {
    const v0Payload = {
      schema_version: 0,
      bundles: [], wildcards: [{ id: "w", name: "old" }],
      fixed_values: [], combines: [], derivations: [], constraints: [], categories: [], templates: [],
    };
    const result = migrateImportEnvelope(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated.schema_version).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.migratedEntityCount).toBe(2);
    }
  });

  it("a v5 payload (> MAX_KNOWN) still rejects with the future-version error", () => {
    const v5Payload = {
      schema_version: MAX_KNOWN_SCHEMA_VERSION + 1,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [], templates: [],
    };
    const result = migrateImportEnvelope(v5Payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/future schema version/i);
      // The reject reason names the max-known ceiling, not the chain head.
      expect(result.reason).toContain(String(MAX_KNOWN_SCHEMA_VERSION));
    }
  });
});
