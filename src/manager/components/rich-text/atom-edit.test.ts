import { describe, expect, it } from "vitest";
import type { Atom } from "../atomicEditorModel";
import {
  cleanPastedText, deleteRawRange, isStructuralChange, rawIndexForVisible, recolorBlocks,
  spliceAtTrigger, spliceRange, spliceSpaced, spliceWord, visibleLength,
} from "./atom-edit";
import { serialiseAtomsLocal, ZWSP } from "./ref-atoms";

const t = (text: string): Atom => ({ kind: "text", text });
const chip: Atom = { kind: "ref", uuid: "abcd1234", subCategories: [] }; // "@{abcd1234}" = 11 chars

describe("deleteRawRange", () => {
  it("removes one char from text", () => {
    expect(deleteRawRange([t("hello")], 4, 5)).toEqual({ atoms: [t("hell")], caret: 4 });
  });

  it("removes a chip whole when the span touches it, and merges the text", () => {
    const live = [t("a "), chip, t(" b")];
    // Backspace right after the chip: deletes its last raw char.
    const res = deleteRawRange(live, 12, 13);
    expect(res).toEqual({ atoms: [t("a  b")], caret: 2 });
  });

  it("keeps text that only looks like a chip", () => {
    expect(deleteRawRange([t("$mood.")], 5, 6).atoms).toEqual([t("$mood")]);
  });

  it("deletes a whole selection across atoms", () => {
    const res = deleteRawRange([t("ab"), chip, t("cd")], 1, 14);
    expect(res).toEqual({ atoms: [t("ad")], caret: 1 });
  });

  it("drops text atoms emptied by the cut", () => {
    expect(deleteRawRange([t("x")], 0, 1)).toEqual({ atoms: [], caret: 0 });
  });
});

describe("recolorBlocks", () => {
  it("returns the list untouched when empty", () => {
    const list: Atom[] = [t("")];
    expect(recolorBlocks(list)).toBe(list);
  });

  it("colours a valid brace block and leaves prose plain", () => {
    const out = recolorBlocks([t("x {a|b} y")]);
    expect(serialiseAtomsLocal(out)).toBe("x {a|b} y");
    expect(out.some((a) => a.kind === "text" && a.blockColor === "alt")).toBe(true);
    expect(out[0]).toEqual(t("x "));
  });

  it("drops the colour once the block is broken", () => {
    const out = recolorBlocks([{ kind: "text", text: "x {a|b y", blockColor: "alt" }]);
    expect(out.every((a) => a.kind !== "text" || !a.blockColor)).toBe(true);
  });

  it("colours a multi-select block green", () => {
    const out = recolorBlocks([t("{2$$, $$a|b|c}")]);
    expect(out.some((a) => a.kind === "text" && a.blockColor === "multi")).toBe(true);
  });

  it("keeps chips in place", () => {
    const out = recolorBlocks([t("a "), chip, t(" b")]);
    expect(out[1]).toBe(chip);
  });
});

describe("isStructuralChange", () => {
  it("is true on length change or a chip/text flip", () => {
    expect(isStructuralChange([t("a")], [t("a"), chip])).toBe(true);
    expect(isStructuralChange([t("a"), t("b")], [t("a"), chip])).toBe(true);
  });

  it("is false for same-shape edits", () => {
    expect(isStructuralChange([t("a"), chip], [t("abc"), chip])).toBe(false);
  });
});

describe("spliceAtTrigger", () => {
  it("replaces the typed trigger + query", () => {
    expect(spliceAtTrigger("hi $per x", 7, 3, "$person"))
      .toEqual({ text: "hi $person x", caret: 10 });
  });

  it("re-derives a stale trigger start by scanning back", () => {
    expect(spliceAtTrigger("a $testo", 8, -1, "$testo"))
      .toEqual({ text: "a $testo", caret: 8 });
    expect(spliceAtTrigger("a @{ab", 6, 0, "@{abcd1234}"))
      .toEqual({ text: "a @{abcd1234}", caret: 13 });
  });

  it("inserts at the caret when no trigger is found", () => {
    expect(spliceAtTrigger("abc", 1, -1, "$x")).toEqual({ text: "a$xbc", caret: 3 });
  });
});

describe("spliceWord / spliceRange / spliceSpaced", () => {
  it("spliceWord eats the typed word", () => {
    expect(spliceWord("a blu", 5, 2, "blue_hair, ")).toEqual({ text: "a blue_hair, ", caret: 13 });
    expect(spliceWord("ab", 1, -1, "X")).toEqual({ text: "aXb", caret: 2 });
  });

  it("spliceRange replaces a selection", () => {
    expect(spliceRange("hello world", 0, 11, "x")).toEqual({ text: "x", caret: 1 });
    expect(spliceRange("hello", 1, 3, "")).toEqual({ text: "hlo", caret: 1 });
  });

  it("spliceSpaced separates on both sides", () => {
    expect(spliceSpaced("aportrait", 1, "$mood")).toEqual({ text: "a $mood portrait", caret: 7 });
    expect(spliceSpaced("a ", 2, "$x")).toEqual({ text: "a $x", caret: 4 });
    expect(spliceSpaced("", 0, "$x")).toEqual({ text: "$x", caret: 2 });
  });
});

describe("cleanPastedText", () => {
  it("strips ZWSP and folds newlines on single-line fields", () => {
    expect(cleanPastedText(`a${ZWSP}\r\nb\n\nc`, false)).toBe("a b c");
    expect(cleanPastedText(`a${ZWSP}\nb`, true)).toBe("a\nb");
  });
});

describe("visibleLength / rawIndexForVisible", () => {
  it("ignores ZWSP pads", () => {
    expect(visibleLength(`${ZWSP}ab${ZWSP}`)).toBe(2);
  });

  it("maps visible offsets to raw indices past pads", () => {
    const raw = `${ZWSP}ab${ZWSP}c`;
    expect(rawIndexForVisible(raw, 0)).toBe(1);
    expect(rawIndexForVisible(raw, 2)).toBe(4);
    expect(rawIndexForVisible(raw, Number.POSITIVE_INFINITY)).toBe(5);
  });
});
