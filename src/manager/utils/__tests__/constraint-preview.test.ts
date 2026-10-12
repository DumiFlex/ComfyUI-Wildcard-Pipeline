import { describe, expect, it } from "vitest";
import { mergeAiRules, previewConstraint, type PreviewWildcard } from "../constraint-preview";

const SRC: PreviewWildcard = { options: [
  { value: "mage", sub_categories: ["magic"] },
  { value: "warrior", sub_categories: ["melee"] },
] };
const TGT: PreviewWildcard = { options: [
  { value: "staff", weight: 1, sub_categories: ["staff"] },
  { value: "sword", weight: 3, sub_categories: ["blade"] },
] };

describe("previewConstraint", () => {
  it("applies weights, cells and exceptions per source option", () => {
    const t = previewConstraint(SRC, TGT, { magic: { blade: { mode: "exclude", factor: 0 } } }, [
      { source: "warrior", target: "staff", mode: "boost", factor: 3 },
    ]);
    expect(t.targets).toEqual(["staff", "sword"]);
    expect(t.rows[0]).toMatchObject({ source: "mage", chances: [1, 0], empty: false });
    expect(t.rows[1].chances).toEqual([0.5, 0.5]);
  });

  it("marks a row with nothing left, or the fallback standing in", () => {
    const matrix = { magic: { staff: { mode: "exclude" as const, factor: 0 }, blade: { mode: "exclude" as const, factor: 0 } } };
    expect(previewConstraint(SRC, TGT, matrix, []).rows[0]).toMatchObject({ empty: true, fallbackUsed: false });
    const withFb: PreviewWildcard = { options: [...(TGT.options ?? []), { value: "fists", sub_categories: ["blade"], fallback: true }] };
    const row = previewConstraint(SRC, withFb, matrix, []).rows[0];
    expect(row).toMatchObject({ empty: false, fallbackUsed: true, chances: [0, 0, 1] });
  });
});

describe("mergeAiRules", () => {
  it("sets cells and replaces the exception a pair already had", () => {
    const out = mergeAiRules(
      { magic: { staff: { mode: "boost", factor: 2 } } },
      [{ source: "mage", target: "sword", mode: "reduce", factor: 0.5 }],
      [{ source_tag: "magic", target_tag: "blade", cell: { mode: "exclude", factor: 0 }, reason: "", replaces: false }],
      [
        { exception: { source: "mage", target: "sword", mode: "only", factor: 1 }, reason: "", from: "", replaces: true },
        { exception: { source: "warrior", target: "staff", mode: "exclude", factor: 0 }, reason: "", from: "", replaces: false },
      ],
    );
    expect(out.matrix).toEqual({ magic: { staff: { mode: "boost", factor: 2 }, blade: { mode: "exclude", factor: 0 } } });
    expect(out.exceptions.map((e) => `${e.source}>${e.target}:${e.mode}`)).toEqual(["mage>sword:only", "warrior>staff:exclude"]);
  });
});
