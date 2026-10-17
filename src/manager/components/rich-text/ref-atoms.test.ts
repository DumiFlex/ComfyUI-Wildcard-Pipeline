import { describe, expect, it } from "vitest";
import type { Atom, RefAtom } from "../atomicEditorModel";
import {
  type RefAtomX,
  chipFilterOf, chipRefAtom, padAtoms, parseForSurface, refFilterOf,
  serialiseAtomsLocal, serialiseRefAtom, splitColonBody, ZWSP, ZWSP_RE,
} from "./ref-atoms";

const ref = (over: Partial<RefAtom> = {}): RefAtom => ({
  kind: "ref", uuid: "abcd1234", subCategories: [], ...over,
});

describe("ZWSP", () => {
  it("is the zero-width space and the regex strips every one", () => {
    expect(ZWSP).toBe("​");
    expect(`a${ZWSP}b${ZWSP}`.replace(ZWSP_RE, "")).toBe("ab");
  });
});

describe("splitColonBody / refFilterOf", () => {
  it("peels a trailing !null", () => {
    expect(splitColonBody("warm!null")).toEqual({ expr: "warm", excludeNull: true });
    expect(splitColonBody("warm, cool")).toEqual({ expr: "warm, cool", excludeNull: false });
  });

  it("prefers explicit fields over the legacy body", () => {
    expect(refFilterOf({ ...ref({ subCategories: ["a"] }), expr: "b", excludeNull: true }))
      .toEqual({ expr: "b", excludeNull: true });
    expect(refFilterOf({ ...ref(), excludeNull: true })).toEqual({ expr: "", excludeNull: true });
  });

  it("reconstructs from subCategories, or empty", () => {
    expect(refFilterOf(ref())).toEqual({ expr: "", excludeNull: false });
    expect(refFilterOf(ref({ subCategories: ["a", "b!null"] })))
      .toEqual({ expr: "a,b", excludeNull: true });
  });
});

describe("serialiseRefAtom / serialiseAtomsLocal", () => {
  it("omits absent segments", () => {
    expect(serialiseRefAtom(ref())).toBe("@{abcd1234}");
    expect(serialiseRefAtom(ref({ name: "" }))).toBe("@{abcd1234}");
  });

  it("emits all four segments", () => {
    expect(serialiseRefAtom({ ...ref({ name: "col" }), expr: "warm & !cool", excludeNull: true }))
      .toBe("@{abcd1234#col:warm & !cool!null}");
  });

  it("serialises a mixed atom list", () => {
    const nullRef: RefAtomX = { ...ref(), excludeNull: true };
    const atoms: Atom[] = [
      { kind: "text", text: "a " },
      { kind: "var", name: "mood", index: 0, axis: "SHOES" },
      { kind: "text", text: " " },
      nullRef,
    ];
    expect(serialiseAtomsLocal(atoms)).toBe("a $mood.0.SHOES @{abcd1234!null}");
  });
});

describe("chipFilterOf", () => {
  it("returns the ref's filter, or empty for other atoms", () => {
    const x: RefAtomX = { ...ref(), expr: "x" };
    expect(chipFilterOf(x)).toEqual({ expr: "x", excludeNull: false });
    expect(chipFilterOf({ kind: "text", text: "x" })).toEqual({ expr: "", excludeNull: false });
  });
});

describe("padAtoms", () => {
  it("never returns an empty list", () => {
    expect(padAtoms([])).toEqual([{ kind: "text", text: "" }]);
  });

  it("brackets and separates chips with text atoms", () => {
    const a = ref();
    const b = ref({ uuid: "ffff0000" });
    expect(padAtoms([a, b])).toEqual([
      { kind: "text", text: "" }, a, { kind: "text", text: "" }, b, { kind: "text", text: "" },
    ]);
  });

  it("leaves an already-padded list alone", () => {
    const list: Atom[] = [{ kind: "text", text: "x" }, ref(), { kind: "text", text: "y" }];
    expect(padAtoms(list)).toEqual(list);
  });
});

describe("chipRefAtom", () => {
  it("peels !null that leaked into the name", () => {
    expect(chipRefAtom(ref({ name: "col!null" }))).toEqual({
      kind: "ref", uuid: "abcd1234", subCategories: [], expr: "", excludeNull: true, name: "col",
    });
    expect(chipRefAtom(ref({ name: "!null" }))).toEqual({
      kind: "ref", uuid: "abcd1234", subCategories: [], expr: "", excludeNull: true,
    });
  });

  it("lifts the legacy body into explicit fields", () => {
    expect(chipRefAtom(ref({ name: "col", subCategories: ["warm!null"] }))).toEqual({
      kind: "ref", uuid: "abcd1234", subCategories: [], expr: "warm", excludeNull: true, name: "col",
    });
  });
});

describe("parseForSurface", () => {
  it("keeps $vars as literal text", () => {
    expect(parseForSurface("hi $mood.0 there", false)).toEqual([
      { kind: "text", text: "hi $mood.0 there" },
    ]);
  });

  it("collapses refs to text when refs are off", () => {
    const out = parseForSurface("a @{abcd1234#col:warm!null} b", false);
    expect(out).toHaveLength(1);
    expect(serialiseAtomsLocal(out)).toBe("a @{abcd1234#col:warm!null} b");
  });

  it("chipifies refs into the 4-segment view when refs are on", () => {
    const out = parseForSurface("a @{abcd1234#col:warm!null} b", true);
    expect(out).toEqual([
      { kind: "text", text: "a " },
      { kind: "ref", uuid: "abcd1234", subCategories: [], expr: "warm", excludeNull: true, name: "col" },
      { kind: "text", text: " b" },
    ]);
  });

  it("round-trips through serialiseAtomsLocal", () => {
    const src = "{a|b} $x @{abcd1234:warm} {2$$, $$c|d}";
    expect(serialiseAtomsLocal(parseForSurface(src, true))).toBe(src);
    expect(serialiseAtomsLocal(parseForSurface(src, false))).toBe(src);
  });

  it("does not merge block scaffolding into plain text", () => {
    const out = parseForSurface("{a|b} x {c|d}", false);
    const plain = out.filter((a) => a.kind === "text" && !a.blockColor);
    expect(plain.map((a) => (a.kind === "text" ? a.text : ""))).toContain(" x ");
  });

  it("returns [] for empty text", () => {
    expect(parseForSurface("", true)).toEqual([]);
  });
});
