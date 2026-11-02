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
