import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import Avatar from "./Avatar.vue";
import Combobox from "./Combobox.vue";
import DatePicker from "./DatePicker.vue";
import DiffView from "./DiffView.vue";
import ImageGrid from "./ImageGrid.vue";
import Lightbox from "./Lightbox.vue";
import RadioGroup from "./RadioGroup.vue";
import RangeSlider from "./RangeSlider.vue";
import Timeline from "./Timeline.vue";
import VirtualList from "./VirtualList.vue";
import VisuallyHidden from "./VisuallyHidden.vue";
import { addDays, addMonths, compareYmd, monthGrid, parseYmd, toYmd } from "./calendar";
import { diffText, diffTokens, tokenize } from "./diff";

const mounted: { unmount: () => void }[] = [];

afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  document.body.innerHTML = "";
});

/** Mount with v-model wired back, so the component sees its own updates. */
function bound<P extends Record<string, unknown>>(comp: unknown, props: P, model = "modelValue") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper over many components
  const w: any = mount(comp as never, {
    props: { ...props, [`onUpdate:${model}`]: (v: unknown) => w.setProps({ [model]: v }) } as never,
    attachTo: document.body,
  });
  mounted.push(w);
  return w;
}

const key = async (el: Element, k: string, init: KeyboardEventInit = {}): Promise<void> => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  await nextTick();
};

describe("calendar helpers", () => {
  it("parses only real days and prints them back", () => {
    expect(parseYmd("2026-02-29")).toBeNull();
    expect(parseYmd("2024-02-29")).toEqual({ y: 2024, m: 1, d: 29 });
    expect(parseYmd("26-1-1")).toBeNull();
    expect(parseYmd(null)).toBeNull();
    expect(toYmd({ y: 2026, m: 0, d: 5 })).toBe("2026-01-05");
  });

  it("moves by days and months, keeping inside the shorter month", () => {
    expect(toYmd(addDays({ y: 2026, m: 11, d: 31 }, 1))).toBe("2027-01-01");
    expect(toYmd(addMonths({ y: 2026, m: 0, d: 31 }, 1))).toBe("2026-02-28");
    expect(toYmd(addMonths({ y: 2026, m: 0, d: 15 }, -1))).toBe("2025-12-15");
    expect(compareYmd({ y: 2026, m: 1, d: 1 }, { y: 2026, m: 0, d: 31 })).toBeGreaterThan(0);
  });

  it("builds a 6×7 grid starting on the week start", () => {
    const g = monthGrid(2026, 9, 1); // October 2026 starts on a Thursday
    expect(g).toHaveLength(42);
    expect(toYmd(g[0])).toBe("2026-09-28");
    expect(new Date(g[0].y, g[0].m, g[0].d).getDay()).toBe(1);
    expect(toYmd(monthGrid(2026, 9, 0)[0])).toBe("2026-09-27");
  });
});

describe("diff helpers", () => {
  it("tokenizes words with their spaces and lines with their breaks", () => {
    expect(tokenize("a  b", "words")).toEqual(["a", "  ", "b"]);
    expect(tokenize("x\ny\n", "lines")).toEqual(["x\n", "y\n"]);
    expect(tokenize("", "words")).toEqual([]);
  });

  it("marks what was removed and added, and joins back to each side", () => {
    const parts = diffText("auburn hair, rim light", "silver hair, rim light");
    expect(parts[0]).toEqual({ kind: "del", text: "auburn" });
    expect(parts[1]).toEqual({ kind: "add", text: "silver" });
    const side = (k: "del" | "add") => parts.filter((p) => p.kind !== k).map((p) => p.text).join("");
    expect(side("add")).toBe("auburn hair, rim light");
    expect(side("del")).toBe("silver hair, rim light");
  });

  it("falls back to all removed, all added past the limit", () => {
    expect(diffTokens(["a", "b", "c"], ["a", "x"], 2)).toEqual([{ kind: "del", text: "abc" }, { kind: "add", text: "ax" }]);
  });
});

describe("Combobox", () => {
  const options = [
    { value: "sdxl", label: "SDXL base" },
    { value: "pony", label: "Pony" },
    { value: "flux", label: "Flux", disabled: true },
    { value: "illu", label: "Illustrious" },
  ];

  it("filters as you type and Enter takes the lit option", async () => {
    const w = bound(Combobox, { modelValue: null, options, ariaLabel: "Model" });
    const input = w.get("input");
    await input.trigger("focus");
    await input.setValue("il");
    const opts = document.querySelectorAll("[role=option]");
    expect([...opts].map((o) => o.textContent?.trim())).toEqual(["Illustrious"]);
    expect(input.attributes("aria-activedescendant")).toBe(opts[0].id);
    await key(input.element, "Enter");
    expect(w.props("modelValue")).toBe("illu");
    expect((input.element as HTMLInputElement).value).toBe("Illustrious");
    expect(input.attributes("aria-expanded")).toBe("false");
  });

  it("skips disabled options with the arrows", async () => {
    const w = bound(Combobox, { modelValue: "pony", options, ariaLabel: "Model" });
    const input = w.get("input");
    await input.trigger("focus");
    await key(input.element, "ArrowDown"); // sdxl
    await key(input.element, "ArrowDown"); // pony
    await key(input.element, "ArrowDown"); // flux is disabled → illu
    await key(input.element, "Enter");
    expect(w.props("modelValue")).toBe("illu");
  });

  it("with multiple, picks toggle and Backspace takes the last off", async () => {
    const w = bound(Combobox, { modelValue: ["sdxl"], options, multiple: true, ariaLabel: "Models" });
    const input = w.get("input");
    await input.trigger("focus");
    const pony = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((o) => o.textContent?.includes("Pony"));
    pony?.click();
    await nextTick();
    expect(w.props("modelValue")).toEqual(["sdxl", "pony"]);
    expect(document.querySelector("[role=listbox]")?.getAttribute("aria-multiselectable")).toBe("true");
    expect(w.findAll(".wp-combo__chip")).toHaveLength(2);
    await key(input.element, "Backspace");
    expect(w.props("modelValue")).toEqual(["sdxl"]);
  });

  it("clearable empties a single pick", async () => {
    const w = bound(Combobox, { modelValue: "pony", options, clearable: true, ariaLabel: "Model" });
    await w.get(".wp-combo__clear").trigger("click");
    expect(w.props("modelValue")).toBeNull();
  });
});

describe("DatePicker", () => {
  it("opens on the picked day; arrows and PageDown move, Enter picks", async () => {
    const w = bound(DatePicker, { modelValue: "2026-01-31", ariaLabel: "Since" });
    await w.get("button").trigger("click");
    await nextTick();
    const grid = document.querySelector<HTMLElement>("[role=grid]");
    expect(grid).not.toBeNull();
    const focused = () => grid?.querySelector('[tabindex="0"]')?.getAttribute("aria-label") ?? "";
    expect(document.activeElement?.getAttribute("tabindex")).toBe("0");
    await key(grid as HTMLElement, "PageDown"); // 31 Jan → 28 Feb
    expect(focused()).toContain("28");
    expect(focused()).toMatch(/February/);
    await key(grid as HTMLElement, "ArrowRight"); // 1 Mar
    await key(grid as HTMLElement, "Enter");
    expect(w.props("modelValue")).toBe("2026-03-01");
    expect(document.querySelector("[role=grid]")).toBeNull();
  });

  it("won't go past max or pick a day outside it", async () => {
    const w = bound(DatePicker, { modelValue: "2026-03-10", max: "2026-03-12", ariaLabel: "Day" });
    await w.get("button").trigger("click");
    await nextTick();
    const grid = document.querySelector<HTMLElement>("[role=grid]") as HTMLElement;
    await key(grid, "ArrowDown"); // +7 → clamped to the 12th
    await key(grid, "Enter");
    expect(w.props("modelValue")).toBe("2026-03-12");
    await w.get("button").trigger("click");
    await nextTick();
    const late = [...document.querySelectorAll<HTMLElement>("[role=grid] td")].find((td) => td.getAttribute("aria-disabled") === "true");
    late?.click();
    expect(w.props("modelValue")).toBe("2026-03-12");
  });
});

describe("RangeSlider", () => {
  it("keeps the ends apart by min-gap from the keys", async () => {
    const w = bound(RangeSlider, { modelValue: [20, 30], min: 0, max: 100, minGap: 5, ariaLabel: "Range" });
    const [lo, hi] = w.findAll("[role=slider]");
    expect(lo.attributes("aria-valuemax")).toBe("25");
    expect(hi.attributes("aria-valuemin")).toBe("25");
    await key(lo.element, "End");
    expect(w.props("modelValue")).toEqual([25, 30]);
    await key(lo.element, "ArrowRight");
    expect(w.props("modelValue")).toEqual([25, 30]);
    await key(hi.element, "Home");
    expect(w.props("modelValue")).toEqual([25, 30]);
    await key(hi.element, "ArrowRight");
    expect(w.props("modelValue")).toEqual([25, 31]);
  });

  it("with-input has a number box per end", () => {
    const w = bound(RangeSlider, { modelValue: [1, 2], min: 0, max: 5, withInput: true, ariaLabel: "Weight" });
    expect(w.findAll("input").map((i: { attributes: (n: string) => string }) => i.attributes("aria-label"))).toEqual(["Weight, low end", "Weight, high end"]);
  });
});

describe("RadioGroup", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B", disabled: true },
    { value: "c", label: "C", hint: "third" },
  ];

  it("is one Tab stop and the arrows choose, skipping disabled", async () => {
    const w = bound(RadioGroup, { modelValue: "a", options, ariaLabel: "Pick" });
    const radios = w.findAll("[role=radio]");
    expect(radios.map((r: { attributes: (n: string) => string }) => r.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
    await key(radios[0].element, "ArrowDown");
    expect(w.props("modelValue")).toBe("c");
    await key(w.findAll("[role=radio]")[2].element, "ArrowDown");
    expect(w.props("modelValue")).toBe("a");
  });
});

describe("display pieces", () => {
  it("Avatar shows initials on a stable colour, and falls back when the picture fails", async () => {
    const a = mount(Avatar, { props: { name: "Ada Lovelace" } });
    const b = mount(Avatar, { props: { name: "Ada Lovelace", src: "/x.png" } });
    mounted.push(a, b);
    expect(a.text()).toBe("AL");
    expect(a.attributes("role")).toBe("img");
    expect(a.attributes("aria-label")).toBe("Ada Lovelace");
    expect(a.attributes("style")).toContain("var(--wp-var-");
    await b.get("img").trigger("error");
    expect(b.text()).toBe("AL");
    const d = mount(Avatar, { props: { name: "Ada", decorative: true } });
    mounted.push(d);
    expect(d.attributes("aria-hidden")).toBe("true");
  });

  it("Timeline is an ordered list with tones and a pending item", () => {
    const w = mount(Timeline, {
      props: { items: [{ id: 1, title: "Saved", time: "now", tone: "success" }, { id: 2, title: "Building", pending: true }] },
    });
    mounted.push(w);
    expect(w.element.tagName).toBe("OL");
    expect(w.findAll("li")[0].attributes("data-tone")).toBe("success");
    expect(w.findAll("li")[1].attributes("data-pending")).toBe("true");
  });

  it("DiffView says removed / added and No changes", () => {
    const w = mount(DiffView, { props: { before: "red hair", after: "blue hair" } });
    const same = mount(DiffView, { props: { before: "x", after: "x" } });
    mounted.push(w, same);
    expect(w.get("del").text()).toBe("removed: red");
    expect(w.get("ins").text()).toBe("added: blue");
    expect(same.text()).toBe("No changes");
  });

  it("VisuallyHidden draws the element it is asked for", () => {
    const w = mount(VisuallyHidden, { props: { as: "div" }, slots: { default: "3 problems" } });
    mounted.push(w);
    expect(w.element.tagName).toBe("DIV");
    expect(w.classes()).toContain("wp-visually-hidden");
  });

  it("VirtualList builds only the rows in view, with their place in the list", () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const w = mount(VirtualList, {
      props: { items, itemHeight: 20, height: "200px", itemKey: (_: unknown, i: number) => i, overscan: 2 },
      slots: { item: "<template #item=\"{ item }\">row {{ item }}</template>" },
    });
    mounted.push(w);
    const rows = w.findAll("[role=listitem]");
    expect(rows.length).toBeLessThan(40);
    expect(rows[0].attributes("aria-setsize")).toBe("1000");
    expect(rows[0].attributes("aria-posinset")).toBe("1");
  });
});

describe("ImageGrid + Lightbox", () => {
  const images = [
    { id: "a", src: "a.png", alt: "First" },
    { id: "b", src: "b.png", alt: "Second" },
    { id: "c", src: "c.png", alt: "Third" },
  ];

  it("selectable tiles update the selected ids", async () => {
    const w = bound(ImageGrid, { images, selectable: true, selected: ["a"] }, "selected");
    const boxes = w.findAll('[aria-label^="Select"]');
    expect(boxes).toHaveLength(3);
    await boxes[1].trigger("click");
    expect(w.props("selected")).toEqual(["a", "b"]);
  });

  it("a tile opens the Lightbox, the arrows step and Escape closes it", async () => {
    const w = bound(ImageGrid, { images });
    const tile = w.findAll(".wp-image-grid__open")[1];
    (tile.element as HTMLElement).focus();
    await tile.trigger("click");
    await nextTick();
    await nextTick();
    const img = () => document.querySelector<HTMLImageElement>(".wp-lightbox__img");
    expect(img()?.alt).toBe("Second");
    const box = document.querySelector(".wp-lightbox") as HTMLElement;
    await key(box, "ArrowRight");
    expect(img()?.alt).toBe("Third");
    await key(box, "ArrowRight"); // no loop: stays on the last
    expect(img()?.alt).toBe("Third");
    await key(box, "Home");
    expect(img()?.alt).toBe("First");
    await key(box, "Escape");
    await nextTick();
    expect(document.querySelector(".wp-lightbox")).toBeNull();
    expect(document.activeElement).toBe(tile.element);
  });

  it("Lightbox with zoom shows the picture in WpImageZoom", async () => {
    bound(Lightbox, { open: true, images, zoom: true }, "index");
    await nextTick();
    expect(document.querySelector(".wp-lightbox .wp-imgzoom")).not.toBeNull();
    expect(document.querySelector(".wp-lightbox__img")).toBeNull();
  });

  it("Lightbox with loop goes round", async () => {
    const w = bound(Lightbox, { open: true, images, index: 2, loop: true }, "index");
    await nextTick();
    await key(document.querySelector(".wp-lightbox") as HTMLElement, "ArrowRight");
    expect(w.props("index")).toBe(0);
  });
});
