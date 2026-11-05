import { describe, expect, it } from "vitest";
import type { ModelSuggestion, TagSuggestion } from "../../api/types";
import {
  buildWordRows, committedSuffixFor, formatTagCount, groupWordSections, SOURCE_ICON,
  tagInsertText, tagLegendFor, TAGS_WHEN_MODELS_MATCH, wordRowCommitFor, wordRowTextFor,
  type WordRow,
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
    expect(wordRowTextFor({ source: "tag", tag: tag("blue_hair") })).toBe("blue_hair");
    expect(wordRowTextFor({ source: "lora", model: model("x/y") })).toBe("<lora:x/y:1.0>");
    expect(wordRowTextFor({ source: "embedding", model: model("z") })).toBe("embedding:z");
  });

  it("writes a tag in the chosen style and leaves model paths alone", () => {
    const both = { spaces: true, escape: true };
    expect(wordRowTextFor({ source: "tag", tag: tag("fate_(series)") }, both)).toBe("fate \\(series\\)");
    expect(wordRowTextFor({ source: "lora", model: model("my_lora_(v2)") }, both)).toBe("<lora:my_lora_(v2):1.0>");
    expect(wordRowTextFor({ source: "embedding", model: model("bad_hands") }, both)).toBe("embedding:bad_hands");
  });
});

describe("wordRowCommitFor", () => {
  const PATH = "style\\2X-KO_more_-ill_r1.safetensors";
  const lora: WordRow = { source: "lora", model: model(PATH) };
  const embed: WordRow = { source: "embedding", model: model("hands\\lazyhand.safetensors") };
  const off = { separator: false };
  const on = { separator: true };

  /** Apply a commit with the caret at `|` and the typed word/name starting at
   *  `^` (defaults to the caret). Returns the text with `|` at the new caret. */
  function run(marked: string, row: WordRow, refKind: "lora" | "embedding" | null, opts = off): string {
    const startMark = marked.indexOf("^");
    const plain = marked.replace("^", "");
    const caret = plain.indexOf("|");
    const text = plain.replace("|", "");
    const start = startMark >= 0 && startMark < caret + 1 ? startMark : caret;
    const c = wordRowCommitFor(text, caret, start, row, refKind, opts);
    const out = text.slice(0, c.start) + c.insert + text.slice(c.end);
    const at = c.start + c.insert.length;
    return `${out.slice(0, at)}|${out.slice(at)}`;
  }

  it("closes a LoRA reference typed up to its name (the reported bug)", () => {
    expect(run("girl, <lora:^style\\2X|", lora, "lora")).toBe(`girl, <lora:${PATH}:1.0>|`);
    expect(run("<lora:^|", lora, "lora")).toBe(`<lora:${PATH}:1.0>|`);
  });

  it("adds the separator after a LoRA it just closed, unless a comma follows", () => {
    expect(run("<lora:^sty|", lora, "lora", on)).toBe(`<lora:${PATH}:1.0>, |`);
    expect(run("<lora:^sty|, hat", lora, "lora", on)).toBe(`<lora:${PATH}:1.0>|, hat`);
  });

  it("replaces the rest of an existing name and keeps its weight", () => {
    expect(run("<lora:^sty|le_old:0.6>, hat", lora, "lora", on)).toBe(`<lora:${PATH}:0.6>|, hat`);
  });

  it("gives an auto-closed `<lora:>` the default weight", () => {
    expect(run("<lora:^sty|>", lora, "lora")).toBe(`<lora:${PATH}:1.0>|`);
  });

  it("does not eat the next LoRA when this one is unclosed", () => {
    expect(run("<lora:^sty| girl <lora:x:1>", lora, "lora")).toBe(`<lora:${PATH}:1.0>| girl <lora:x:1>`);
  });

  it("absorbs a `<` the user typed before a bare word", () => {
    expect(run("girl, <^sty|", lora, null)).toBe(`girl, <lora:${PATH}:1.0>|`);
    expect(run("<^sty|>", lora, null)).toBe(`<lora:${PATH}:1.0>|`);
    expect(run("<^lazy|", embed, null)).toBe("embedding:hands\\lazyhand.safetensors|");
  });

  it("writes the whole reference for a bare word", () => {
    expect(run("girl ^sty|", lora, null, on)).toBe(`girl <lora:${PATH}:1.0>, |`);
    expect(run("^lazy|", embed, null)).toBe("embedding:hands\\lazyhand.safetensors|");
  });

  it("completes an embedding reference and replaces the rest of its name", () => {
    expect(run("embedding:^la|", embed, "embedding")).toBe("embedding:hands\\lazyhand.safetensors|");
    expect(run("embedding:^la|zy_old, hat", embed, "embedding")).toBe("embedding:hands\\lazyhand.safetensors|, hat");
    expect(run("(embedding:^la|:1.2)", embed, "embedding")).toBe("(embedding:hands\\lazyhand.safetensors|:1.2)");
  });

  it("turns `<embedding:…>` into the syntax ComfyUI reads", () => {
    expect(run("<embedding:^la|>", embed, "embedding")).toBe("embedding:hands\\lazyhand.safetensors|");
    expect(run("<embedding:^la|", embed, "embedding", on)).toBe("embedding:hands\\lazyhand.safetensors, |");
  });

  it("leaves tags as before", () => {
    expect(run("^blu|", { source: "tag", tag: tag("blue_hair") }, null, on)).toBe("blue_hair, |");
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
