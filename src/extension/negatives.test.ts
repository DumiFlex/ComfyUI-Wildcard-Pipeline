import { describe, expect, it } from "vitest";
import {
  buildNegativePreview,
  entriesForReads,
  hasSlot,
  joinUnique,
  missingAssemblerVars,
  negativeTemplateVars,
  renderNegative,
  splitTags,
  tagKey,
  templateReads,
  tidy,
  type NegativesTable,
} from "./negatives";
import type { ResolvedValue } from "../widgets/richTokenize";

// Mirrors engine/negatives.py; the cases follow tests/engine/test_negatives.py.

const identity = (t: string) => t;

describe("tag handling", () => {
  it("splits on top-level commas only", () => {
    expect(splitTags("a, (b, c), [d, e], {f|g, h}, , i")).toEqual([
      "a", "(b, c)", "[d, e]", "{f|g, h}", "i",
    ]);
  });

  it("keys ignore case, spacing and a single weight wrap", () => {
    expect(tagKey("  Bad   Hands ")).toBe("bad hands");
    expect(tagKey("(bad hands:1.2)")).toBe("bad hands");
    expect(tagKey("((bad hands))")).toBe("bad hands");
    // Nested parens inside the wrap are not a plain weight wrap.
    expect(tagKey("(a (b))")).toBe("(a (b))");
  });

  it("joinUnique is paren-aware and case-insensitive, first wins", () => {
    expect(joinUnique(["(bad hands:1.2), a (b, c)", "Bad Hands, A (b, c)"])).toBe(
      "(bad hands:1.2), a (b, c)",
    );
  });

  it("joinUnique skips tags in skip", () => {
    expect(joinUnique(["blonde, lowres"], ["LOWRES"])).toBe("blonde");
  });

  it("tidy collapses spaces and empty comma slots", () => {
    expect(tidy(" ,a,  , b   c,, ")).toBe("a, b c");
  });

  it("hasSlot needs the whole word", () => {
    expect(hasSlot("x, $negatives")).toBe(true);
    expect(hasSlot("x, $negatives_extra")).toBe(false);
  });
});

describe("renderNegative", () => {
  it("empty template is just the words", () => {
    expect(renderNegative("", "blonde, lowres", identity)).toBe("blonde, lowres");
    expect(renderNegative("   ", "blonde", identity)).toBe("blonde");
  });

  it("places the words at the slot and skips tags the template says", () => {
    expect(renderNegative("worst quality, $negatives, lowres", "blonde, lowres", identity)).toBe(
      "worst quality, blonde, lowres",
    );
  });

  it("appends when there is no slot", () => {
    expect(renderNegative("worst quality", "blonde, lowres", identity)).toBe(
      "worst quality, blonde, lowres",
    );
    expect(renderNegative("worst quality", "", identity)).toBe("worst quality");
  });

  it("an empty collection leaves no stray comma at the slot", () => {
    expect(renderNegative("lowres, $negatives", "", identity)).toBe("lowres");
  });

  it("renders the template's own text through resolveRaw", () => {
    const raw = (t: string) => t.replace("$mood", "happy");
    expect(renderNegative("not $mood, $negatives", "blonde", raw)).toBe("not happy, blonde");
  });
});

describe("follow usage", () => {
  const resolved: Record<string, ResolvedValue> = {
    hair: "red hair",
    props: { items: ["sword", "shield"], sep: ", " },
    outfit: "armor",
  };
  const table: NegativesTable = {
    hair: [{ text: "blonde, lowres", pick: null }],
    props: [{ text: "gun", pick: 0 }, { text: "tank", pick: 1 }],
    outfit: [{ text: "Lowres, torn clothes", pick: null }],
    unused: [{ text: "NOT USED", pick: null }],
  };

  it("reads skip missing (or internal-stripped) vars and empty index reads", () => {
    expect(templateReads("$hair $gone $props.1 $props.5 $outfit.SHOES", resolved)).toEqual([
      { name: "hair", index: null },
      { name: "props", index: 1 },
      { name: "outfit", index: null },
    ]);
  });

  it("$x.N carries pick N only, $x every pick", () => {
    const one = entriesForReads(table, [{ name: "props", index: 1 }]);
    expect(one.map((e) => e.text)).toEqual(["tank"]);
    const all = entriesForReads(table, [{ name: "props", index: null }, { name: "props", index: 0 }]);
    expect(all.map((e) => e.text)).toEqual(["gun", "tank"]);
  });

  it("builds the preview: follows usage, dedupes, attributes tags", () => {
    const p = buildNegativePreview({
      template: "$hair, $outfit",
      negativeTemplate: "",
      resolved,
      negatives: table,
      resolveRaw: identity,
    });
    expect(p.text).toBe("blonde, lowres, torn clothes");
    expect(p.tags).toEqual([
      { text: "blonde", varName: "hair" },
      { text: "lowres", varName: "hair" },
      { text: "torn clothes", varName: "outfit" },
    ]);
    expect(p.fromVars).toEqual(["hair", "outfit"]);
  });

  it("template tags are not attributed to a variable", () => {
    const p = buildNegativePreview({
      template: "$hair",
      negativeTemplate: "lowres, $negatives",
      resolved,
      negatives: table,
      resolveRaw: identity,
    });
    expect(p.text).toBe("lowres, blonde");
    expect(p.tags).toEqual([{ text: "lowres" }, { text: "blonde", varName: "hair" }]);
  });

  it("an internal variable (absent from the renderable map) adds nothing", () => {
    const p = buildNegativePreview({
      template: "$hair",
      negativeTemplate: "",
      resolved: {},
      negatives: table,
      resolveRaw: identity,
    });
    expect(p.text).toBe("");
    expect(p.fromVars).toEqual([]);
  });
});

describe("missingAssemblerVars", () => {
  it("scans both templates, $negatives reserved only in the negative one", () => {
    expect(missingAssemblerVars("$hair $gone $__wp_x", "$negatives, $mood, $gone", ["hair"])).toEqual([
      "gone", "mood",
    ]);
    expect(missingAssemblerVars("$negatives", "", [])).toEqual(["negatives"]);
    expect(missingAssemblerVars("", "$negatives", [])).toEqual([]);
  });
});

describe("negativeTemplateVars", () => {
  it("lists vars and leaves out the reserved slot", () => {
    expect(negativeTemplateVars("not $mood, $negatives, $mood.0, $negatives_x")).toEqual([
      "mood", "negatives_x",
    ]);
  });
});
