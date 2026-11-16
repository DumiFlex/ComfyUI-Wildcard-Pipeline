import { describe, expect, it } from "vitest";
import { PLACE_TOLERANCE, place } from "./slot-place";

describe("place", () => {
  it("places a row that has no position yet", () => {
    const row = document.createElement("div");
    expect(place(row, 184.66, 0)).toBe(true);
    expect(row.style.top).toBe("184.7px");
    expect(row.style.left).toBe("0px");
  });

  it("leaves a row that is within a pixel, so a sub-pixel nudge can't loop", () => {
    const row = document.createElement("div");
    place(row, 184.7, 0);
    // The re-measure nudge shifts the field 0.3 px, then back.
    for (const top of [185, 184.7, 185, 184.7]) expect(place(row, top, 0)).toBe(false);
    expect(row.style.top).toBe("184.7px");
    expect(place(row, 184.7 + PLACE_TOLERANCE, 0)).toBe(true);
  });

  it("moves a row whose left edge changed", () => {
    const row = document.createElement("div");
    place(row, 10, 0);
    expect(place(row, 10, 12)).toBe(true);
    expect(row.style.left).toBe("12px");
  });
});
