import { describe, expect, it } from "vitest";
import {
  wildcardFingerprint,
  variableFingerprint,
  constraintFingerprint,
} from "../fingerprint";

describe("wildcardFingerprint", () => {
  it("stable across calls with same input", () => {
    const w = {
      uuid: "aabbccdd",
      name: "color",
      options: [{ value: "red", weight: 1 }],
      tags: ["color"],
    };
    expect(wildcardFingerprint(w)).toBe(wildcardFingerprint(w));
  });

  it("differs when options change", () => {
    const a = {
      uuid: "aabbccdd",
      name: "x",
      options: [{ value: "red", weight: 1 }],
      tags: [],
    };
    const b = {
      uuid: "aabbccdd",
      name: "x",
      options: [{ value: "blue", weight: 1 }],
      tags: [],
    };
    expect(wildcardFingerprint(a)).not.toBe(wildcardFingerprint(b));
  });

  it("differs when tags change", () => {
    const a = {
      uuid: "aabbccdd",
      name: "x",
      options: [{ value: "red", weight: 1 }],
      tags: ["a"],
    };
    const b = {
      uuid: "aabbccdd",
      name: "x",
      options: [{ value: "red", weight: 1 }],
      tags: ["b"],
    };
    expect(wildcardFingerprint(a)).not.toBe(wildcardFingerprint(b));
  });

  it("order-insensitive for tags but order-sensitive for options", () => {
    const a = {
      uuid: "x",
      name: "x",
      options: [
        { value: "r", weight: 1 },
        { value: "b", weight: 1 },
      ],
      tags: ["x", "y"],
    };
    const b = {
      uuid: "x",
      name: "x",
      options: [
        { value: "r", weight: 1 },
        { value: "b", weight: 1 },
      ],
      tags: ["y", "x"],
    };
    const c = {
      uuid: "x",
      name: "x",
      options: [
        { value: "b", weight: 1 },
        { value: "r", weight: 1 },
      ],
      tags: ["x", "y"],
    };
    expect(wildcardFingerprint(a)).toBe(wildcardFingerprint(b));
    expect(wildcardFingerprint(a)).not.toBe(wildcardFingerprint(c));
  });
});

describe("variableFingerprint", () => {
  it("stable + sensitive to value", () => {
    const a = { uuid: "u", name: "v1", value: "foo", tags: [] };
    const b = { uuid: "u", name: "v1", value: "bar", tags: [] };
    expect(variableFingerprint(a)).toBe(variableFingerprint(a));
    expect(variableFingerprint(a)).not.toBe(variableFingerprint(b));
  });
});

describe("constraintFingerprint", () => {
  it("stable + sensitive to op + source + target", () => {
    const a = {
      uuid: "u",
      source_uuid: "s",
      target_uuid: "t",
      op: "equals",
      value: "x",
    };
    const b = {
      uuid: "u",
      source_uuid: "s",
      target_uuid: "t",
      op: "not_equals",
      value: "x",
    };
    expect(constraintFingerprint(a)).toBe(constraintFingerprint(a));
    expect(constraintFingerprint(a)).not.toBe(constraintFingerprint(b));
  });

  it("returns 8 hex chars", () => {
    const c = {
      uuid: "u",
      source_uuid: "s",
      target_uuid: "t",
      op: "exists",
      value: null,
    };
    expect(constraintFingerprint(c)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("prefix-suffix collision prevention", () => {
  // Without a separator between fields, two entities with different
  // field splits but identical concatenation would hash the same.
  // The `\n` separator (matching src/components/context/bundles/bundle-fingerprint.ts:79) prevents
  // this. These tests lock that contract.

  it("wildcard: name 'ab' + var_binding '' differs from name 'a' + var_binding 'b'", () => {
    const a = { uuid: "u", name: "ab", var_binding: "", options: [], tags: [] };
    const b = { uuid: "u", name: "a", var_binding: "b", options: [], tags: [] };
    expect(wildcardFingerprint(a)).not.toBe(wildcardFingerprint(b));
  });

  it("variable: name 'ab' + value '' differs from name 'a' + value 'b'", () => {
    const a = { uuid: "u", name: "ab", value: "", tags: [] };
    const b = { uuid: "u", name: "a", value: "b", tags: [] };
    expect(variableFingerprint(a)).not.toBe(variableFingerprint(b));
  });

  it("constraint: source 'st' + target '' differs from source 's' + target 't'", () => {
    const a = { uuid: "u", source_uuid: "st", target_uuid: "", op: "equals", value: "x" };
    const b = { uuid: "u", source_uuid: "s", target_uuid: "t", op: "equals", value: "x" };
    expect(constraintFingerprint(a)).not.toBe(constraintFingerprint(b));
  });
});
