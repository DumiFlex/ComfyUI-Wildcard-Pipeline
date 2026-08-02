import { describe, it, expect } from "vitest";
import { duplicateNames, entitySelectOptions, type CategoryLike } from "../entity-select-options";

const noCats = new Map<string, CategoryLike>();

const wildcard = (id: string, name: string, options: number, category_id?: string) => ({
  id,
  name,
  category_id: category_id ?? null,
  payload: {
    options: Array.from({ length: options }, (_, i) => ({ id: `o${i}`, value: `v${i}` })),
  },
});

describe("duplicateNames", () => {
  it("finds a name used twice", () => {
    expect([...duplicateNames([wildcard("a", "Lighting", 1), wildcard("b", "Lighting", 1)])])
      .toEqual(["lighting"]);
  });

  it("ignores case and surrounding space — a reader sees one name", () => {
    expect(duplicateNames([wildcard("a", "Lighting", 1), wildcard("b", " lighting ", 1)]).size)
      .toBe(1);
  });

  it("is empty when every name is distinct", () => {
    expect(duplicateNames([wildcard("a", "Indoor", 1), wildcard("b", "Outdoor", 1)]).size).toBe(0);
  });
});

describe("entitySelectOptions", () => {
  it("carries the payload detail that tells same-kind rows apart", () => {
    const [opt] = entitySelectOptions([wildcard("aabbccdd", "Lighting", 10)], "wildcard", noCats);
    expect(opt.label).toBe("Lighting");
    expect(opt.meta).toContain("10 options");
  });

  it("appends a uuid ONLY to names that are actually ambiguous", () => {
    const opts = entitySelectOptions(
      [wildcard("aaaaaaaa", "Lighting", 2), wildcard("bbbbbbbb", "Lighting", 3), wildcard("cccccccc", "Mood", 4)],
      "wildcard",
      noCats,
    );
    expect(opts[0].meta).toContain("#aaaaaaaa");
    expect(opts[1].meta).toContain("#bbbbbbbb");
    // The unique name spends none of its width on a string nobody can read.
    expect(opts[2].meta).not.toContain("#");
  });

  it("puts the uuid last, so it reads as a tiebreaker not an identity", () => {
    const opts = entitySelectOptions(
      [wildcard("aaaaaaaa", "Lighting", 2), wildcard("bbbbbbbb", "Lighting", 3)],
      "wildcard",
      noCats,
    );
    expect(opts[0].meta?.endsWith("#aaaaaaaa")).toBe(true);
  });

  it("leads with the category, and carries its icon and colour", () => {
    const cats = new Map<string, CategoryLike>([
      ["c1", { name: "Subject", color: "#f80", icon: "user" }],
    ]);
    const [opt] = entitySelectOptions([wildcard("aabbccdd", "Hair", 5, "c1")], "wildcard", cats);
    expect(opt.meta?.startsWith("Subject")).toBe(true);
    expect(opt.icon).toBe("user");
    expect(opt.dot).toBe("#f80");
  });

  it("leaves icon and dot unset when the row has no category", () => {
    const [opt] = entitySelectOptions([wildcard("aabbccdd", "Hair", 5)], "wildcard", noCats);
    expect(opt.icon).toBeUndefined();
    expect(opt.dot).toBeUndefined();
  });

  it("summarises a bundle by its children rather than a payload", () => {
    const [opt] = entitySelectOptions(
      [{ id: "b1", name: "Portrait", children: [{ type: "wildcard" }, { type: "bundle" }] }],
      "bundle",
      noCats,
    );
    expect(opt.meta).toContain("2 modules");
    expect(opt.meta).toContain("1 nested");
  });

  it("omits meta entirely when there is nothing worth showing", () => {
    // `undefined`, never "", so Select can `v-if` the element away rather than
    // render an empty span that still occupies its column.
    const [opt] = entitySelectOptions([{ id: "x1", name: "Bare" }], "category", noCats);
    expect(opt.meta).toBeUndefined();
  });

  it("returns an empty list for an empty pool", () => {
    expect(entitySelectOptions([], "wildcard", noCats)).toEqual([]);
  });
});
