import { describe, expect, it } from "vitest";
import {
  docsTarget, iconMarkdown, insert, linkMarkdown, parseTarget, prefixLines, readLinkAttrs, splitIcons, targetUrl, wrap,
} from "./note-format";

describe("note links", () => {
  it("reads web and docs targets, and nothing else", () => {
    expect(parseTarget("https://duckduckgo.com")).toEqual({ kind: "web", href: "https://duckduckgo.com" });
    expect(parseTarget("docs:wp-context")).toEqual({ kind: "docs", page: "wp-context", section: "" });
    expect(parseTarget("docs:wp-context#s-inputs")).toEqual({ kind: "docs", page: "wp-context", section: "s-inputs" });
    expect(parseTarget("javascript:alert(1)")).toEqual({ kind: "none" });
    expect(parseTarget("file:///etc/passwd")).toEqual({ kind: "none" });
    expect(parseTarget("docs:../x")).toEqual({ kind: "none" });
  });

  it("opens docs on this ComfyUI", () => {
    expect(targetUrl(parseTarget("docs:wp-context#s-inputs"), "http://x:8188")).toBe("http://x:8188/wp/docs/wp-context#s-inputs");
    expect(targetUrl({ kind: "none" }, "http://x")).toBeNull();
  });

  it("reads a button block after a link", () => {
    expect(readLinkAttrs("{button} and more")).toEqual({ attrs: { button: true, icon: "", color: "" }, length: 8 });
    expect(readLinkAttrs("{button pi-book}")).toEqual({ attrs: { button: true, icon: "book", color: "" }, length: 16 });
    expect(readLinkAttrs("{button pi-book #E11D48}")).toEqual({ attrs: { button: true, icon: "book", color: "#e11d48" }, length: 24 });
    expect(readLinkAttrs("{button #0f0}")?.attrs).toEqual({ button: true, icon: "", color: "#0f0" });
    expect(readLinkAttrs("{#e11d48} rest")).toEqual({ attrs: { button: false, icon: "", color: "#e11d48" }, length: 9 });
    expect(readLinkAttrs("{pi-book}")).toBeNull();
    expect(readLinkAttrs("{pi-book #e11d48}")).toBeNull();
    expect(readLinkAttrs("{button pi-nope}")?.attrs.icon).toBe("");
    expect(readLinkAttrs(" {button}")).toBeNull();
    expect(readLinkAttrs("{other}")).toBeNull();
  });

  it("writes links the parser reads back", () => {
    expect(linkMarkdown("Quick start", docsTarget("quick-start"), { button: true, icon: "play" }))
      .toBe("[Quick start](docs:quick-start){button pi-play}");
    expect(linkMarkdown("a [b] c", "https://x.y")).toBe("[a (b) c](https://x.y)");
    expect(linkMarkdown("Go", "https://x.y", { button: true, icon: "play", color: "#E11D48" })).toBe("[Go](https://x.y){button pi-play #e11d48}");
    expect(linkMarkdown("Go", "https://x.y", { color: "#e11d48", icon: "play" })).toBe("[Go](https://x.y){#e11d48}");
    expect(linkMarkdown("Go", "https://x.y", { color: "none" })).toBe("[Go](https://x.y)");
    expect(linkMarkdown("", "https://x.y")).toBe("[https://x.y](https://x.y)");
  });
});

describe("note icons", () => {
  it("splits known icons out of text, with their colour", () => {
    expect(splitIcons("Go :pi-cog: now :pi-heart:{#E11D48}!")).toEqual([
      "Go ", { icon: "cog", color: "" }, " now ", { icon: "heart", color: "#e11d48" }, "!",
    ]);
    expect(splitIcons("unknown :pi-nope: stays")).toEqual(["unknown :pi-nope: stays"]);
    expect(splitIcons("bad colour :pi-cog:{#12}")).toEqual(["bad colour ", { icon: "cog", color: "" }, "{#12}"]);
  });

  it("writes an icon", () => {
    expect(iconMarkdown("cog")).toBe(":pi-cog:");
    expect(iconMarkdown("cog", "#ABCDEF")).toBe(":pi-cog:{#abcdef}");
    expect(iconMarkdown("cog", "red")).toBe(":pi-cog:");
  });
});

describe("toolbar edits", () => {
  it("wraps the selection, or a placeholder, and unwraps it again", () => {
    expect(wrap("say hi now", 4, 6, "**", "bold")).toEqual({ value: "say **hi** now", start: 6, end: 8 });
    expect(wrap("say **hi** now", 6, 8, "**", "bold")).toEqual({ value: "say hi now", start: 4, end: 6 });
    expect(wrap("ab", 1, 1, "*", "text")).toEqual({ value: "a*text*b", start: 2, end: 6 });
  });

  it("prefixes every selected line and numbers a list", () => {
    expect(prefixLines("one\ntwo\nthree", 0, 7, "1. ").value).toBe("1. one\n2. two\nthree");
    expect(prefixLines("- one\n- two", 0, 11, "- ").value).toBe("one\ntwo");
    expect(prefixLines("x\nquote me", 4, 4, "> ").value).toBe("x\n> quote me");
  });

  it("inserts in place of the selection, caret after it", () => {
    expect(insert("a b", 1, 2, ":pi-cog:")).toEqual({ value: "a:pi-cog:b", start: 9, end: 9 });
  });
});
