import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import ListRow from "../ListRow.vue";

/** The element, or a failed test that names what was missing. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

describe("ListRow", () => {
  it("is a button that marks the shown row as current", () => {
    const w = mount(ListRow, { props: { selected: true, icon: "folder", count: 3 }, slots: { default: "People" } });
    expect(w.element.tagName).toBe("BUTTON");
    expect(w.attributes("type")).toBe("button");
    expect(w.attributes("aria-current")).toBe("true");
    expect(w.attributes("aria-pressed")).toBeUndefined();
    expect(w.attributes("data-selected")).toBeDefined();
    expect(w.find(".wp-list-row__count").text()).toBe("3");
    expect(w.find(".pi-folder").exists()).toBe(true);
  });

  it("says pressed for a filter row, on and off", () => {
    const on = mount(ListRow, { props: { toggle: true, selected: true }, slots: { default: "noir" } });
    const off = mount(ListRow, { props: { toggle: true }, slots: { default: "noir" } });
    expect(on.attributes("aria-pressed")).toBe("true");
    expect(off.attributes("aria-pressed")).toBe("false");
    expect(off.attributes("aria-current")).toBeUndefined();
  });

  it("shows a description, a start slot and an arrow, and indents by depth", () => {
    const w = mount(ListRow, {
      props: { description: "wildcard · 8", arrow: true, depth: 2, muted: true },
      slots: { default: "Mood", start: "<b class='kind'>W</b>" },
    });
    expect(w.find(".wp-list-row__desc").text()).toBe("wildcard · 8");
    expect(w.find(".kind").exists()).toBe(true);
    expect(w.find(".pi-arrow-right").exists()).toBe(true);
    expect(w.attributes("style")).toContain("--wp-list-row-depth: 2");
    expect(w.classes()).toContain("wp-list-row--muted");
  });

  it("renders as a link and stops a disabled one", async () => {
    const w = mount(ListRow, { props: { as: "a", disabled: true }, attrs: { href: "#x" }, slots: { default: "x" } });
    expect(w.element.tagName).toBe("A");
    expect(w.attributes("type")).toBeUndefined();
    expect(w.attributes("aria-disabled")).toBe("true");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    w.element.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("moves focus between the rows of its list with the arrow keys", async () => {
    const Host = defineComponent({
      render: () => h("div", { "data-wp-rows": "" }, [
        h(ListRow, null, () => "a"),
        h("ul", [h("li", [h(ListRow, null, () => "b")]), h("li", [h(ListRow, { disabled: true }, () => "c")])]),
        h(ListRow, null, () => "d"),
      ]),
    });
    const w = mount(Host, { attachTo: document.body });
    const rows = w.findAll(".wp-list-row");
    (must(rows[0], "row 0").element as HTMLElement).focus();
    await must(rows[0], "row 0").trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("b");
    await must(rows[1], "row 1").trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("d");
    await must(rows[3], "row 3").trigger("keydown", { key: "Home" });
    expect(document.activeElement?.textContent).toBe("a");
    await must(rows[0], "row 0").trigger("keydown", { key: "End" });
    expect(document.activeElement?.textContent).toBe("d");
    w.unmount();
  });
});
