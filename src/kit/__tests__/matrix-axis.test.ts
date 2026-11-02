import { describe, it, expect } from "vitest";
import { orderByGroups, toGroups, isBucket, groupLabel } from "../matrix-axis";

describe("matrix-axis", () => {
  it("orders grouped tags by axis, ungrouped last, stamping group starts", () => {
    const ordered = orderByGroups(["cool", "misc", "warm"], { hue: ["warm", "cool"] });
    expect(ordered.map((m) => m.tag)).toEqual(["warm", "cool", "misc"]);
    expect(ordered[0]).toMatchObject({ axisIndex: 0, axisName: "hue", groupStart: true });
    expect(ordered[1].groupStart).toBe(false);
    expect(ordered[2]).toMatchObject({ axisIndex: -1, groupStart: true });
  });
  it("collapses into contiguous groups; bucket = ungrouped run", () => {
    const groups = toGroups(orderByGroups(["warm", "cool", "misc"], { hue: ["warm", "cool"] }));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ axisName: "hue", grouped: true, tags: ["warm", "cool"] });
    expect(isBucket(groups[0])).toBe(false);
    expect(isBucket(groups[1])).toBe(true);
    expect(groupLabel(groups[1])).toBe("uncategorized");
  });
  it("empty groups → a single ungrouped bucket (flat fallback)", () => {
    const groups = toGroups(orderByGroups(["a", "b"], {}));
    expect(groups).toHaveLength(1);
    expect(isBucket(groups[0])).toBe(true);
  });
});
