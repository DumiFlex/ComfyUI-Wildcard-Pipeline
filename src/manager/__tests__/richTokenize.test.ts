import { describe, expect, it } from "vitest";
import { tokenizeRich, mirrorHtmlWithIdx, inlineTokenHtml } from "../../widgets/richTokenize";

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

  // DELETED (task-19): "recognises @ref tokens (legacy @name short form)" — the @name
  // short form was removed from the grammar in the locked tokenizer (Tasks 3-7). The
  // test was already skipped with a TODO; deleting it here rather than leaving dead code.

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

  // DELETED (task-19): "recognises a quantifier prefix N#$var (legacy)" — the quantifier
  // N#$var syntax was removed in the locked grammar (Tasks 3-5). The kind "quantifier" no
  // longer exists in TokenKind. Deleting rather than keeping dead skipped test.

  // DELETED (task-19): "recognises # comment lines (legacy)" — the # comment line syntax
  // was removed in the locked grammar. The kind "comment" no longer exists in TokenKind.
  // Deleting rather than keeping dead skipped test.

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

describe("inlineTokenHtml", () => {
  it("returns empty string for empty input", () => {
    expect(inlineTokenHtml("")).toBe("");
  });

  it("emits raw text (no wrapper) for a single plain-text token", () => {
    // Keeps `.firstChild` a text node for caret-math callers that rely on
    // the legacy single-text-node shape.
    expect(inlineTokenHtml("hello world")).toBe("hello world");
  });

  it("wraps a brace block in a dp-brace sub-span with ZWSP edge pads", () => {
    const html = inlineTokenHtml("{a|b|c}");
    // ZWSPs flank the sub-span because nothing else in the atom provides
    // a caret landing position — clicking past the closing `}` otherwise
    // leaves the caret on the host span itself at element offset 1.
    expect(html).toBe('&#x200B;<span class="wp-rt-dp-brace">{a|b|c}</span>&#x200B;');
  });

  it("wraps a multi-pick block in a dp-multi sub-span with ZWSP edge pads", () => {
    const html = inlineTokenHtml("{2$$,$$a|b|c}");
    expect(html).toBe('&#x200B;<span class="wp-rt-dp-multi">{2$$,$$a|b|c}</span>&#x200B;');
  });

  it("wraps escapes ($$, @@) in escape sub-spans (no inner pads next to text)", () => {
    const html = inlineTokenHtml("$$ and @@");
    expect(html).toContain('<span class="wp-rt-escape">$$</span>');
    expect(html).toContain('<span class="wp-rt-escape">@@</span>');
    // Text segments stay un-wrapped so caret math walks single text nodes.
    expect(html).toContain(" and ");
    // The escape next to plain text " and " doesn't get an inner ZWSP —
    // adjacent text already provides the caret landing.
    expect(html).toBe('&#x200B;<span class="wp-rt-escape">$$</span> and <span class="wp-rt-escape">@@</span>&#x200B;');
  });

  it("escapes HTML special characters in raw text", () => {
    const html = inlineTokenHtml("<x>&\"'");
    expect(html).toContain("&lt;x&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).not.toContain("<x>");
  });

  it("renders collapsed kind as plain text (wildcard surface: vars literal)", () => {
    const html = inlineTokenHtml("hello $person", "var");
    // $person re-tokenises as a var token but should fall through to
    // literal text on the wildcard surface — chip-style coloring would
    // mislead users about whether $name expands.
    expect(html).toBe("hello $person");
    expect(html).not.toContain("wp-rt-var");
  });

  it("renders non-collapsed var as colored sub-span (combine surface)", () => {
    const html = inlineTokenHtml("hello $person", "ref");
    expect(html).toContain('<span class="wp-rt-var">$person</span>');
  });

  it("mixes plain text and brace blocks correctly (no inner ZWSP pads)", () => {
    const html = inlineTokenHtml("foo {a|b} bar");
    // Plain text on both sides of the brace block provides caret
    // landing on its own — no ZWSP pads needed.
    expect(html).toBe('foo <span class="wp-rt-dp-brace">{a|b}</span> bar');
  });

  it("preserves text content sum across all sub-spans (caret invariant)", () => {
    // Sum of textContent across wrapper + plain segments must equal the
    // input after ZWSP edge pads are stripped — `readHostAsText` removes
    // ZWSPs before they reach `modelValue` so the round-trip stays
    // lossless. Caret math walks text-node descendants of the host span;
    // any divergence here would mis-align selection-to-raw mapping.
    const inputs = [
      "{a|b|c}",
      "{2$$,$$a|b|c}",
      "$$ literal",
      "@@ at",
      "foo {x|y} bar",
      "hello",
      "",
    ];
    for (const text of inputs) {
      const html = inlineTokenHtml(text);
      // Naive textContent extraction — strip HTML tags, decode entities,
      // then drop ZWSPs (browser strips them via readHostAsText path).
      const stripped = html
        .replace(/<[^>]+>/g, "")
        .replace(/&#x200B;/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      expect(stripped).toBe(text);
    }
  });
});
