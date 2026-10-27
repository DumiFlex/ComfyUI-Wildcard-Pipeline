import { describe, expect, it } from "vitest";
import { problemShape, stillThere } from "./pack-problems";

describe("pack problems across a rebuild", () => {
  it("matches a problem whose run count changed", () => {
    const asked = ["Constraints excluded every option; used the fallback (95 of 200 runs)"];
    expect(stillThere(asked, ["Constraints excluded every option; used the fallback (90 of 200 runs)"])).toBe(true);
  });

  it("counts a problem that went as fixed", () => {
    expect(stillThere(["reads $mood, which no run set"], ["$hat was never set"])).toBe(false);
  });

  it("drops counts and numbers from the shape", () => {
    expect(problemShape("Rule broken in 8 of 23 runs: x")).toBe(problemShape("Rule broken in 3 of 23 runs: x"));
  });
});
