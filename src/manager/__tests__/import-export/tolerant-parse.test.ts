import { describe, it, expect } from "vitest";
import { parseTolerantAsCurrentShape } from "@/manager/import-export/tolerant-parse";
import wildcardFixture from "@/validators/fixtures/v1/module-wildcard.json";

describe("parseTolerantAsCurrentShape", () => {
  it("strips unknown top-level fields", () => {
    const futureShaped = {
      ...wildcardFixture,
      nsfw: true,         // hypothetical v2 additive
      tier_label: "epic", // hypothetical v3 additive
    };
    const result = parseTolerantAsCurrentShape(futureShaped, 1, "module", "wildcard");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect("nsfw" in result.data).toBe(false);
    expect("tier_label" in result.data).toBe(false);
    expect((result.data as { id: string }).id).toBe(wildcardFixture.id);
  });

  it("returns failure when required current-shape field is missing", () => {
    const broken: Record<string, unknown> = { ...wildcardFixture };
    delete broken.payload;
    const result = parseTolerantAsCurrentShape(broken, 1, "module", "wildcard");
    expect(result.success).toBe(false);
  });

  it("recursively strips inside bundle children", () => {
    const futureBundle = {
      id: "b1",
      name: "b",
      description: "",
      color: null,
      category_id: null,
      tags: [],
      is_favorite: false,
      children: [{ ...wildcardFixture, nsfw: true }],
      ghost_field: "drop me",
    };
    const result = parseTolerantAsCurrentShape(futureBundle, 1, "bundle");
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect("ghost_field" in result.data).toBe(false);
    const data = result.data as { children: Record<string, unknown>[] };
    expect("nsfw" in data.children[0]).toBe(false);
  });
});
