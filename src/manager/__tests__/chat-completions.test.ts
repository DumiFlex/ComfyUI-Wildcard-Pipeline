import { describe, expect, it } from "vitest";
import {
  applyRow, matchItems, matchVars, mentionItems, mentionRefs, probeChat, type ChatRow, type MentionItem,
} from "../utils/chat-completions";

const ITEMS: MentionItem[] = [
  { id: "aaaa0001", name: "Hairstyle", kind: "wildcard", variable: "hair" },
  { id: "aaaa0002", name: "Hair Color", kind: "wildcard", variable: "hair_color" },
  { id: "aaaa0003", name: "Outfit [winter]", kind: "combine", variable: "outfit" },
  { id: "bbbb0001", name: "Fantasy pack", kind: "bundle" },
];

describe("probeChat", () => {
  it("finds @ items, $ vars, model refs and bare words", () => {
    expect(probeChat("more options for @hai", 21)).toEqual({ mode: "item", start: 17, query: "hai" });
    expect(probeChat("use $hair_c", 11)).toEqual({ mode: "var", start: 4, query: "hair_c" });
    expect(probeChat("add <lora:styl", 14)).toEqual({ mode: "model", start: 10, query: "styl", kind: "lora" });
    expect(probeChat("blonde", 6)).toEqual({ mode: "word", start: 0, query: "blonde" });
  });
  it("stays closed on escapes, accessors and short words", () => {
    expect(probeChat("costs $$5", 9)).toBeNull();
    expect(probeChat("$outfit.SHO", 11)).toBeNull();
    expect(probeChat("ab", 2)).toBeNull();
  });
});

describe("matching", () => {
  it("matches names and variables, best first", () => {
    expect(matchItems(ITEMS, "hair").map((i) => i.id)).toEqual(["aaaa0001", "aaaa0002"]);
    expect(matchItems(ITEMS, "hair_color").map((i) => i.id)).toEqual(["aaaa0002"]);
    expect(matchItems(ITEMS, "pack").map((i) => i.id)).toEqual(["bbbb0001"]);
    expect(matchItems(ITEMS, "").length).toBe(4);
  });
  it("matches variables by prefix before substring", () => {
    const vars = [{ name: "eye_color", kind: "wildcard" }, { name: "color", kind: "fixed_values" }];
    expect(matchVars(vars, "col").map((v) => v.name)).toEqual(["color", "eye_color"]);
  });
});

describe("applyRow", () => {
  it("inserts a mention in place of @query, with a space", () => {
    const text = "add more to @hai please";
    const p = probeChat(text, 15)!;
    const row: ChatRow = { source: "item", item: ITEMS[0] };
    const r = applyRow(text, 15, p, row);
    expect(r.text).toBe("add more to [[aaaa0001#Hairstyle]] please");
    expect(r.caret).toBe("add more to [[aaaa0001#Hairstyle]]".length);
  });
  it("drops brackets from a name so the mention cannot end early", () => {
    const p = probeChat("@out", 4)!;
    expect(applyRow("@out", 4, p, { source: "item", item: ITEMS[2] }).text).toBe("[[aaaa0003#Outfit winter]] ");
  });
  it("eats the rest of a word when picking mid-word", () => {
    const p = probeChat("$haxx", 3)!;
    expect(applyRow("$haxx", 3, p, { source: "var", v: { name: "hair", kind: "wildcard" } }).text).toBe("$hair ");
  });
  it("inserts only the path inside a typed lora reference", () => {
    const text = "<lora:sty";
    const p = probeChat(text, text.length)!;
    const r = applyRow(text, text.length, p, { source: "lora", model: { name: "style", path: "pack/style.safetensors", folder: "pack" } });
    expect(r.text).toBe("<lora:pack/style.safetensors");
  });
  it("writes the whole reference for a bare word, and the tag separator", () => {
    const p = probeChat("styl", 4)!;
    expect(applyRow("styl", 4, p, { source: "embedding", model: { name: "style", path: "style.pt", folder: "" } }).text)
      .toBe("embedding:style.pt ");
    const tag = { name: "blonde_hair", matched: "blonde_hair", count: 1, category: 0, category_name: null };
    const pt = probeChat("blon", 4)!;
    expect(applyRow("blon", 4, pt, { source: "tag", tag }, ", ").text).toBe("blonde_hair, ");
  });
});

describe("mentionRefs", () => {
  it("maps picked mentions to chips and skips unknown ids", () => {
    expect(mentionRefs("[[aaaa0001#Hairstyle]] and [[ffffffff#Gone]]", ITEMS)).toEqual({
      "aaaa0001#Hairstyle": { id: "aaaa0001", type: "wildcard", name: "Hairstyle" },
    });
  });
});

describe("mentionItems", () => {
  it("lists modules with their variable, then bundles", () => {
    expect(mentionItems(
      [{ id: "aaaa0001", name: "Hairstyle", type: "wildcard", payload: { var_binding: "$hair" } },
        { id: "aaaa0004", name: "Rule", type: "derivation", payload: {} }],
      [{ id: "bbbb0001", name: "Pack" }],
    )).toEqual([
      { id: "aaaa0001", name: "Hairstyle", kind: "wildcard", variable: "hair" },
      { id: "aaaa0004", name: "Rule", kind: "derivation" },
      { id: "bbbb0001", name: "Pack", kind: "bundle" },
    ]);
  });
});
