import { describe, expect, it } from "vitest";
import {
  detectCollisions,
  detectTemplateCollisions,
  type LibraryRow,
} from "../collision";
import {
  moduleFingerprint,
  templateFingerprint,
  type ModuleRow,
  type TemplateRow,
} from "../fingerprint";

function modRow(parts: Partial<ModuleRow> & { id: string }): ModuleRow & { id: string } {
  return {
    type: "wildcard",
    name: "x",
    description: "",
    tags: [],
    payload_hash: "deadbeef",
    ...parts,
  };
}

function tmplRow(parts: Partial<TemplateRow> & { id: string }): TemplateRow & { id: string } {
  return {
    name: "x",
    description: "",
    tags: [],
    template_string: "",
    category_id: null,
    ...parts,
  };
}

describe("detectCollisions", () => {
  it("returns no-collision when id not in library", () => {
    const incoming = [modRow({ id: "11111111" })];
    const library = new Map<string, LibraryRow>();
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("no-collision");
  });

  it("returns silent-skip when id matches + fingerprint matches", () => {
    const incoming = modRow({ id: "11111111", name: "color", payload_hash: "abc" });
    const fp = moduleFingerprint(incoming);
    const library = new Map<string, LibraryRow>([
      ["11111111", { snapshot_fingerprint: fp }],
    ]);
    const result = detectCollisions([incoming], library);
    expect(result["11111111"]).toBe("silent-skip");
  });

  it("returns conflict when id matches + fingerprint differs", () => {
    const incoming = [modRow({ id: "11111111", name: "color" })];
    const library = new Map<string, LibraryRow>([
      ["11111111", { snapshot_fingerprint: "deadbeef" }],
    ]);
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("conflict");
  });

  it("returns exists-unknown when library has empty fingerprint (presence-only)", () => {
    // Phase-5 distinguishes "library row present but no stored fingerprint"
    // (legacy / bundle) from "library row present with a differing
    // fingerprint" (true MODIFIED). Empty string → exists-unknown.
    const incoming = [modRow({ id: "11111111" })];
    const library = new Map<string, LibraryRow>([
      ["11111111", { snapshot_fingerprint: "" }],
    ]);
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("exists-unknown");
  });

  it("returns exists-unknown when library row has no snapshot_fingerprint field at all", () => {
    const incoming = [modRow({ id: "11111111" })];
    const library = new Map<string, LibraryRow>([["11111111", {}]]);
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("exists-unknown");
  });

  it("returns exists-unknown when snapshot_fingerprint is explicitly undefined", () => {
    // Same shape the picker emits for bundles (LibraryRow always built
    // with `snapshot_fingerprint: typeof fp === 'string' ? fp : undefined`
    // — see ImportExport.vue:buildLibraryMap).
    const incoming = [modRow({ id: "11111111" })];
    const library = new Map<string, LibraryRow>([
      ["11111111", { snapshot_fingerprint: undefined }],
    ]);
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("exists-unknown");
  });

  it("classifies multiple incoming modules independently", () => {
    const a = modRow({ id: "aaaaaaaa", name: "a", payload_hash: "ha" });
    const b = modRow({ id: "bbbbbbbb", name: "b", payload_hash: "hb" });
    const c = modRow({ id: "cccccccc", name: "c", payload_hash: "hc" });
    const library = new Map<string, LibraryRow>([
      ["aaaaaaaa", { snapshot_fingerprint: moduleFingerprint(a) }],
      ["bbbbbbbb", { snapshot_fingerprint: "different" }],
    ]);
    const result = detectCollisions([a, b, c], library);
    expect(result["aaaaaaaa"]).toBe("silent-skip");
    expect(result["bbbbbbbb"]).toBe("conflict");
    expect(result["cccccccc"]).toBe("no-collision");
  });

  it("treats different module types uniformly via moduleFingerprint", () => {
    const constraint = modRow({ id: "ccccdddd", type: "constraint", name: "c1" });
    const fp = moduleFingerprint(constraint);
    const library = new Map<string, LibraryRow>([
      ["ccccdddd", { snapshot_fingerprint: fp }],
    ]);
    const result = detectCollisions([constraint], library);
    expect(result["ccccdddd"]).toBe("silent-skip");
  });
});

describe("detectTemplateCollisions", () => {
  it("returns no-collision when id not in library", () => {
    const incoming = [tmplRow({ id: "11111111" })];
    const library = new Map<string, LibraryRow>();
    const result = detectTemplateCollisions(incoming, library);
    expect(result["11111111"]).toBe("no-collision");
  });

  it("returns silent-skip when id matches + template fingerprint matches", () => {
    const incoming = tmplRow({ id: "11111111", name: "hero", template_string: "$a in $b" });
    const fp = templateFingerprint(incoming);
    const library = new Map<string, LibraryRow>([
      ["11111111", { template_fingerprint: fp }],
    ]);
    const result = detectTemplateCollisions([incoming], library);
    expect(result["11111111"]).toBe("silent-skip");
  });

  it("returns conflict when id matches + template fingerprint differs", () => {
    const incoming = [tmplRow({ id: "11111111", name: "hero", template_string: "$a" })];
    const library = new Map<string, LibraryRow>([
      ["11111111", { template_fingerprint: "deadbeef" }],
    ]);
    const result = detectTemplateCollisions(incoming, library);
    expect(result["11111111"]).toBe("conflict");
  });

  it("returns exists-unknown when library row has no template_fingerprint (defensive fallback)", () => {
    const incoming = [tmplRow({ id: "11111111" })];
    const library = new Map<string, LibraryRow>([["11111111", {}]]);
    const result = detectTemplateCollisions(incoming, library);
    expect(result["11111111"]).toBe("exists-unknown");
  });

  it("does NOT consult snapshot_fingerprint for templates", () => {
    // A library row carrying only a module snapshot_fingerprint (no
    // template_fingerprint) must fall to exists-unknown, never silent-skip
    // — the two fingerprint spaces are distinct.
    const incoming = [tmplRow({ id: "11111111", name: "hero" })];
    const library = new Map<string, LibraryRow>([
      ["11111111", { snapshot_fingerprint: "anything" }],
    ]);
    const result = detectTemplateCollisions(incoming, library);
    expect(result["11111111"]).toBe("exists-unknown");
  });

  it("classifies multiple incoming templates independently", () => {
    const a = tmplRow({ id: "aaaaaaaa", name: "a", template_string: "ta" });
    const b = tmplRow({ id: "bbbbbbbb", name: "b", template_string: "tb" });
    const c = tmplRow({ id: "cccccccc", name: "c", template_string: "tc" });
    const library = new Map<string, LibraryRow>([
      ["aaaaaaaa", { template_fingerprint: templateFingerprint(a) }],
      ["bbbbbbbb", { template_fingerprint: "different" }],
    ]);
    const result = detectTemplateCollisions([a, b, c], library);
    expect(result["aaaaaaaa"]).toBe("silent-skip");
    expect(result["bbbbbbbb"]).toBe("conflict");
    expect(result["cccccccc"]).toBe("no-collision");
  });
});
