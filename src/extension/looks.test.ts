import { describe, expect, it } from "vitest";
import { colorFieldValue, hexColor, iconName, labelColorIndex, pickedColor } from "./looks";

describe("looks", () => {
  it("keeps only #rrggbb colours and PrimeIcons names", () => {
    expect(hexColor(" #A1B2C3 ")).toBe("#a1b2c3");
    expect(hexColor("red")).toBe("");
    expect(iconName("pi-star")).toBe("star");
    expect(iconName("<b>")).toBe("");
  });
  it("maps colour fields both ways", () => {
    expect(colorFieldValue(undefined)).toBe("none");
    expect(pickedColor("#ABCDEF80")).toBe("#abcdef");
    expect(pickedColor("none")).toBeUndefined();
  });
  it("reads a label's variable colour 1..8", () => {
    expect(labelColorIndex(3)).toBe(3);
    expect(labelColorIndex(9)).toBeUndefined();
    expect(labelColorIndex("2")).toBeUndefined();
  });
});
