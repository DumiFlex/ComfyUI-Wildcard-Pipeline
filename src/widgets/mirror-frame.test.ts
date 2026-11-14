import { describe, expect, it, vi } from "vitest";

import { hideRule, moveEntries, partEntries, readParts } from "./mirror-frame";

function dom(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("subgraph copy parts", () => {
  it("lists the marked parts in drawing order, each once", () => {
    const root = dom(`
      <section data-wp-part="label" data-wp-part-label="Whole label section" data-wp-part-section="Label">
        <div data-wp-part="font" data-wp-part-label="Font" data-wp-part-section="Label"></div>
      </section>
      <span data-wp-part="rows" data-wp-part-label="Rows"></span>
      <textarea data-wp-part="rows" data-wp-part-label="Rows"></textarea>
      <div data-wp-part="bare"></div>`);
    expect(readParts(root)).toEqual([
      { id: "label", label: "Whole label section", section: "Label" },
      { id: "font", label: "Font", section: "Label" },
      { id: "rows", label: "Rows", section: "" },
      { id: "bare", label: "bare", section: "" },
    ]);
    expect(readParts(null)).toEqual([]);
  });

  it("hides only the copy it belongs to", () => {
    expect(hideRule("wp_show:1:w", [])).toBe("");
    const rule = hideRule("wp_show:1:w", ["font", "toggle:a\"b"]);
    expect(rule).toContain('.wp-mirror[data-wp-mirror="wp_show\\:1\\:w"] [data-wp-part="font"]');
    expect(rule).toContain("display: none !important");
    expect(rule).not.toContain('a"b"]');
  });

  it("ticks what shows, groups by section, and Show all clears", () => {
    const set = vi.fn();
    const parts = [
      { id: "a", label: "A", section: "One" },
      { id: "b", label: "B", section: "One" },
      { id: "c", label: "C", section: "" },
    ];
    const entries = partEntries(parts, ["b"], set);
    expect(entries.map((e) => ("section" in e ? `#${e.section}` : `${e.label}:${String(e.checked)}`))).toEqual([
      "Show all:undefined",
      "#One",
      "A:true",
      "B:false",
      "C:true",
    ]);
    const pick = (label: string) => entries.find((e) => "label" in e && e.label === label);
    const a = pick("A");
    const b = pick("B");
    const all = pick("Show all");
    if (!a || !b || !all || "section" in a || "section" in b || "section" in all) throw new Error("missing entry");
    a.onSelect();
    expect(set).toHaveBeenLastCalledWith(["b", "a"]);
    b.onSelect();
    expect(set).toHaveBeenLastCalledWith([]);
    expect(all.disabled).toBe(false);
    all.onSelect();
    expect(set).toHaveBeenLastCalledWith([]);
  });

  it("says when a panel has no parts", () => {
    const entries = partEntries([], [], () => undefined);
    expect(entries).toHaveLength(1);
    expect("label" in entries[0] && entries[0].disabled).toBe(true);
  });
});

describe("moveEntries", () => {
  it("offers Move up / Move down only when the copy can move", () => {
    const move = vi.fn();
    expect(moveEntries(() => false, move)).toEqual([]);
    const items = moveEntries((d) => d === 1, move);
    const labels = items.map((e) => ("label" in e ? `${e.label}${e.disabled ? " (off)" : ""}` : `[${e.section}]`));
    expect(labels).toEqual(["[Position]", "Move up (off)", "Move down"]);
    const down = items[2];
    if (down && "onSelect" in down) down.onSelect();
    expect(move).toHaveBeenCalledWith(1);
  });
});
