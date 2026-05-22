import { describe, expect, it } from "vitest";
import { migratePayload, CURRENT_SCHEMA_VERSION } from "../migrations";

describe("migratePayload", () => {
  it("returns payload as-is if version matches CURRENT_SCHEMA_VERSION", () => {
    const payload = { schema_version: CURRENT_SCHEMA_VERSION, bundles: [], wildcards: [], variables: [], constraints: [] };
    const result = migratePayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated).toEqual(payload);
      expect(result.migratedCount).toBe(0);
    }
  });

  it("rejects payload with version > CURRENT_SCHEMA_VERSION", () => {
    const payload = { schema_version: CURRENT_SCHEMA_VERSION + 1, bundles: [], wildcards: [], variables: [], constraints: [] };
    const result = migratePayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/future schema version/i);
  });

  it("rejects payload with missing schema_version", () => {
    const payload = { bundles: [], wildcards: [], variables: [], constraints: [] } as any;
    const result = migratePayload(payload);
    expect(result.ok).toBe(false);
  });

  it("walks chain from older version up to current", () => {
    const v0Payload = { schema_version: 0, bundles: [], wildcards: [{ uuid: "u", name: "old" }], variables: [], constraints: [] };
    const result = migratePayload(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migrated.schema_version).toBe(CURRENT_SCHEMA_VERSION);
      expect(result.migratedCount).toBeGreaterThan(0);
    }
  });

  it("tags individual entities with migrated_from when migration runs", () => {
    const v0Payload = { schema_version: 0, bundles: [], wildcards: [{ uuid: "u", name: "x" }], variables: [], constraints: [] };
    const result = migratePayload(v0Payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const w = result.migrated.wildcards[0] as any;
      expect(w.migrated_from).toBe(0);
    }
  });
});
