import { describe, expect, it } from "vitest";
import { parsePayload } from "../parse";
import { moduleFingerprint } from "../fingerprint";

const EMPTY_BUCKETS = {
  bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
};

describe("parsePayload", () => {
  it("rejects non-JSON input", () => {
    const result = parsePayload("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/invalid json/i);
  });

  it("rejects empty object", () => {
    const result = parsePayload("{}");
    expect(result.ok).toBe(false);
  });

  it("rejects payload missing entity arrays", () => {
    const result = parsePayload(JSON.stringify({ schema_version: 1 }));
    expect(result.ok).toBe(false);
  });

  it("rejects payload with non-array entity field (bundles)", () => {
    const result = parsePayload(JSON.stringify({
      schema_version: 1,
      bundles: "not an array",
      wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/bundles/);
  });

  it("rejects payload missing fixed_values array", () => {
    const result = parsePayload(JSON.stringify({
      schema_version: 1,
      bundles: [], wildcards: [], combines: [], derivations: [], constraints: [], categories: [],
      // fixed_values intentionally omitted
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/fixed_values/);
  });

  it("rejects payload missing combines array", () => {
    const result = parsePayload(JSON.stringify({
      schema_version: 1,
      bundles: [], wildcards: [], fixed_values: [], derivations: [], constraints: [], categories: [],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/combines/);
  });

  it("rejects payload missing derivations array", () => {
    const result = parsePayload(JSON.stringify({
      schema_version: 1,
      bundles: [], wildcards: [], fixed_values: [], combines: [], constraints: [], categories: [],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/derivations/);
  });

  it("rejects payload missing categories array", () => {
    const result = parsePayload(JSON.stringify({
      schema_version: 1,
      bundles: [], wildcards: [], fixed_values: [], combines: [], derivations: [], constraints: [],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/categories/);
  });

  it("accepts valid v1 payload with all 7 arrays", () => {
    const payload = { schema_version: 1, ...EMPTY_BUCKETS };
    const result = parsePayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.migratedEntityCount).toBe(0);
      expect(result.integrityWarnings).toEqual([]);
    }
  });

  it("migrates v0 payload to v1", () => {
    const v0 = {
      schema_version: 0,
      bundles: [],
      wildcards: [{ type: "wildcard", name: "x", description: "", tags: [], payload_hash: "abc" }],
      fixed_values: [], combines: [], derivations: [], constraints: [], categories: [],
    };
    const result = parsePayload(JSON.stringify(v0));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.schema_version).toBe(1);
      expect(result.migratedEntityCount).toBe(1);
      // Migrated entity should carry `migrated_from: 0` tag.
      const w = result.payload.wildcards[0] as { migrated_from?: number };
      expect(w.migrated_from).toBe(0);
    }
  });

  it("surfaces fingerprint integrity warnings on stamped mismatch", () => {
    // Build a module with a deliberately wrong stamped fingerprint.
    // Wildcards in this payload are MODULE rows (per unified design),
    // not the old per-type entity shape.
    const m = {
      type: "wildcard",
      name: "color",
      description: "",
      tags: ["palette"],
      payload_hash: "abc123",
      snapshot_fingerprint: "deadbeef",  // wrong; real fingerprint differs
    };
    const payload = { schema_version: 1, ...EMPTY_BUCKETS, wildcards: [m] };
    const result = parsePayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.integrityWarnings).toHaveLength(1);
      expect(result.integrityWarnings[0]?.field).toContain("wildcard");
    }
  });

  it("surfaces fingerprint integrity warnings for fixed_values", () => {
    const m = {
      type: "fixed_value",
      name: "red",
      description: "",
      tags: [],
      payload_hash: "abc",
      snapshot_fingerprint: "deadbeef",  // wrong
    };
    const payload = { schema_version: 1, ...EMPTY_BUCKETS, fixed_values: [m] };
    const result = parsePayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.integrityWarnings).toHaveLength(1);
      expect(result.integrityWarnings[0]?.field).toBe("fixed_value");
    }
  });

  it("does NOT warn for categories even when snapshot_fingerprint is present (no fp verification)", () => {
    const cat = {
      name: "palette",
      snapshot_fingerprint: "deadbeef",  // present but should be ignored
    };
    const payload = { schema_version: 1, ...EMPTY_BUCKETS, categories: [cat] };
    const result = parsePayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.integrityWarnings).toEqual([]);
    }
  });

  it("does not warn when no snapshot_fingerprint is stamped (legacy payload)", () => {
    const m = {
      type: "wildcard", name: "x", description: "", tags: [], payload_hash: "abc",
      // no snapshot_fingerprint stamped — treat as legacy, no warning
    };
    const payload = { schema_version: 1, ...EMPTY_BUCKETS, wildcards: [m] };
    const result = parsePayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.integrityWarnings).toEqual([]);
  });

  it("does not warn when stamped fingerprint matches computed", () => {
    const m = {
      type: "wildcard",
      name: "x",
      description: "",
      tags: ["a"],
      payload_hash: "abc",
    };
    const correctFp = moduleFingerprint(m);
    const stamped = { ...m, snapshot_fingerprint: correctFp };
    const payload = { schema_version: 1, ...EMPTY_BUCKETS, wildcards: [stamped] };
    const result = parsePayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.integrityWarnings).toEqual([]);
  });

  describe("edge cases", () => {
    it("rejects top-level JSON array with object error message", () => {
      const result = parsePayload("[]");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/must be a json object/i);
    });
  });
});
