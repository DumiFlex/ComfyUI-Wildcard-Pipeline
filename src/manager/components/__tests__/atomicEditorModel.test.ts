import { describe, expect, it } from "vitest";
import { parse, serialise, type VarAtom } from "../atomicEditorModel";

describe("atomicEditorModel — $var.K list accessor (SP2a)", () => {
  it("parses $colors.0 as one var atom carrying the index", () => {
    const atoms = parse("$colors.0");
    expect(atoms).toHaveLength(1);
    expect(atoms[0]).toMatchObject({ kind: "var", name: "colors", index: 0 });
  });

  it("parses a multi-digit accessor", () => {
    expect(parse("$x.123")[0]).toMatchObject({ kind: "var", name: "x", index: 123 });
  });

  it("plain $colors has no index", () => {
    const atom = parse("$colors")[0] as VarAtom;
    expect(atom).toMatchObject({ kind: "var", name: "colors" });
    expect(atom.index).toBeUndefined();
  });

  it("round-trips $colors.1 through serialise", () => {
    expect(serialise(parse("x $colors.1 y"))).toBe("x $colors.1 y");
  });

  it("round-trips a plain var unchanged", () => {
    expect(serialise(parse("uses $mood here"))).toBe("uses $mood here");
  });

  it("a lone trailing dot stays literal text (not an accessor)", () => {
    // `$x.` → var `x` + literal "."; round-trips intact.
    expect(serialise(parse("$x."))).toBe("$x.");
  });
});
