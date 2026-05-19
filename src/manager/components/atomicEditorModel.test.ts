import { describe, it, expect } from "vitest";
import { parse, serialise, type Atom } from "./atomicEditorModel";

describe("atomicEditorModel.parse + serialise", () => {
  it("round-trips plain text without ref/var tokens", () => {
    const atoms: Atom[] = parse("hello world");
    expect(atoms).toEqual([{ kind: "text", text: "hello world" }]);
    expect(serialise(atoms)).toBe("hello world");
  });

  it("splits text + var atoms", () => {
    const atoms = parse("hi $person foo");
    expect(atoms).toEqual([
      { kind: "text", text: "hi " },
      { kind: "var", name: "person" },
      { kind: "text", text: " foo" },
    ]);
    expect(serialise(atoms)).toBe("hi $person foo");
  });

  it("captures @{uuid} ref atoms with no filter", () => {
    const atoms = parse("hello @{aabbccdd} world");
    expect(atoms[1]).toEqual({ kind: "ref", uuid: "aabbccdd", subCategories: [] });
    expect(serialise(atoms)).toBe("hello @{aabbccdd} world");
  });

  it("captures @{uuid:subcat} ref atoms with filter", () => {
    const atoms = parse("a @{aabbccdd:warm,cool} b");
    expect(atoms[1]).toEqual({
      kind: "ref", uuid: "aabbccdd", subCategories: ["warm", "cool"],
    });
    expect(serialise(atoms)).toBe("a @{aabbccdd:warm,cool} b");
  });

  it("treats invalid ref shape as plain text", () => {
    const atoms = parse("a @{notvalid} b");
    expect(atoms).toEqual([{ kind: "text", text: "a @{notvalid} b" }]);
  });
});
