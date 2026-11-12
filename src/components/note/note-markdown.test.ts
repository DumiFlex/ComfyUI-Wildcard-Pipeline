import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NoteMarkdown from "./note-markdown";

const render = (text: string) => mount(NoteMarkdown, { props: { text } });

describe("note markdown", () => {
  it("draws a table with its column alignment", () => {
    const w = render("| Row | Runs |\n|:--|--:|\n| **a** | 1 |\n| b | 2 |");
    const cells = w.findAll("td");
    expect(w.find("th").text()).toBe("Row");
    expect(cells.map((c) => c.text())).toEqual(["a", "1", "b", "2"]);
    expect(cells[0]?.attributes("style")).toContain("text-align: left");
    expect(cells[1]?.attributes("style")).toContain("text-align: right");
    expect(w.find("td strong").exists()).toBe(true);
  });

  it("draws task boxes, with nested lists under them", () => {
    const w = render("- [x] done\n- [ ] todo\n  - inner");
    const items = w.findAll(".wp-note-md__task");
    expect(items).toHaveLength(2);
    expect(items[0]?.classes()).toContain("wp-note-md__task--done");
    expect(items[0]?.find(".pi-check-square").exists()).toBe(true);
    expect(items[1]?.find(".pi-stop").exists()).toBe(true);
    expect(items[1]?.find("ul li").text()).toBe("inner");
  });

  it("sizes headings by level and marks them as headings", () => {
    const w = render("# Big\n### Small");
    const [a, b] = w.findAll(".wp-note-md__h");
    expect(a?.classes()).toContain("wp-note-md__h--1");
    expect(a?.attributes("aria-level")).toBe("1");
    expect(b?.classes()).toContain("wp-note-md__h--3");
  });

  it("shows GitHub alerts as callouts and rules as lines", () => {
    const w = render("> [!WARNING]\n> Careful\n\n---\n\n> [!TIP]\n> Nice");
    const callouts = w.findAll(".wp-note-md__callout");
    expect(callouts.map((c) => c.classes().includes("wp-note-md__callout--warn"))).toEqual([true, false]);
    expect(callouts[0]?.text()).toBe("Careful");
    expect(w.find("hr.wp-note-md__hr").exists()).toBe(true);
  });
});

describe("note pictures", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const images = { "1a2b3c4d": { src: png, w: 640, h: 360 } };
  const draw = (text: string) => mount(NoteMarkdown, { props: { text, images } });

  it("draws a saved picture at a share of the note's width", () => {
    const w = draw("![The toolbar](wp:image/1a2b3c4d){width=60%} after");
    const img = w.get('[data-test="note-image"]');
    expect(img.attributes("src")).toBe(png);
    expect(img.attributes("alt")).toBe("The toolbar");
    expect(img.attributes("width")).toBe("640");
    expect(img.attributes("style")).toContain("width: 60%");
    expect(w.text()).toContain("after");
    expect(w.text()).not.toContain("width=");
  });

  it("draws a picture the extension ships from our own server", () => {
    const w = draw("![Help](wp:asset/toolbar-help)");
    expect(w.get('[data-test="note-image"]').attributes("src")).toMatch(/\/wp\/images\/note\/toolbar-help\.png$/);
  });

  it("draws a docs screenshot too, named by its file", () => {
    const w = draw("![Context](wp:asset/wp-context-loop-grid)");
    expect(w.get('[data-test="note-image"]').attributes("src")).toMatch(/\/wp\/images\/docs\/wp-context-loop-grid\.png$/);
  });

  it("never loads a web address, an unknown asset or a missing picture", () => {
    const w = draw("![a](https://example.com/x.png) ![b](wp:asset/nope) ![c](wp:image/00000000) ![d](data:image/png;base64,AAAA)");
    expect(w.find("img").exists()).toBe(false);
    expect(w.findAll('[data-test="note-image-missing"]').map((m) => m.text())).toEqual(["a", "b", "c", "d"]);
  });
});
