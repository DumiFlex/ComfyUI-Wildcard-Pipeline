import { describe, expect, it } from "vitest";
import { migrateImportEnvelope, CURRENT_SCHEMA_VERSION } from "../migrations";

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

  it("rejects payload with version > CURRENT_SCHEMA_VERSION", () => {
    const payload = {
      schema_version: CURRENT_SCHEMA_VERSION + 1,
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
