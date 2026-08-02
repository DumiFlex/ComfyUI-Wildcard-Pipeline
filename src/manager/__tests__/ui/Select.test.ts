import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import Select from "../../components/ui/Select.vue";

const opts = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

// The menu is teleported to <body>, so queries must use `document` rather than
// the test-utils wrapper. `attachTo: document.body` plus `wrap.unmount()` keeps
// teleported nodes from leaking between tests.

describe("Select.vue", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens menu on click and renders options", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    expect(document.querySelector(".wp-select__menu")).toBeNull();
    await wrap.get("[data-test='select-trigger']").trigger("click");
    expect(document.querySelector(".wp-select__menu")).not.toBeNull();
    expect(document.querySelectorAll(".wp-select__option").length).toBe(3);
    wrap.unmount();
  });

  it("Enter on highlighted option emits update:modelValue", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    // First option (index 0) is active by default; ArrowDown moves to index 1 ("b").
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await trigger.trigger("keydown", { key: "Enter" });
    const events = wrap.emitted("update:modelValue");
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(["b"]);
    wrap.unmount();
  });

  it("Esc closes the menu", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    expect(document.querySelector(".wp-select__menu")).not.toBeNull();
    await trigger.trigger("keydown", { key: "Escape" });
    expect(document.querySelector(".wp-select__menu")).toBeNull();
    wrap.unmount();
  });

  it("reflects error state via aria-invalid on trigger", () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts, error: true },
      attachTo: document.body,
    });
    expect(wrap.get("[data-test='select-trigger']").attributes("aria-invalid")).toBe("true");
    wrap.unmount();
  });

  it("type-to-filter narrows the options", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    expect(document.querySelectorAll(".wp-select__option").length).toBe(3);
    await trigger.trigger("keydown", { key: "a" });
    await trigger.trigger("keydown", { key: "l" }); // "al" → only "Alpha"
    expect(document.querySelectorAll(".wp-select__option").length).toBe(1);
    expect(document.querySelector(".wp-select__option")?.textContent).toContain("Alpha");
    expect(document.querySelector("[data-test='select-filter']")?.textContent).toContain("al");
    wrap.unmount();
  });

  it("Enter selects the single filtered match", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    await trigger.trigger("keydown", { key: "g" }); // → only "Gamma"
    await trigger.trigger("keydown", { key: "Enter" });
    expect(wrap.emitted("update:modelValue")![0]).toEqual(["c"]);
    wrap.unmount();
  });

  it("renders option meta so same-labelled rows are tellable apart", async () => {
    // A library routinely holds five wildcards all named "Outfit"; without a
    // meta column the dropdown offered five identical rows.
    const dupes = [
      { value: "b855d115", label: "Outfit", meta: "31 opts · b855d115" },
      { value: "88d84413", label: "Outfit", meta: "12 opts · 88d84413" },
    ];
    const wrap = mount(Select, {
      props: { modelValue: null, options: dupes },
      attachTo: document.body,
    });
    await wrap.get("[data-test='select-trigger']").trigger("click");
    const metas = [...document.querySelectorAll(".wp-select__option-meta")]
      .map((n) => n.textContent);
    expect(metas).toEqual(["31 opts · b855d115", "12 opts · 88d84413"]);
    wrap.unmount();
  });

  it("type-to-filter matches meta, so a uuid finds its row", async () => {
    const dupes = [
      { value: "b855d115", label: "Outfit", meta: "31 opts · b855d115" },
      { value: "88d84413", label: "Outfit", meta: "12 opts · 88d84413" },
    ];
    const wrap = mount(Select, {
      props: { modelValue: null, options: dupes },
      attachTo: document.body,
    });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    for (const key of "88d8") await trigger.trigger("keydown", { key });
    expect(document.querySelectorAll(".wp-select__option").length).toBe(1);
    expect(document.querySelector(".wp-select__option-meta")?.textContent)
      .toContain("88d84413");
    wrap.unmount();
  });

  it("shows No matches when the query matches nothing", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    const trigger = wrap.get("[data-test='select-trigger']");
    await trigger.trigger("click");
    await trigger.trigger("keydown", { key: "z" });
    expect(document.querySelectorAll(".wp-select__option").length).toBe(0);
    expect(document.querySelector("[data-test='select-empty']")).not.toBeNull();
    wrap.unmount();
  });
  it("repeats the selected option's meta in the CLOSED trigger", async () => {
    // Disambiguating rows only inside the open menu solves half the problem:
    // picking one of several same-named rows and then seeing the trigger
    // collapse to the bare name makes the choice unverifiable again.
    const dupes = [
      { value: "a", label: "Outfit", meta: "12 options · #aaaaaaaa" },
      { value: "b", label: "Outfit", meta: "3 options · #bbbbbbbb" },
    ];
    const wrap = mount(Select, {
      props: { modelValue: "b", options: dupes },
      attachTo: document.body,
    });
    expect(wrap.get(".wp-select__label-meta").text()).toContain("#bbbbbbbb");
    // And the hover title carries both halves, since either can be clipped.
    expect(wrap.get(".wp-select__label-wrap").attributes("title"))
      .toBe("Outfit — 3 options · #bbbbbbbb");
    wrap.unmount();
  });

  it("renders no trigger meta for options that carry none", async () => {
    // Every dropdown in the app shares this component; ones that set no meta
    // must look exactly as they did.
    const wrap = mount(Select, {
      props: { modelValue: "a", options: opts },
      attachTo: document.body,
    });
    expect(wrap.find(".wp-select__label-meta").exists()).toBe(false);
    wrap.unmount();
  });

  it("reserves the marker gutter so mixed icon/iconless lists stay aligned", async () => {
    // A list where only some options have a category icon rendered a ragged
    // left edge, and an indent the user reads as hierarchy that isn't there.
    const mixed = [
      { value: "a", label: "Categorised", icon: "user", dot: "#f00" },
      { value: "b", label: "Uncategorised" },
    ];
    const wrap = mount(Select, {
      props: { modelValue: null, options: mixed },
      attachTo: document.body,
    });
    await wrap.get("[data-test='select-trigger']").trigger("click");
    const rows = document.querySelectorAll(".wp-select__option");
    expect(rows[0].querySelector(".wp-select__icon")).not.toBeNull();
    const gap = rows[1].querySelector<HTMLElement>(".wp-select__marker-gap");
    expect(gap).not.toBeNull();
    // Icons are a 14px box, so that is what the gutter has to hold open.
    expect(gap?.style.width).toBe("14px");
    wrap.unmount();
  });

  it("reserves only dot width when no option has an icon", async () => {
    const dotted = [
      { value: "a", label: "Dotted", dot: "#0f0" },
      { value: "b", label: "Plain" },
    ];
    const wrap = mount(Select, {
      props: { modelValue: null, options: dotted },
      attachTo: document.body,
    });
    await wrap.get("[data-test='select-trigger']").trigger("click");
    const gap = document.querySelectorAll(".wp-select__option")[1]
      .querySelector<HTMLElement>(".wp-select__marker-gap");
    expect(gap?.style.width).toBe("8px");
    wrap.unmount();
  });

  it("adds no gutter at all when nothing in the list has a marker", async () => {
    const wrap = mount(Select, {
      props: { modelValue: null, options: opts },
      attachTo: document.body,
    });
    await wrap.get("[data-test='select-trigger']").trigger("click");
    expect(document.querySelector(".wp-select__marker-gap")).toBeNull();
    wrap.unmount();
  });
});
