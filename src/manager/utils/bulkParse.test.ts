import { describe, expect, it } from "vitest";
import {
  parseBulkOptionLine,
  parseBulkOptions,
  summarizeBulkOptions,
  parseBulkFixedValues,
} from "./bulkParse";

describe("parseBulkOptionLine", () => {
  it("plain value → weight 1, no tags", () => {
    expect(parseBulkOptionLine("serene")).toEqual({ value: "serene", tags: [], weight: 1 });
  });
  it("multi-word value is preserved", () => {
    expect(parseBulkOptionLine("sun-drenched glow")).toEqual({ value: "sun-drenched glow", tags: [], weight: 1 });
  });
  it("trailing #tags are parsed, value trimmed", () => {
    expect(parseBulkOptionLine("radiant #warm #vivid")).toEqual({ value: "radiant", tags: ["warm", "vivid"], weight: 1 });
  });
  it("*N sets the weight", () => {
    expect(parseBulkOptionLine("brooding *3")).toEqual({ value: "brooding", tags: [], weight: 3 });
  });
  it("decimal weight", () => {
    expect(parseBulkOptionLine("rare *1.5")).toEqual({ value: "rare", tags: [], weight: 1.5 });
  });
  it("modifiers are order-free (mix of *N and #tags)", () => {
    expect(parseBulkOptionLine("wistful *2 #cool #muted")).toEqual({ value: "wistful", tags: ["cool", "muted"], weight: 2 });
    expect(parseBulkOptionLine("wistful #cool *2 #muted")).toEqual({ value: "wistful", tags: ["cool", "muted"], weight: 2 });
  });
  it("only TRAILING modifiers count — a literal # mid-value stays in the value", () => {
    expect(parseBulkOptionLine("neon #1 sign #vivid")).toEqual({ value: "neon #1 sign", tags: ["vivid"], weight: 1 });
  });
  it("de-dupes repeated tags within a line", () => {
    expect(parseBulkOptionLine("x #warm #warm")).toEqual({ value: "x", tags: ["warm"], weight: 1 });
  });
  it("blank / only-modifier lines → null", () => {
    expect(parseBulkOptionLine("   ")).toBeNull();
    expect(parseBulkOptionLine("#warm")).toBeNull();
    expect(parseBulkOptionLine("*3 #warm")).toBeNull();
  });
});

describe("parseBulkOptions", () => {
  it("splits lines, drops blanks + only-modifier lines", () => {
    const out = parseBulkOptions("radiant #warm\n\n   \nbrooding *3\n#orphan");
    expect(out).toEqual([
      { value: "radiant", tags: ["warm"], weight: 1 },
      { value: "brooding", tags: [], weight: 3 },
    ]);
  });
});

describe("summarizeBulkOptions", () => {
  it("counts new / tagged / weighted / new-tags / duplicates (case-insensitive)", () => {
    const parsed = parseBulkOptions([
      "radiant #warm #vivid",
      "wistful *2 #cool",
      "serene",          // duplicate vs existing
      "Sleepy",          // duplicate vs existing (case-insensitive)
      "radiant #warm",   // duplicate within paste
    ].join("\n"));
    const s = summarizeBulkOptions(parsed, new Set(["serene", "sleepy"]), new Set(["calm", "intense"]));
    expect(s.add.map((o) => o.value)).toEqual(["radiant", "wistful"]);
    expect(s.duplicates).toBe(3);
    expect(s.tagged).toBe(2);
    expect(s.weighted).toBe(1);
    expect(s.newTags).toEqual(["warm", "vivid", "cool"]);
  });
  it("a tag already present is not flagged new", () => {
    const parsed = parseBulkOptions("x #calm #warm");
    const s = summarizeBulkOptions(parsed, new Set(), new Set(["calm"]));
    expect(s.newTags).toEqual(["warm"]);
  });
});

describe("parseBulkFixedValues", () => {
  it("parses name = value, trims, skips blanks + no-`=` lines", () => {
    const out = parseBulkFixedValues("cfg = 4.5\nsteps=30\n\nbroken line\nscheduler = karras");
    expect(out).toEqual([
      { name: "cfg", value: "4.5" },
      { name: "steps", value: "30" },
      { name: "scheduler", value: "karras" },
    ]);
  });
  it("first `=` splits, so values may contain `=`", () => {
    expect(parseBulkFixedValues("url = http://x?a=b&c=d")).toEqual([{ name: "url", value: "http://x?a=b&c=d" }]);
  });
  it("empty name is skipped", () => {
    expect(parseBulkFixedValues(" = orphan")).toEqual([]);
  });
});

describe("negatives ( -- words)", () => {
  it("the first ` -- ` splits off the negative", () => {
    expect(parseBulkOptionLine("strawberry blonde -- strawberry, fruit")).toEqual({
      value: "strawberry blonde", tags: [], weight: 1, negative: "strawberry, fruit",
    });
  });
  it("modifiers may trail the value side", () => {
    expect(parseBulkOptionLine("strawberry blonde #warm *2 -- strawberry, fruit")).toEqual({
      value: "strawberry blonde", tags: ["warm"], weight: 2, negative: "strawberry, fruit",
    });
  });
  it("modifiers may trail the negative side", () => {
    expect(parseBulkOptionLine("jet black -- blue tint #cool")).toEqual({
      value: "jet black", tags: ["cool"], weight: 1, negative: "blue tint",
    });
  });
  it("modifiers on both sides merge, de-duped", () => {
    expect(parseBulkOptionLine("jet black #cool -- blue tint #cool #dark *3")).toEqual({
      value: "jet black", tags: ["cool", "dark"], weight: 3, negative: "blue tint",
    });
  });
  it("only the FIRST ` -- ` splits; later ones stay in the negative", () => {
    expect(parseBulkOptionLine("a -- b -- c")).toEqual({ value: "a", tags: [], weight: 1, negative: "b -- c" });
  });
  it("`--` without surrounding whitespace is part of the value", () => {
    expect(parseBulkOptionLine("well--known")).toEqual({ value: "well--known", tags: [], weight: 1 });
  });
  it("an empty negative is dropped (no key)", () => {
    expect(parseBulkOptionLine("serene -- ")).toEqual({ value: "serene", tags: [], weight: 1 });
    expect(parseBulkOptionLine("serene -- #warm")).toEqual({ value: "serene", tags: ["warm"], weight: 1 });
  });
  it("a line with only a negative has no value → null", () => {
    expect(parseBulkOptionLine("#warm -- fruit")).toBeNull();
  });
  it("a negative keeps {a|b} and @{ref} text verbatim", () => {
    expect(parseBulkOptionLine("x -- {dry|arid}, @{abcd1234}")?.negative).toBe("{dry|arid}, @{abcd1234}");
  });
  it("summarize counts options with a negative", () => {
    const parsed = parseBulkOptions([
      "strawberry blonde #warm *2 -- strawberry, fruit",
      "platinum bob #cool",
      "ginger curls #warm -- orange fruit",
      "jet black -- blue tint #cool",
    ].join("\n"));
    const s = summarizeBulkOptions(parsed, new Set(), new Set(["warm", "cool"]));
    expect(s.add).toHaveLength(4);
    expect(s.withNegative).toBe(3);
    expect(s.tagged).toBe(4);
    expect(s.weighted).toBe(1);
  });
  it("fixed values: `name = value -- negative`", () => {
    expect(parseBulkFixedValues("style = oil painting -- photo, 3d render\nlens = 85mm\nx = a=b -- ")).toEqual([
      { name: "style", value: "oil painting", negative: "photo, 3d render" },
      { name: "lens", value: "85mm" },
      { name: "x", value: "a=b" },
    ]);
  });
});
