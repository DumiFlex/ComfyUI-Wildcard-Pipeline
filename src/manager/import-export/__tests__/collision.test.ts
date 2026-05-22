import { describe, expect, it } from "vitest";
import { detectCollisions, type LibraryRow } from "../collision";
import { moduleFingerprint, type ModuleRow } from "../fingerprint";

function modRow(parts: Partial<ModuleRow> & { uuid: string }): ModuleRow & { uuid: string } {
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
  it("returns no-collision when UUID not in library", () => {
    const incoming = [modRow({ uuid: "11111111" })];
    const library = new Map<string, LibraryRow>();
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("no-collision");
  });

  it("returns silent-skip when UUID matches + fingerprint matches", () => {
    const incoming = modRow({ uuid: "11111111", name: "color", payload_hash: "abc" });
    const fp = moduleFingerprint(incoming);
    const library = new Map<string, LibraryRow>([
      ["11111111", { snapshot_fingerprint: fp }],
    ]);
    const result = detectCollisions([incoming], library);
    expect(result["11111111"]).toBe("silent-skip");
  });

  it("returns conflict when UUID matches + fingerprint differs", () => {
    const incoming = [modRow({ uuid: "11111111", name: "color" })];
    const library = new Map<string, LibraryRow>([
      ["11111111", { snapshot_fingerprint: "deadbeef" }],
    ]);
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("conflict");
  });

  it("returns conflict when library has empty fingerprint (defensive)", () => {
    const incoming = [modRow({ uuid: "11111111" })];
    const library = new Map<string, LibraryRow>([
      ["11111111", { snapshot_fingerprint: "" }],
    ]);
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("conflict");
  });

  it("returns conflict when library row has no snapshot_fingerprint field at all", () => {
    const incoming = [modRow({ uuid: "11111111" })];
    const library = new Map<string, LibraryRow>([["11111111", {}]]);
    const result = detectCollisions(incoming, library);
    expect(result["11111111"]).toBe("conflict");
  });

  it("classifies multiple incoming modules independently", () => {
    const a = modRow({ uuid: "aaaaaaaa", name: "a", payload_hash: "ha" });
    const b = modRow({ uuid: "bbbbbbbb", name: "b", payload_hash: "hb" });
    const c = modRow({ uuid: "cccccccc", name: "c", payload_hash: "hc" });
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
    const constraint = modRow({ uuid: "ccccdddd", type: "constraint", name: "c1" });
    const fp = moduleFingerprint(constraint);
    const library = new Map<string, LibraryRow>([
      ["ccccdddd", { snapshot_fingerprint: fp }],
    ]);
    const result = detectCollisions([constraint], library);
    expect(result["ccccdddd"]).toBe("silent-skip");
  });
});
