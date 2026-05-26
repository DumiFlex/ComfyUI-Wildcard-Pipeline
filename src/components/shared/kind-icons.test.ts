import { describe, expect, it } from "vitest";
import { kindIcon, KIND_ICON_MAP } from "./kind-icons";

describe("kind-icons", () => {
  it("returns the canonical PrimeIcons class for each module kind", () => {
    expect(kindIcon("wildcard")).toBe("pi pi-sparkles");
    expect(kindIcon("fixed_values")).toBe("pi pi-tag");
    expect(kindIcon("combine")).toBe("pi pi-link");
    expect(kindIcon("derivation")).toBe("pi pi-arrow-right-arrow-left");
    expect(kindIcon("constraint")).toBe("pi pi-filter");
    expect(kindIcon("loop")).toBe("pi pi-replay");
  });

  it("falls back to a neutral circle icon for unknown kinds", () => {
    // We pass an unknown string explicitly; cast keeps strict TS happy.
    expect(kindIcon("mystery" as unknown as keyof typeof KIND_ICON_MAP)).toBe("pi pi-circle");
  });
});
