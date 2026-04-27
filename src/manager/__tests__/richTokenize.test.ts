import { describe, expect, it } from "vitest";
import { tokenizeRich, mirrorHtmlWithIdx } from "../utils/richTokenize";

describe("tokenizeRich", () => {
  it("returns empty array for empty input", () => {
    expect(tokenizeRich("")).toEqual([]);
  });

  it("emits a single text token for plain prose", () => {
    const tokens = tokenizeRich("hello world");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: "text", raw: "hello world", start: 0, end: 11 });
  });

  it("recognises $varname tokens", () => {
    const tokens = tokenizeRich("a $person b");
    const v = tokens.find((t) => t.kind === "var");
    expect(v).toBeDefined();
    expect(v?.raw).toBe("$person");
    expect(v?.meta?.name).toBe("person");
    expect(v?.start).toBe(2);
    expect(v?.end).toBe(9);
  });

  it("recognises @ref tokens", () => {
    const tokens = tokenizeRich("see @colors");
    const r = tokens.find((t) => t.kind === "ref");
    expect(r).toBeDefined();
    expect(r?.raw).toBe("@colors");
    expect(r?.meta?.name).toBe("colors");
  });

  it("treats $$ as an escape, not a var", () => {
    const tokens = tokenizeRich("price $$5");
    const escapes = tokens.filter((t) => t.kind === "escape");
    const vars = tokens.filter((t) => t.kind === "var");
    expect(escapes).toHaveLength(1);
    expect(escapes[0].raw).toBe("$$");
    expect(vars).toHaveLength(0);
  });

  it("treats @@ as an escape", () => {
    const tokens = tokenizeRich("hi @@user");
    const escapes = tokens.filter((t) => t.kind === "escape");
    expect(escapes).toHaveLength(1);
    expect(escapes[0].raw).toBe("@@");
  });

  it("tokenises {a|b|c} inline-choice with brace + pipe markers", () => {
    const tokens = tokenizeRich("{a|b|c}");
    const kinds = tokens.map((t) => t.kind);
    expect(kinds[0]).toBe("dp-brace");
    expect(kinds[kinds.length - 1]).toBe("dp-brace");
    expect(kinds.filter((k) => k === "dp-pipe")).toHaveLength(2);
    // Open brace at 0, close brace at end-1.
    expect(tokens[0].start).toBe(0);
    expect(tokens[tokens.length - 1].end).toBe(7);
  });

  it("recognises a {N::weighted} option marker", () => {
    const tokens = tokenizeRich("{2::red|blue}");
    const w = tokens.find((t) => t.kind === "dp-weight");
    expect(w).toBeDefined();
    expect(w?.raw).toBe("2::");
    expect(w?.meta?.weight).toBe(2);
  });

  it("recognises a {N$$sep$$...} multi-select header", () => {
    const tokens = tokenizeRich("{2$$, $$a|b}");
    const m = tokens.find((t) => t.kind === "dp-multi");
    expect(m).toBeDefined();
    expect(m?.raw.startsWith("2$$")).toBe(true);
    expect(m?.meta?.range).toBe("2");
    expect(m?.meta?.sep).toBe(", ");
  });

  it("recognises a quantifier prefix N#$var", () => {
    const tokens = tokenizeRich("5#$person");
    const q = tokens.find((t) => t.kind === "quantifier");
    const v = tokens.find((t) => t.kind === "var");
    expect(q).toBeDefined();
    expect(q?.raw).toBe("5#");
    expect(q?.meta?.count).toBe(5);
    expect(v?.raw).toBe("$person");
  });

  it("recognises # comment lines", () => {
    const tokens = tokenizeRich("# this is a comment\nrest");
    expect(tokens[0].kind).toBe("comment");
    expect(tokens[0].raw).toBe("# this is a comment");
  });

  it("does not flag mid-token # as a comment", () => {
    const tokens = tokenizeRich("foo#bar");
    expect(tokens.some((t) => t.kind === "comment")).toBe(false);
  });

  it("emits contiguous tokens covering the full input", () => {
    const text = "5#$person says @greet at $$5: {a|b}";
    const tokens = tokenizeRich(text);
    expect(tokens[0].start).toBe(0);
    expect(tokens[tokens.length - 1].end).toBe(text.length);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].start).toBe(tokens[i - 1].end);
    }
  });
});

describe("mirrorHtmlWithIdx", () => {
  it("emits a span per token with class wp-rt-{kind} and data-idx", () => {
    const html = mirrorHtmlWithIdx(tokenizeRich("$x"));
    expect(html).toContain('class="wp-rt-var"');
    expect(html).toContain('data-idx="0"');
    expect(html).toContain("$x");
  });

  it("escapes HTML special characters in raw text", () => {
    const html = mirrorHtmlWithIdx(tokenizeRich("<script>&\"'"));
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).not.toContain("<script>");
  });

  it("appends a trailing wp-rt-tail span", () => {
    const html = mirrorHtmlWithIdx(tokenizeRich("hello"));
    expect(html).toContain('class="wp-rt-tail"');
  });
});
