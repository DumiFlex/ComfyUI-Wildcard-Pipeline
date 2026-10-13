import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../chat-markdown";

describe("chat-markdown", () => {
  it("parses inline bold, italic, code and item mentions", () => {
    expect(parseInline("**Hair** has `$hair` and *more* in [[Hair Color]]")).toEqual([
      { t: "b", c: [{ t: "text", v: "Hair" }] },
      { t: "text", v: " has " },
      { t: "code", v: "$hair" },
      { t: "text", v: " and " },
      { t: "i", c: [{ t: "text", v: "more" }] },
      { t: "text", v: " in " },
      { t: "ref", v: "Hair Color" },
    ]);
    // Snake_case and lone stars stay text.
    expect(parseInline("hair_color is 2 * 3")).toEqual([{ t: "text", v: "hair_color is 2 * 3" }]);
  });

  it("parses headings, lists, code fences and paragraphs", () => {
    const blocks = parseMarkdown("**Bundles:**\n- [[Character Design]]\n- two\n\n1. first\n2. second\n\n```\n{a|b}\n```\nplain\nline");
    expect(blocks.map((b) => b.t)).toEqual(["h", "ul", "ol", "pre", "p"]);
    expect(blocks[1]).toEqual({ t: "ul", items: [[{ t: "ref", v: "Character Design" }], [{ t: "text", v: "two" }]] });
    expect(blocks[3]).toEqual({ t: "pre", v: "{a|b}" });
    expect(blocks[4]).toEqual({ t: "p", c: [{ t: "text", v: "plain\nline" }] });
  });
});
