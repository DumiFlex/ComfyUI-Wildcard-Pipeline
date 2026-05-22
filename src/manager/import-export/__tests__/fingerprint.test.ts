import { describe, expect, it } from "vitest";
import { moduleFingerprint, type ModuleRow } from "../fingerprint";

function row(parts: Partial<ModuleRow>): ModuleRow {
  return {
    type: "wildcard",
    name: "x",
    description: "",
    tags: [],
    payload_hash: "deadbeef",
    ...parts,
  };
}

describe("moduleFingerprint", () => {
  it("stable across calls with same input", () => {
    const m = row({ name: "color", description: "Basic colors", tags: ["palette", "demo"], payload_hash: "abc123" });
    expect(moduleFingerprint(m)).toBe(moduleFingerprint(m));
  });

  it("returns 8 lowercase hex chars", () => {
    expect(moduleFingerprint(row({}))).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs when type changes", () => {
    expect(moduleFingerprint(row({ type: "wildcard" }))).not.toBe(moduleFingerprint(row({ type: "combine" })));
  });

  it("differs when name changes", () => {
    expect(moduleFingerprint(row({ name: "a" }))).not.toBe(moduleFingerprint(row({ name: "b" })));
  });

  it("differs when description changes", () => {
    expect(moduleFingerprint(row({ description: "a" }))).not.toBe(moduleFingerprint(row({ description: "b" })));
  });

  it("differs when tags differ", () => {
    expect(moduleFingerprint(row({ tags: ["a"] }))).not.toBe(moduleFingerprint(row({ tags: ["b"] })));
  });

  it("tags are order-insensitive (set semantics)", () => {
    expect(moduleFingerprint(row({ tags: ["x", "y"] }))).toBe(moduleFingerprint(row({ tags: ["y", "x"] })));
  });

  it("differs when payload_hash changes", () => {
    expect(moduleFingerprint(row({ payload_hash: "abc" }))).not.toBe(moduleFingerprint(row({ payload_hash: "def" })));
  });

  it("ignores fields not in fingerprint scope (id, category_id, is_favorite, version)", () => {
    const a = { ...row({}), id: "u1", category_id: "c1", is_favorite: true, version: 1 } as ModuleRow;
    const b = { ...row({}), id: "u2", category_id: "c2", is_favorite: false, version: 9 } as ModuleRow;
    expect(moduleFingerprint(a)).toBe(moduleFingerprint(b));
  });
});

describe("prefix-suffix collision prevention", () => {
  it("name 'ab' + description '' differs from name 'a' + description 'b'", () => {
    const a = row({ name: "ab", description: "" });
    const b = row({ name: "a", description: "b" });
    expect(moduleFingerprint(a)).not.toBe(moduleFingerprint(b));
  });
});

describe("cross-language parity", () => {
  it("matches reference hash for known wildcard module", () => {
    const m: ModuleRow = {
      type: "wildcard",
      name: "color",
      description: "Basic colors",
      tags: ["palette", "demo"],
      payload_hash: "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd",
    };
    expect(moduleFingerprint(m)).toBe("ba7a57fa");
  });
});
