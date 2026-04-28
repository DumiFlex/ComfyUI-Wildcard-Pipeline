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

  // TODO(syntax-task-19): re-enable after wildcardSyntax.ts UUID-graph rewrite
  // The old @name short form is no longer recognised as ref; it falls through to text.
  it.skip("recognises @ref tokens (legacy @name short form)", () => {
    const tokens = tokenizeRich("see @colors");
    const r = tokens.find((t) => t.kind === "ref");
    expect(r).toBeDefined();
    expect(r?.raw).toBe("@colors");
    expect(r?.meta?.name).toBe("colors");
  });

  it("recognises @{8hex} UUID ref tokens", () => {
    const tokens = tokenizeRich("see @{1a2b3c4d}");
    const r = tokens.find((t) => t.kind === "ref");
    expect(r).toBeDefined();
    expect(r?.raw).toBe("@{1a2b3c4d}");
    expect(r?.meta?.uuid).toBe("1a2b3c4d");
    expect(r?.start).toBe(4);
    expect(r?.end).toBe(15);
  });

  it("does not recognise @name short form as ref (falls through to text)", () => {
    const tokens = tokenizeRich("@colors");
    // No ref token — the whole thing should be text (@ is not followed by {8hex})
    expect(tokens.some((t) => t.kind === "ref")).toBe(false);
    expect(tokens.some((t) => t.kind === "text")).toBe(true);
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

  it("tokenises {a|b|c} inline-choice as a single dp-brace token with branches", () => {
    const tokens = tokenizeRich("{a|b|c}");
    // Single token for the entire block (Task 7 corpus contract)
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
    const tokens = tokenizeRich("{2$$, $$a|b}");
    expect(tokens).toHaveLength(1);
    const m = tokens[0];
    expect(m.kind).toBe("dp-multi");
    expect(m.raw).toBe("{2$$, $$a|b}");
    expect(m.meta?.count).toBe(2);
    expect(m.meta?.sep).toBe(", ");
    expect(m.meta?.branches).toEqual(["a", "b"]);
  });

  // TODO(syntax-task-19): re-enable after quantifier is re-evaluated for the new grammar
  // The quantifier prefix N#$var is no longer recognised; it becomes plain text.
  it.skip("recognises a quantifier prefix N#$var (legacy)", () => {
    const tokens = tokenizeRich("5#$person");
    // Cast to string so TypeScript does not reject the removed kind literal.
    const q = tokens.find((t) => (t.kind as string) === "quantifier");
    const v = tokens.find((t) => t.kind === "var");
    expect(q).toBeDefined();
    expect(q?.raw).toBe("5#");
    expect((q?.meta as Record<string, unknown>)?.count).toBe(5);
    expect(v?.raw).toBe("$person");
  });

  // TODO(syntax-task-19): re-enable after comment syntax is re-evaluated for the new grammar
  // The # comment line syntax is no longer recognised.
  it.skip("recognises # comment lines (legacy)", () => {
    const tokens = tokenizeRich("# this is a comment\nrest");
    // Cast to string so TypeScript does not reject the removed kind literal.
    expect(tokens[0].kind as string).toBe("comment");
    expect(tokens[0].raw).toBe("# this is a comment");
  });

  it("treats # at line start as plain text (no comment syntax)", () => {
    const tokens = tokenizeRich("# noted");
    // With comment syntax removed, the whole string is plain text.
    expect(tokens.every((t) => t.kind === "text")).toBe(true);
  });

  it("emits contiguous tokens covering the full input", () => {
    // Use @{uuid} form and no quantifier — tests the locked grammar.
    const text = "$person says @{1a2b3c4d} at $$5: {a|b}";
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
