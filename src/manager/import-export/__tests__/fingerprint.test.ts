import { describe, expect, it } from "vitest";
import {
  localPayloadFingerprint,
  moduleFingerprint,
  templateFingerprint,
  type ModuleRow,
  type TemplateRow,
} from "../fingerprint";

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

function tmpl(parts: Partial<TemplateRow>): TemplateRow {
  return {
    name: "x",
    description: "",
    tags: [],
    template_string: "",
    category_id: null,
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

describe("null-safety", () => {
  it("tolerates null tags without throwing", () => {
    const m = { type: "wildcard", name: "x", description: "", tags: null as unknown as string[], payload_hash: "deadbeef" };
    expect(() => moduleFingerprint(m)).not.toThrow();
    expect(moduleFingerprint(m)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("null tags hashes same as empty tags array", () => {
    const a = { type: "wildcard", name: "x", description: "", tags: [], payload_hash: "deadbeef" };
    const b = { type: "wildcard", name: "x", description: "", tags: null as unknown as string[], payload_hash: "deadbeef" };
    expect(moduleFingerprint(a)).toBe(moduleFingerprint(b));
  });
});

describe("localPayloadFingerprint", () => {
  it("ignores object key ORDER — JSON key order isn't meaningful", () => {
    // This is the property the hash-less re-link path rests on: payloads
    // round-trip through APIs that reorder keys, so two structurally equal
    // payloads must fingerprint the same.
    const a = { var_binding: "hair", options: [{ id: "o1", value: "red" }] };
    const b = { options: [{ value: "red", id: "o1" }], var_binding: "hair" };
    expect(localPayloadFingerprint(a)).toBe(localPayloadFingerprint(b));
  });

  it("respects ARRAY order — option / rule order IS meaningful", () => {
    const a = { options: [{ value: "red" }, { value: "blue" }] };
    const b = { options: [{ value: "blue" }, { value: "red" }] };
    expect(localPayloadFingerprint(a)).not.toBe(localPayloadFingerprint(b));
  });

  it("separates differing content", () => {
    expect(localPayloadFingerprint({ v: "a" })).not.toBe(localPayloadFingerprint({ v: "b" }));
  });

  it("distinguishes a missing key from an explicit null", () => {
    expect(localPayloadFingerprint({ a: 1 })).not.toBe(localPayloadFingerprint({ a: 1, b: null }));
  });

  it("handles primitives, null, and undefined without throwing", () => {
    expect(() => localPayloadFingerprint(null)).not.toThrow();
    expect(() => localPayloadFingerprint(undefined)).not.toThrow();
    expect(localPayloadFingerprint(null)).not.toBe(localPayloadFingerprint({}));
  });
});

describe("templateFingerprint", () => {
  it("stable across calls with same input", () => {
    const t = tmpl({ name: "hero", description: "Hero shot", tags: ["a", "b"], template_string: "$subject in $scene" });
    expect(templateFingerprint(t)).toBe(templateFingerprint(t));
  });

  it("returns 8 lowercase hex chars", () => {
    expect(templateFingerprint(tmpl({}))).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs when name changes", () => {
    expect(templateFingerprint(tmpl({ name: "a" }))).not.toBe(templateFingerprint(tmpl({ name: "b" })));
  });

  it("differs when description changes", () => {
    expect(templateFingerprint(tmpl({ description: "a" }))).not.toBe(templateFingerprint(tmpl({ description: "b" })));
  });

  it("differs when template_string changes", () => {
    expect(templateFingerprint(tmpl({ template_string: "$a" }))).not.toBe(templateFingerprint(tmpl({ template_string: "$b" })));
  });

  it("differs when tags differ", () => {
    expect(templateFingerprint(tmpl({ tags: ["a"] }))).not.toBe(templateFingerprint(tmpl({ tags: ["b"] })));
  });

  it("tags are order-insensitive (set semantics)", () => {
    expect(templateFingerprint(tmpl({ tags: ["x", "y"] }))).toBe(templateFingerprint(tmpl({ tags: ["y", "x"] })));
  });

  it("differs when category_id changes", () => {
    expect(templateFingerprint(tmpl({ category_id: "c1" }))).not.toBe(templateFingerprint(tmpl({ category_id: "c2" })));
  });

  it("treats null category_id the same as omitted (both → '')", () => {
    const withNull = tmpl({ category_id: null });
    const omitted: TemplateRow = { name: "x", description: "", tags: [], template_string: "" };
    expect(templateFingerprint(withNull)).toBe(templateFingerprint(omitted));
  });

  it("tolerates null tags without throwing", () => {
    const t = { name: "x", description: "", tags: null as unknown as string[], template_string: "", category_id: null };
    expect(() => templateFingerprint(t)).not.toThrow();
    expect(templateFingerprint(t)).toMatch(/^[0-9a-f]{8}$/);
  });
});
