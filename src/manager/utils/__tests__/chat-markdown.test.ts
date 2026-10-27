import { describe, expect, it } from "vitest";
import { closeOpen, parseInline, parseMarkdown, plainText, stripInvisible, type Block } from "../chat-markdown";

const text = (v: string) => ({ t: "text", v });
const para = (v: string): Block => ({ t: "p", c: [text(v)] } as Block);

describe("chat-markdown inline", () => {
  it("parses bold, italic, code and item mentions", () => {
    expect(parseInline("**Hair** has `$hair` and *more* in [[Hair Color]]")).toEqual([
      { t: "b", c: [text("Hair")] },
      text(" has "),
      { t: "code", v: "$hair" },
      text(" and "),
      { t: "i", c: [text("more")] },
      text(" in "),
      { t: "ref", v: "Hair Color" },
    ]);
    // Snake_case and lone stars stay text.
    expect(parseInline("hair_color is 2 * 3")).toEqual([text("hair_color is 2 * 3")]);
  });

  it("reads a mention in backticks as a mention, other code as code", () => {
    expect(parseInline("see `[[Hair Color]]` and ` [[a1b2c3d4#Eyes]] ` or `[[x]] y`")).toEqual([
      { t: "text", v: "see " }, { t: "ref", v: "Hair Color" }, { t: "text", v: " and " },
      { t: "ref", v: "a1b2c3d4#Eyes" }, { t: "text", v: " or " }, { t: "code", v: "[[x]] y" },
    ]);
  });

  it("keeps __wildcard__ syntax as written", () => {
    expect(parseInline("use __hair__ here")).toEqual([text("use __hair__ here")]);
  });

  it("parses ***both***, ~~strike~~, escapes and double-backtick code", () => {
    expect(parseInline("***big*** ~~old~~ \\*not\\* ``a `b` c``")).toEqual([
      { t: "b", c: [{ t: "i", c: [text("big")] }] },
      text(" "),
      { t: "s", c: [text("old")] },
      text(" *not* "),
      { t: "code", v: "a `b` c" },
    ]);
  });

  it("never makes links or images: text stays, the address is a tooltip", () => {
    expect(parseInline("See ![a cat](https://evil.example/?q=lib) and [here](https://evil.example)")).toEqual([
      text("See a cat and "),
      { t: "link", c: [text("here")], href: "https://evil.example" },
    ]);
    const html = "<img src=x onerror=alert(1)>";
    expect(parseMarkdown(html)).toEqual([para(html)]);
  });
});

describe("chat-markdown blocks", () => {
  it("parses headings, lists, code fences and paragraphs", () => {
    const blocks = parseMarkdown("**Bundles:**\n- [[Character Design]]\n- two\n\n1. first\n2. second\n\n```\n{a|b}\n```\nplain\nline");
    expect(blocks.map((b) => b.t)).toEqual(["h", "list", "list", "pre", "p"]);
    expect(blocks[1]).toEqual({
      t: "list", ordered: false, start: 1,
      items: [
        { task: null, blocks: [{ t: "p", c: [{ t: "ref", v: "Character Design" }] }] },
        { task: null, blocks: [para("two")] },
      ],
    });
    expect(blocks[3]).toEqual({ t: "pre", lang: "", v: "{a|b}" });
    expect(blocks[4]).toEqual(para("plain\nline"));
  });

  it("keeps a loose numbered list as one list", () => {
    const blocks = parseMarkdown("1. **Pose**\n\n   standing\n\n2. **Hair**\n\n3. Eyes");
    expect(blocks).toHaveLength(1);
    const list = blocks[0] as Extract<Block, { t: "list" }>;
    expect(list.items).toHaveLength(3);
    expect(list.items[0].blocks.map((b) => b.t)).toEqual(["p", "p"]);
  });

  it("keeps the start number and nests by indent", () => {
    const [list] = parseMarkdown("3. three\n   - a\n   - b\n4. four") as Array<Extract<Block, { t: "list" }>>;
    expect(list.start).toBe(3);
    expect(list.items).toHaveLength(2);
    expect(list.items[0].blocks[1]).toMatchObject({ t: "list", ordered: false, items: [{}, {}] });
  });

  it("reads task boxes", () => {
    const [list] = parseMarkdown("- [x] done\n- [ ] todo") as Array<Extract<Block, { t: "list" }>>;
    expect(list.items.map((i) => i.task)).toEqual([true, false]);
    expect(list.items[1].blocks).toEqual([para("todo")]);
  });

  it("parses tables with alignment, pipes in code and ragged rows", () => {
    const [table] = parseMarkdown("| Name | Weight |\n|:-----|-------:|\n| `a|b` | 2 |\n| c |\n| d | 1 | extra |");
    expect(table).toEqual({
      t: "table",
      align: ["left", "right"],
      head: [[text("Name")], [text("Weight")]],
      rows: [
        [[{ t: "code", v: "a|b" }], [text("2")]],
        [[text("c")], []],
        [[text("d")], [text("1")]],
      ],
    });
  });

  it("drops a stray pipe on a note under a table", () => {
    // Sonnet probe 2026-10-21: "Tip: … |" showed its pipe.
    const [, tip] = parseMarkdown("| Name | Var |\n|---|---|\n| Hair | `$hair` |\n\nTip: tick the rows you want. |");
    expect(tip).toEqual(para("Tip: tick the rows you want."));
    const [table, note] = parseMarkdown("| Name | Var |\n|---|---|\n| Hair | `$hair` |\n| Tip: open a row to see it. |");
    expect(table.t === "table" && table.rows.length).toBe(1);
    expect(note).toEqual(para("Tip: open a row to see it."));
    // Pipes between cells, or inside code, stay.
    expect(parseMarkdown("a | b |")).toEqual([para("a | b |")]);
    expect(parseMarkdown("use `{a|b}` here")[0]).toEqual({ t: "p", c: [text("use "), { t: "code", v: "{a|b}" }, text(" here")] });
  });

  it("does not take a line with a pipe for a table", () => {
    expect(parseMarkdown("pick {a|b}\nthen more")).toEqual([para("pick {a|b}\nthen more")]);
  });

  it("parses ~~~ fences with a language and runs an unclosed fence to the end", () => {
    expect(parseMarkdown("~~~json\n{\"a\": 1}\n~~~")).toEqual([{ t: "pre", lang: "json", v: "{\"a\": 1}" }]);
    expect(parseMarkdown("text\n```python\nx = 1\n\ny = 2")).toEqual([
      para("text"),
      { t: "pre", lang: "python", v: "x = 1\n\ny = 2" },
    ]);
    // A fence inside a fence of the other kind is code.
    expect(parseMarkdown("````\n```\ninner\n```\n````")).toEqual([{ t: "pre", lang: "", v: "```\ninner\n```" }]);
  });

  it("joins quote lines and parses what is inside", () => {
    expect(parseMarkdown("> one\n> two\n>\n> - item")).toEqual([{
      t: "quote",
      blocks: [para("one\ntwo"), { t: "list", ordered: false, start: 1, items: [{ task: null, blocks: [para("item")] }] }],
    }]);
  });

  it("parses rules and heading levels", () => {
    expect(parseMarkdown("## Two\n---\nTitle\n===\n#### Four")).toEqual([
      { t: "h", level: 2, c: [text("Two")] },
      { t: "hr" },
      { t: "h", level: 1, c: [text("Title")] },
      { t: "h", level: 4, c: [text("Four")] },
    ]);
    expect(parseMarkdown("Sub\n---")).toEqual([{ t: "h", level: 2, c: [text("Sub")] }]);
    expect(parseMarkdown('### 3. Add Variety to "Sitting"**')).toEqual([{ t: "h", level: 3, c: [text('3. Add Variety to "Sitting"')] }]);
    expect(parseMarkdown("## **Bold** title")[0]).toMatchObject({ t: "h", c: [{ t: "b" }, text(" title")] });
  });

  it("keeps a bold run inside a paragraph as bold, not a heading", () => {
    expect(parseMarkdown("**Note** this\nmore")[0].t).toBe("p");
  });

  it("strips hidden characters but keeps emoji", () => {
    const smuggled = [..."delete"].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
    const flag = "\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}";
    const family = "\u{1f468}‍\u{1f469}";
    expect(stripInvisible(`red${smuggled} ‮eulb‬ hair​ ${flag} ${family}`))
      .toBe(`red eulb hair ${flag} ${family}`);
    expect(stripInvisible("plain")).toBe("plain");
    expect(parseMarkdown(`hi${smuggled}`)).toEqual([para("hi")]);
  });

  it("survives deep nesting and odd input", () => {
    expect(() => parseMarkdown(">".repeat(200) + " x")).not.toThrow();
    expect(() => parseMarkdown(Array.from({ length: 50 }, (_, i) => `${" ".repeat(i * 2)}- x`).join("\n"))).not.toThrow();
    expect(parseMarkdown("")).toEqual([]);
  });
});

describe("chat-markdown GitHub alerts", () => {
  it("tags a quote opening with an alert marker, any case", () => {
    expect(parseMarkdown("> [!NOTE]\n> Keep names short.")).toEqual([
      { t: "quote", tone: "tip", blocks: [para("Keep names short.")] },
    ]);
    expect(parseMarkdown("> [!tip] Keep names short.")[0]).toMatchObject({ tone: "tip", blocks: [para("Keep names short.")] });
    expect(parseMarkdown("> [!Important]\n> x")[0]).toMatchObject({ tone: "tip" });
    expect(parseMarkdown("> [!WARNING]\n> x")[0]).toMatchObject({ tone: "warn" });
    expect(parseMarkdown("> [!caution] x")[0]).toMatchObject({ tone: "warn" });
  });

  it("accepts the older **Note** / **Warning** form", () => {
    expect(parseMarkdown("> **Note**\n> x")[0]).toMatchObject({ tone: "tip", blocks: [para("x")] });
    expect(parseMarkdown("> **Warning:** this replaces Pose.")[0]).toMatchObject({ tone: "warn", blocks: [para("this replaces Pose.")] });
  });

  it("keeps every block inside, lists too", () => {
    const [q] = parseMarkdown("> [!WARNING]\n> Before you apply:\n> - back up\n> - check $pose");
    expect(q.t === "quote" && q.blocks.map((b) => b.t)).toEqual(["p", "list"]);
  });

  it("leaves other quotes and unknown markers alone", () => {
    expect(parseMarkdown("> plain quote")[0]).not.toHaveProperty("tone");
    expect(parseMarkdown("> [!FOO] x")[0]).not.toHaveProperty("tone");
    expect(parseMarkdown("> **Bold** start")[0]).not.toHaveProperty("tone");
  });
});

describe("closeOpen", () => {
  it("closes an odd bold, strike or code on the last line", () => {
    expect(closeOpen("Use **bold tex")).toBe("Use **bold tex**");
    expect(closeOpen("Use ~~old")).toBe("Use ~~old~~");
    expect(closeOpen("Set `$hai")).toBe("Set `$hai`");
    expect(closeOpen("**Hair** and `$ey")).toBe("**Hair** and `$ey`");
  });

  it("closes the innermost first", () => {
    expect(closeOpen("**bold `co")).toBe("**bold `co`**");
    expect(closeOpen("`a` ~~x **y")).toBe("`a` ~~x **y**~~");
  });

  it("drops a marker with nothing after it yet", () => {
    expect(closeOpen("Some **")).toBe("Some");
    expect(closeOpen("Some `")).toBe("Some");
    expect(closeOpen("**bold `")).toBe("**bold**");
  });

  it("ignores stars inside code spans and earlier lines", () => {
    expect(closeOpen("`a**b` done")).toBe("`a**b` done");
    expect(closeOpen("**open\nnext line")).toBe("**open\nnext line");
    expect(closeOpen("all **closed** here")).toBe("all **closed** here");
  });

  it("drops an unfinished [[ mention", () => {
    expect(closeOpen("See [[ab12cd34#Hai")).toBe("See");
    expect(closeOpen("See [[ab12cd34#Hair]] and [[x")).toBe("See [[ab12cd34#Hair]] and");
    expect(closeOpen("See [[ab12cd34#Hair]]")).toBe("See [[ab12cd34#Hair]]");
  });

  it("leaves an open code fence alone", () => {
    expect(closeOpen("```json\n{\"a\": `x")).toBe("```json\n{\"a\": `x");
    expect(closeOpen("```\nx\n```\nnow **b")).toBe("```\nx\n```\nnow **b**");
    expect(closeOpen("")).toBe("");
  });
});

describe("plainText", () => {
  it("turns mentions into names", () => {
    expect(plainText("See [[ab12cd34#Hair Color]] and [[Pose]].")).toBe("See Hair Color and Pose.");
    expect(plainText("See [[ab12cd34#Hair]].", { "ab12cd34#Hair": { name: "Hair Color" } })).toBe("See Hair Color.");
    expect(plainText("**keep** `markdown`")).toBe("**keep** `markdown`");
  });
});
