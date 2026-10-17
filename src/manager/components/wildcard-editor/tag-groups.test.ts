import { describe, expect, it } from "vitest";
import { axisHueAt, UNGROUPED_HUE } from "../../../components/shared/axis-color";
import { NEG_ACCESSOR } from "../../../widgets/richTokenize";
import {
  acceptsNameProblem,
  acceptsPromotionRefusal,
  acceptsRenameRefusal,
  axisHueFor,
  axisIndexOf,
  axisUncoveredCount,
  buildSubcatGroups,
  moveTagToAxis,
  moveTargetsFor,
  nextGroupName,
  normalizeTagGroupKinds,
  normalizeTagGroups,
  OTHER_AXIS,
  removeAxis,
  renameAxis,
  serializeTagGroupKinds,
  serializeTagGroups,
  subcatSummaryText,
  tagChipStyle,
  tagUsageCount,
  toggledOptionTags,
  totalWeightOf,
} from "./tag-groups";

const REG = ["red", "blue", "silk", "wool", "loose"];
const GROUPS = { color: ["blue", "red"], fabric: ["silk", "wool"] };

describe("buildSubcatGroups", () => {
  it("keeps registry order inside each axis and trails an ungrouped box", () => {
    expect(buildSubcatGroups(GROUPS, REG)).toEqual([
      { axis: "color", tags: ["red", "blue"], isOther: false },
      { axis: "fabric", tags: ["silk", "wool"], isOther: false },
      { axis: OTHER_AXIS, tags: ["loose"], isOther: true },
    ]);
  });

  it("omits the ungrouped box when every tag is claimed, keeps empty axes", () => {
    const g = buildSubcatGroups({ a: ["x"], b: [] }, ["x"]);
    expect(g.map((b) => b.axis)).toEqual(["a", "b"]);
  });

  it("shows one empty ungrouped box when there are no axes at all", () => {
    expect(buildSubcatGroups({}, [])).toEqual([{ axis: OTHER_AXIS, tags: [], isOther: true }]);
  });
});

describe("subcatSummaryText", () => {
  it("reports tags and axes with plurals", () => {
    expect(subcatSummaryText([], {})).toBe("No sub-categories yet.");
    expect(subcatSummaryText(["a"], {})).toBe("1 tag");
    expect(subcatSummaryText(["a", "b"], { x: ["a"] })).toBe("2 tags across 1 axis");
    expect(subcatSummaryText(REG, GROUPS)).toBe("5 tags across 2 axes");
  });
});

describe("axis colours", () => {
  it("indexes a tag by its axis, -1 when ungrouped", () => {
    expect(axisIndexOf(GROUPS, "silk")).toBe(1);
    expect(axisIndexOf(GROUPS, "loose")).toBe(-1);
  });

  it("styles chips and boxes from the shared palette", () => {
    expect(tagChipStyle(GROUPS, "red")).toEqual({ "--chip-hue": axisHueAt(0) });
    expect(axisHueFor(GROUPS, "fabric")).toBe(axisHueAt(1));
    expect(axisHueFor(GROUPS, OTHER_AXIS)).toBe(UNGROUPED_HUE);
  });
});

describe("coverage counts", () => {
  const opts = [
    { sub_categories: ["red", "silk"] },
    { sub_categories: ["blue"] },
    { sub_categories: [] },
    { is_null: true },
  ];

  it("counts options carrying a tag", () => {
    expect(tagUsageCount(opts, "red")).toBe(1);
    expect(tagUsageCount(opts, "wool")).toBe(0);
  });

  it("counts non-null options with no tag from an axis", () => {
    expect(axisUncoveredCount(opts, GROUPS, "color")).toBe(1);
    expect(axisUncoveredCount(opts, GROUPS, "fabric")).toBe(2);
    expect(axisUncoveredCount(opts, { empty: [] }, "empty")).toBe(0);
  });
});

describe("nextGroupName", () => {
  it("skips names already taken", () => {
    expect(nextGroupName({})).toBe("group 1");
    expect(nextGroupName({ a: [], "group 2": [] })).toBe("group 3");
    expect(nextGroupName({ "group 2": [] })).toBe("group 3");
  });
});

describe("accepts name checks", () => {
  it("classifies names", () => {
    expect(acceptsNameProblem("shoes")).toBeNull();
    expect(acceptsNameProblem(NEG_ACCESSOR)).toBe("neg");
    expect(acceptsNameProblem("group 1")).toBe("ident");
    expect(acceptsNameProblem("1st")).toBe("ident");
  });

  it("words promotion refusals", () => {
    expect(acceptsPromotionRefusal("shoes")).toBeNull();
    expect(acceptsPromotionRefusal(NEG_ACCESSOR)?.summary).toBe(`Rename "${NEG_ACCESSOR}" first`);
    expect(acceptsPromotionRefusal("group 1")?.detail).toContain("letters, digits and underscores");
  });

  it("words rename refusals", () => {
    expect(acceptsRenameRefusal("shoes", "boots")).toBeNull();
    expect(acceptsRenameRefusal("shoes", NEG_ACCESSOR)?.summary).toBe('"shoes" keeps its name');
    expect(acceptsRenameRefusal("shoes", "my shoes")?.detail).toContain("Switch it to classify first");
  });
});

describe("renameAxis / removeAxis", () => {
  it("renames in place, carrying the kind", () => {
    const r = renameAxis(GROUPS, { color: "accepts" }, "color", "hue");
    expect(Object.keys(r.groups)).toEqual(["hue", "fabric"]);
    expect(r.groups.hue).toEqual(GROUPS.color);
    expect(r.kinds).toEqual({ hue: "accepts" });
  });

  it("returns the same kinds object when the axis has no kind", () => {
    const kinds = { fabric: "accepts" as const };
    expect(renameAxis(GROUPS, kinds, "color", "hue").kinds).toBe(kinds);
    expect(removeAxis(GROUPS, kinds, "color").kinds).toBe(kinds);
  });

  it("removes an axis and its kind without touching the input", () => {
    const r = removeAxis(GROUPS, { color: "accepts" }, "color");
    expect(r.groups).toEqual({ fabric: ["silk", "wool"] });
    expect(r.kinds).toEqual({});
    expect(GROUPS.color).toEqual(["blue", "red"]);
  });
});

describe("moving tags", () => {
  it("offers the other axes plus ungrouped", () => {
    expect(moveTargetsFor(GROUPS, "color")).toEqual([
      { axis: "fabric", label: "fabric" },
      { axis: OTHER_AXIS, label: "ungrouped" },
    ]);
    expect(moveTargetsFor(GROUPS, OTHER_AXIS).map((t) => t.axis)).toEqual(["color", "fabric"]);
  });

  it("moves a tag so it lives in one axis at most", () => {
    expect(moveTagToAxis(GROUPS, "red", "fabric")).toEqual({
      color: ["blue"],
      fabric: ["silk", "wool", "red"],
    });
    expect(moveTagToAxis(GROUPS, "red", OTHER_AXIS)).toEqual({
      color: ["blue"],
      fabric: ["silk", "wool"],
    });
  });
});

describe("option helpers", () => {
  it("toggles a tag and keeps registry order", () => {
    expect(toggledOptionTags(REG, ["silk"], "red")).toEqual(["red", "silk"]);
    expect(toggledOptionTags(REG, ["red", "silk"], "red")).toEqual(["silk"]);
  });

  it("sums weights with a floor of 1", () => {
    expect(totalWeightOf([{ weight: 2 }, { weight: "3" }, { weight: "x" }])).toBe(5);
    expect(totalWeightOf([{ weight: 0 }])).toBe(1);
    expect(totalWeightOf([])).toBe(1);
  });
});

describe("normalise / serialise", () => {
  it("normalises raw groups against the registry", () => {
    expect(normalizeTagGroups(null, REG)).toEqual({});
    expect(normalizeTagGroups({ a: ["red", "ghost", 3, "red"], b: ["red", "silk"], c: "bad" }, REG))
      .toEqual({ a: ["red"], b: ["silk"], c: [] });
  });

  it("keeps only accepts kinds that name a group", () => {
    expect(normalizeTagGroupKinds(undefined, GROUPS)).toEqual({});
    expect(normalizeTagGroupKinds({ color: "accepts", fabric: "classify", ghost: "accepts" }, GROUPS))
      .toEqual({ color: "accepts" });
  });

  it("drops empty axes unless asked to keep them", () => {
    const groups = { color: ["red", "ghost"], empty: [] };
    expect(serializeTagGroups(groups, REG, false)).toEqual({ color: ["red"] });
    expect(serializeTagGroups(groups, REG, true)).toEqual({ color: ["red"], empty: [] });
    expect(serializeTagGroups({ empty: [] }, REG, false)).toBeNull();
  });

  it("serialises kinds only for surviving groups", () => {
    const kinds = { color: "accepts" as const, empty: "accepts" as const };
    expect(serializeTagGroupKinds(kinds, { color: ["red"] })).toEqual({ color: "accepts" });
    expect(serializeTagGroupKinds(kinds, null)).toBeNull();
    expect(serializeTagGroupKinds({}, { color: ["red"] })).toBeNull();
  });
});
