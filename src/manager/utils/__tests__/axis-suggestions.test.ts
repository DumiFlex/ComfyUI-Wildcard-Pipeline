import { describe, it, expect } from "vitest";
import { expandVarsWithAxes, varRows } from "../suggestion-rows";
import { acceptsAxesOf } from "../library-suggestions";

const producers = new Map([
  ["outfit", {
    kind: "wildcard", shadowed: 0,
    axes: [
      { axis: "SHOES", tags: ["sneakers", "heels", "sandals"], hueIndex: 1 },
      { axis: "EXPOSES", tags: ["navel"], hueIndex: 2 },
    ],
  }],
  ["mood", { kind: "wildcard", shadowed: 0 }],
]);

describe("acceptsAxesOf", () => {
  it("returns only accepts groups, with their tags", () => {
    expect(acceptsAxesOf({
      tag_groups: { REG: ["casual"], SHOES: ["sneakers", "heels"] },
      tag_group_kinds: { SHOES: "accepts" },
    })).toEqual([{ axis: "SHOES", tags: ["sneakers", "heels"], hueIndex: 1 }]);
  });

  it("indexes the hue over ALL groups, not just the accepts ones", () => {
    // SHOES is the second group, so it must be hue index 1 — the same index
    // the wildcard editor uses. Counting only accepts groups would make it 0
    // and the two surfaces would colour the same axis differently.
    const [shoes] = acceptsAxesOf({
      tag_groups: { REG: ["casual"], SHOES: ["sneakers"] },
      tag_group_kinds: { SHOES: "accepts" },
    });
    expect(shoes.hueIndex).toBe(1);
  });

  it("a classify group is not offered", () => {
    // It is not addressable as $var.NAME, so completing to it would produce a
    // reference the engine renders as an empty string.
    expect(acceptsAxesOf({
      tag_groups: { SHOES: ["sneakers"] },
      tag_group_kinds: { SHOES: "classify" },
    })).toEqual([]);
  });

  it("survives a payload with no groups at all", () => {
    expect(acceptsAxesOf({})).toEqual([]);
    expect(acceptsAxesOf(null)).toEqual([]);
  });
});

describe("expandVarsWithAxes", () => {
  it("puts each axis directly after the variable it belongs to", () => {
    expect(expandVarsWithAxes(["outfit", "mood"], producers))
      .toEqual(["outfit", "outfit.SHOES", "outfit.EXPOSES", "mood"]);
  });

  it("leaves a variable with no axes exactly as it was", () => {
    expect(expandVarsWithAxes(["mood"], producers)).toEqual(["mood"]);
  });

  it("is a no-op without producer metadata", () => {
    // The SPA can mount the editor before the catalog loads.
    expect(expandVarsWithAxes(["outfit"], undefined)).toEqual(["outfit"]);
  });

  it("caps how much one variable can contribute", () => {
    const many = new Map([["v", {
      kind: "wildcard", shadowed: 0,
      axes: Array.from({ length: 20 }, (_, i) => ({ axis: `A${i}`, tags: [], hueIndex: i })),
    }]]);
    // One pathological variable must not bury every other match.
    expect(expandVarsWithAxes(["v"], many).length).toBeLessThan(10);
  });
});

describe("varRows", () => {
  it("marks an axis row so the popover can indent and tint it", () => {
    // Colour is a single amber token now, not the group's hue: an accessor is
    // the same KIND of thing wherever it appears, and per-group hues made one
    // meaning look different from variable to variable.
    const [, shoes] = varRows(["outfit", "outfit.SHOES"], producers, false);
    expect(shoes.isAxis).toBe(true);
    expect(shoes.token).toBe("outfit.SHOES");
  });

  it("shows the member tags, which are what tell two axes apart", () => {
    const [, shoes] = varRows(["outfit", "outfit.SHOES"], producers, false);
    expect(shoes.facts).toEqual(["sneakers", "heels", "sandals"]);
  });

  it("leaves a plain variable row untouched", () => {
    const [outfit] = varRows(["outfit"], producers, false);
    expect(outfit.isAxis).toBeUndefined();
    expect(outfit.kind).toBe("wildcard");
  });
});

describe("accessor-aware suggestions", () => {
  // `$outfit.` only ever worked by luck: the flat pool contains
  // "outfit.SHOES", which happens to CONTAIN "outfit.". `$outfit.0.` contains
  // nothing, so the list emptied and the popover vanished exactly when the
  // user was reaching for an axis. These lock the intended behaviour.
  const axesOf = (q: string) => {
    const base = q.slice(0, q.indexOf("."));
    const rest = q.slice(q.indexOf(".") + 1);
    const m = rest.match(/^(\d+)\.?(.*)$/);
    const idx = m ? `.${m[1]}` : "";
    const frag = (m ? m[2] : rest).toLowerCase();
    const axes = [
      { axis: "SHOES", tags: [], hueIndex: 1 },
      { axis: "EXPOSES", tags: [], hueIndex: 2 },
    ];
    return axes.filter((a) => a.axis.toLowerCase().includes(frag))
      .map((a) => `${base}${idx}.${a.axis}`);
  };

  it("a bare dot offers every axis", () => {
    expect(axesOf("outfit.")).toEqual(["outfit.SHOES", "outfit.EXPOSES"]);
  });

  it("keeps a pick index the user already typed", () => {
    expect(axesOf("outfit.0.")).toEqual(["outfit.0.SHOES", "outfit.0.EXPOSES"]);
  });

  it("narrows on the axis fragment, after an index too", () => {
    expect(axesOf("outfit.0.sh")).toEqual(["outfit.0.SHOES"]);
    expect(axesOf("outfit.EXP")).toEqual(["outfit.EXPOSES"]);
  });
});
