import { describe, expect, it } from "vitest";
import {
  splitRefFilter,
  tokenizeRich,
  varBaseName,
} from "../rich-tokenize";

describe("tokenizeRich", () => {
  it("returns an empty array for empty input", () => {
    expect(tokenizeRich("")).toEqual([]);
  });

  it("emits a single text token for plain prose", () => {
    const tokens = tokenizeRich("hello world");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      kind: "text",
      raw: "hello world",
      start: 0,
      end: 11,
    });
  });

  it("recognises a $name var token", () => {
    const tokens = tokenizeRich("a $person b");
    const v = tokens.find((t) => t.kind === "var");
    expect(v).toBeDefined();
    expect(v?.raw).toBe("$person");
    expect(v?.meta?.name).toBe("person");
    expect(v?.meta?.index).toBeUndefined();
    expect(v?.start).toBe(2);
    expect(v?.end).toBe(9);
  });

  it("recognises a $name.K var token with a list index", () => {
    const tokens = tokenizeRich("$mood.2");
    expect(tokens).toHaveLength(1);
    const v = tokens[0];
    expect(v.kind).toBe("var");
    expect(v.raw).toBe("$mood.2");
    expect(v.meta?.name).toBe("mood");
    expect(v.meta?.index).toBe(2);
    expect(v.start).toBe(0);
    expect(v.end).toBe(7);
  });

  it("recognises an @{8hex} UUID ref token", () => {
    const tokens = tokenizeRich("see @{1a2b3c4d}");
    const r = tokens.find((t) => t.kind === "ref");
    expect(r).toBeDefined();
    expect(r?.raw).toBe("@{1a2b3c4d}");
    expect(r?.meta?.uuid).toBe("1a2b3c4d");
    expect(r?.meta?.name).toBeUndefined();
    expect(r?.meta?.sub_categories).toBeUndefined();
    expect(r?.start).toBe(4);
    expect(r?.end).toBe(15);
  });

  it("recognises an @{8hex#name:expr!null} ref with cached name + filter body", () => {
    const tokens = tokenizeRich("@{1a2b3c4d#colors:warm or soft!null}");
    expect(tokens).toHaveLength(1);
    const r = tokens[0];
    expect(r.kind).toBe("ref");
    expect(r.meta?.uuid).toBe("1a2b3c4d");
    // `#name` cache survives into meta.name.
    expect(r.meta?.name).toBe("colors");
    // The `:`-body is captured raw, comma-split into sub_categories. A single
    // comma-free body lands as one entry (the whole `expr!null` string); the
    // downstream filter parser peels `!null` later.
    expect(r.meta?.sub_categories).toEqual(["warm or soft!null"]);
  });

  it("comma-splits a multi-term ref filter body into sub_categories", () => {
    const tokens = tokenizeRich("@{1a2b3c4d:warm, soft}");
    const r = tokens[0];
    expect(r.kind).toBe("ref");
    expect(r.meta?.sub_categories).toEqual(["warm", "soft"]);
  });

  it("tokenises {a|b|c} as a single dp-brace token with branches", () => {
    const tokens = tokenizeRich("{a|b|c}");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe("dp-brace");
    expect(tokens[0].raw).toBe("{a|b|c}");
    expect(tokens[0].start).toBe(0);
    expect(tokens[0].end).toBe(7);
    expect(tokens[0].meta?.branches).toEqual(["a", "b", "c"]);
  });

  it("falls through to text for a single-branch {no_pipe} block", () => {
    const tokens = tokenizeRich("{no_pipe}");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe("text");
    expect(tokens[0].raw).toBe("{no_pipe}");
  });

  it("recognises a {N$$sep$$...} multi-select as a single dp-multi token", () => {
    const tokens = tokenizeRich("{2$$, $$a|b|c}");
    expect(tokens).toHaveLength(1);
    const m = tokens[0];
    expect(m.kind).toBe("dp-multi");
    expect(m.raw).toBe("{2$$, $$a|b|c}");
    expect(m.meta?.min).toBe(2);
    expect(m.meta?.max).toBe(2);
    expect(m.meta?.count).toBe(2);
    expect(m.meta?.sep).toBe(", ");
    expect(m.meta?.independent).toBe(false);
    expect(m.meta?.branches).toEqual(["a", "b", "c"]);
  });

  it("recognises a {N-M~$$sep$$...} range + independent multi-select", () => {
    // Canonical corpus form: range `2-4`, `~` independent, separator `, `.
    const tokens = tokenizeRich("{2-4~$$, $$a|b|c}");
    expect(tokens).toHaveLength(1);
    const m = tokens[0];
    expect(m.kind).toBe("dp-multi");
    expect(m.raw).toBe("{2-4~$$, $$a|b|c}");
    expect(m.meta?.min).toBe(2);
    expect(m.meta?.max).toBe(4);
    // count tracks max for back-compat.
    expect(m.meta?.count).toBe(4);
    // `~` marks repeats allowed (independent draws).
    expect(m.meta?.independent).toBe(true);
    expect(m.meta?.sep).toBe(", ");
    expect(m.meta?.branches).toEqual(["a", "b", "c"]);
  });

  it("parses an empty separator ($$$$) as sep:''", () => {
    // Empty separator is the doubled `$$$$` delimiter (open + close, nothing
    // between). A single `$$` is NOT a multi-pick prefix.
    const tokens = tokenizeRich("{3$$$$a|b|c}");
    expect(tokens).toHaveLength(1);
    const m = tokens[0];
    expect(m.kind).toBe("dp-multi");
    expect(m.meta?.min).toBe(3);
    expect(m.meta?.max).toBe(3);
    expect(m.meta?.independent).toBe(false);
    expect(m.meta?.sep).toBe("");
    expect(m.meta?.branches).toEqual(["a", "b", "c"]);
  });

  it("treats $$ as an escape, not a var", () => {
    const tokens = tokenizeRich("price $$5");
    const escapes = tokens.filter((t) => t.kind === "escape");
    const vars = tokens.filter((t) => t.kind === "var");
    expect(escapes).toHaveLength(1);
    expect(escapes[0].raw).toBe("$$");
    expect(escapes[0].meta?.literal).toBe("$");
    expect(vars).toHaveLength(0);
  });

  it("treats @@ as an escape, not a ref", () => {
    const tokens = tokenizeRich("hi @@user");
    const escapes = tokens.filter((t) => t.kind === "escape");
    expect(escapes).toHaveLength(1);
    expect(escapes[0].raw).toBe("@@");
    expect(escapes[0].meta?.literal).toBe("@");
    expect(tokens.some((t) => t.kind === "ref")).toBe(false);
  });

  it("does not recognise @name short form as a ref (falls through to text)", () => {
    const tokens = tokenizeRich("@colors");
    expect(tokens.some((t) => t.kind === "ref")).toBe(false);
    expect(tokens.some((t) => t.kind === "text")).toBe(true);
  });

  it("keeps the lossless invariant — joining .raw reproduces a mixed input", () => {
    const text = "$person says @{1a2b3c4d} at $$5: {a|b} and {2$$, $$x|y} @@end";
    const tokens = tokenizeRich(text);
    expect(tokens.map((t) => t.raw).join("")).toBe(text);
    // Contiguity: every token abuts the previous one with no gaps.
    expect(tokens[0].start).toBe(0);
    expect(tokens[tokens.length - 1].end).toBe(text.length);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].start).toBe(tokens[i - 1].end);
    }
  });
});

describe("splitRefFilter", () => {
  it("peels a trailing !null exclude marker off the body", () => {
    expect(splitRefFilter("warm or soft!null")).toEqual({
      expr: "warm or soft",
      excludeNull: true,
    });
  });

  it("returns excludeNull:false when there is no !null marker", () => {
    expect(splitRefFilter("warm or cool")).toEqual({
      expr: "warm or cool",
      excludeNull: false,
    });
  });
});

describe("varBaseName", () => {
  it("drops a leading $ and a trailing .K accessor", () => {
    expect(varBaseName("$mood.0")).toBe("mood");
  });
});

describe("tokenizeRich — $var.neg (schema v8)", () => {
  it("reads .neg as part of the var, with or without a .K accessor", () => {
    const [a] = tokenizeRich("$mood.neg");
    expect(a).toMatchObject({ kind: "var", raw: "$mood.neg", meta: { name: "mood", neg: true } });
    const [b] = tokenizeRich("$pal.1.neg,");
    expect(b).toMatchObject({ raw: "$pal.1.neg", meta: { name: "pal", index: 1, neg: true } });
  });

  it("leaves .negative and similar words alone", () => {
    const [a] = tokenizeRich("$mood.negative");
    expect(a).toMatchObject({ raw: "$mood" });
    expect(a?.meta?.neg).toBeUndefined();
  });

  it("strips .neg in varBaseName", () => {
    expect(varBaseName("$mood.neg")).toBe("mood");
    expect(varBaseName("$pal.1.neg")).toBe("pal");
  });
});
