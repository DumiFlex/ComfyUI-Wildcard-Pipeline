import { describe, expect, it } from "vitest";
import { parsePayload } from "../parse";
import { moduleFingerprint } from "../fingerprint";

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

  it("rejects payload with non-array entity field", () => {
    const result = parsePayload(JSON.stringify({
      schema_version: 1, bundles: "not an array", wildcards: [], variables: [], constraints: [],
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/bundles/);
  });

  it("accepts valid v1 payload", () => {
    const payload = {
      schema_version: 1,
      bundles: [], wildcards: [], variables: [], constraints: [],
    };
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
      variables: [],
      constraints: [],
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
    const payload = {
      schema_version: 1,
      bundles: [], wildcards: [m], variables: [], constraints: [],
    };
    const result = parsePayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.integrityWarnings).toHaveLength(1);
      expect(result.integrityWarnings[0]?.field).toContain("wildcard");
    }
  });

  it("does not warn when no snapshot_fingerprint is stamped (legacy payload)", () => {
    const m = {
      type: "wildcard", name: "x", description: "", tags: [], payload_hash: "abc",
      // no snapshot_fingerprint stamped — treat as legacy, no warning
    };
    const payload = {
      schema_version: 1,
      bundles: [], wildcards: [m], variables: [], constraints: [],
    };
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
    const payload = {
      schema_version: 1,
      bundles: [], wildcards: [stamped], variables: [], constraints: [],
    };
    const result = parsePayload(JSON.stringify(payload));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.integrityWarnings).toEqual([]);
  });
});
