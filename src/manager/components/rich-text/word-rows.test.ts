import { describe, expect, it } from "vitest";
import type { ModelSuggestion, TagSuggestion } from "../../api/types";
import {
  buildWordRows, committedSuffixFor, formatTagCount, groupWordSections, SOURCE_ICON,
  tagInsertText, tagLegendFor, TAGS_WHEN_MODELS_MATCH, wordRowTextFor,
} from "./word-rows";

const tag = (name: string, category_name: TagSuggestion["category_name"] = "general"): TagSuggestion => ({
  name, matched: name, count: 10, category: null, category_name,
});
const model = (path: string): ModelSuggestion => ({ name: path, path, folder: "" });

describe("formatTagCount", () => {
  it("abbreviates by order of magnitude", () => {
    expect(formatTagCount(999)).toBe("999");
    expect(formatTagCount(855_605)).toBe("856k");
    expect(formatTagCount(1_250_000)).toBe("1.3M");
  });
});

describe("buildWordRows", () => {
  const tags = Array.from({ length: 10 }, (_, i) => tag(`t${i}`));

  it("keeps every tag when no model matched", () => {
    expect(buildWordRows(tags, {})).toHaveLength(10);
  });

  it("caps tags when a model matched, then orders loras before embeddings", () => {
    const rows = buildWordRows(tags, { embedding: [model("e")], lora: [model("l")] });
    expect(rows).toHaveLength(TAGS_WHEN_MODELS_MATCH + 2);
    expect(rows.map((r) => r.source).slice(-2)).toEqual(["lora", "embedding"]);
  });
});

describe("groupWordSections", () => {
  it("groups by source and carries flat indices", () => {
    const rows = buildWordRows([tag("a")], { embedding: [model("e")] });
    expect(groupWordSections(rows).map((s) => [s.source, s.label, s.rows.map((r) => r.index)]))
      .toEqual([["tag", "tags", [0]], ["embedding", "embeddings", [1]]]);
    expect(groupWordSections([])).toEqual([]);
  });

  it("has an icon per source", () => {
    expect(Object.keys(SOURCE_ICON).sort()).toEqual(["embedding", "lora", "tag"]);
  });
});

describe("committedSuffixFor / wordRowTextFor", () => {
  it("adds the separator only outside a model reference", () => {
    expect(committedSuffixFor(false, true)).toBe(", ");
    expect(committedSuffixFor(false, false)).toBe("");
    expect(committedSuffixFor(true, true)).toBe("");
  });

  it("builds the inserted text per source", () => {
    expect(wordRowTextFor({ source: "tag", tag: tag("blue_hair") }, false)).toBe("blue_hair");
    expect(wordRowTextFor({ source: "lora", model: model("x/y") }, false)).toBe("<lora:x/y:1.0>");
    expect(wordRowTextFor({ source: "embedding", model: model("z") }, false)).toBe("embedding:z");
    expect(wordRowTextFor({ source: "lora", model: model("x/y") }, true)).toBe("x/y");
  });

  it("writes a tag in the chosen style and leaves model paths alone", () => {
    const both = { spaces: true, escape: true };
    expect(wordRowTextFor({ source: "tag", tag: tag("fate_(series)") }, false, both)).toBe("fate \\(series\\)");
    expect(wordRowTextFor({ source: "lora", model: model("my_lora_(v2)") }, false, both)).toBe("<lora:my_lora_(v2):1.0>");
    expect(wordRowTextFor({ source: "embedding", model: model("bad_hands") }, false, both)).toBe("embedding:bad_hands");
  });
});

describe("tagInsertText", () => {
  const off = { spaces: false, escape: false };
  it("keeps the tag as listed when both are off", () => {
    expect(tagInsertText("fate_(series)", off)).toBe("fate_(series)");
  });
  it("swaps underscores for spaces, except on short emoticon tags", () => {
    expect(tagInsertText("blue_hair", { ...off, spaces: true })).toBe("blue hair");
    expect(tagInsertText("^_^", { ...off, spaces: true })).toBe("^_^");
    expect(tagInsertText("o_o", { ...off, spaces: true })).toBe("o_o");
  });
  it("escapes brackets once", () => {
    expect(tagInsertText("fate_(series)", { ...off, escape: true })).toBe("fate_\\(series\\)");
    expect(tagInsertText("a_\\(b\\)", { ...off, escape: true })).toBe("a_\\(b\\)");
  });
});

describe("tagLegendFor", () => {
  it("is empty without categories or with only one kind on screen", () => {
    expect(tagLegendFor([tag("a", "artist"), tag("b")], false)).toEqual([]);
    expect(tagLegendFor([tag("a"), tag("b")], true)).toEqual([]);
  });

  it("lists present categories in Danbooru order", () => {
    expect(tagLegendFor([tag("a"), tag("b", "artist"), tag("c", null), tag("d", "character")], true))
      .toEqual(["character", "artist", "general"]);
  });
});
