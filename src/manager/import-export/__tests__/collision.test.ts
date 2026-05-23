import { describe, expect, it } from "vitest";
import { detectCollisions, type LibraryRow } from "../collision";
import { moduleFingerprint, type ModuleRow } from "../fingerprint";

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
