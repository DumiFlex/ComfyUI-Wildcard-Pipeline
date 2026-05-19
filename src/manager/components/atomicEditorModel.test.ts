import { describe, it, expect } from "vitest";
import { parse, serialise, type Atom } from "./atomicEditorModel";
import { insertText, insertAtom, deleteBackward, replaceAtom, type Cursor } from "./atomicEditorModel";

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

describe("atomicEditorModel operations", () => {
  it("insertText into the middle of a text atom", () => {
    const atoms: Atom[] = [{ kind: "text", text: "hello world" }];
    const cur: Cursor = { atomIndex: 0, offset: 5 };
    const { atoms: next, cursor } = insertText(atoms, cur, " brave");
    expect(serialise(next)).toBe("hello brave world");
    expect(cursor).toEqual({ atomIndex: 0, offset: 11 });
  });

  it("insertAtom splits the host text atom around the insert", () => {
    const atoms: Atom[] = [{ kind: "text", text: "a b" }];
    const cur: Cursor = { atomIndex: 0, offset: 2 };
    const refAtom: Atom = { kind: "ref", uuid: "aabbccdd", subCategories: [] };
    const { atoms: next, cursor } = insertAtom(atoms, cur, refAtom);
    expect(serialise(next)).toBe("a @{aabbccdd}b");
    // Cursor lands AFTER the inserted atom
    expect(cursor).toEqual({ atomIndex: 2, offset: 0 });
  });

  it("deleteBackward removes the prior char inside a text atom", () => {
    const atoms: Atom[] = [{ kind: "text", text: "hello" }];
    const cur: Cursor = { atomIndex: 0, offset: 5 };
    const { atoms: next, cursor } = deleteBackward(atoms, cur);
    expect(serialise(next)).toBe("hell");
    expect(cursor).toEqual({ atomIndex: 0, offset: 4 });
  });

  it("deleteBackward at offset 0 of a non-first text atom deletes the previous atom", () => {
    const atoms: Atom[] = [
      { kind: "text", text: "a " },
      { kind: "ref", uuid: "aabbccdd", subCategories: [] },
      { kind: "text", text: " b" },
    ];
    const cur: Cursor = { atomIndex: 2, offset: 0 };
    const { atoms: next, cursor } = deleteBackward(atoms, cur);
    expect(serialise(next)).toBe("a  b");
    // Cursor lands at the boundary where the ref used to be
    expect(cursor).toEqual({ atomIndex: 0, offset: 2 });
  });

  it("replaceAtom swaps a ref's subCategories in place", () => {
    const atoms: Atom[] = [
      { kind: "text", text: "a " },
      { kind: "ref", uuid: "aabbccdd", subCategories: [] },
    ];
    const replaced: Atom = { kind: "ref", uuid: "aabbccdd", subCategories: ["warm"] };
    const next = replaceAtom(atoms, 1, replaced);
    expect(serialise(next)).toBe("a @{aabbccdd:warm}");
  });
});
