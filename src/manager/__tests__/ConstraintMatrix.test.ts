// ConstraintMatrix (SPA) — library-authoring grid driven by
// CellRulePopover. Click cell opens popover; state buttons + numeric
// factor + reset commit writes through `update:modelValue`. The
// popover renders in a body-level Teleport, so tests reach it through
// `findComponent({ name: "CellRulePopover" })` rather than the
// wrapper's element subtree.

import { mount, type VueWrapper } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ConstraintMatrix from "../components/ConstraintMatrix.vue";
import type { ConstraintMatrix as Matrix } from "../api/types";

function lastEmitted(
  wrap: VueWrapper,
  event = "update:modelValue",
): Matrix | undefined {
  const evs = wrap.emitted(event) ?? [];
  return evs[evs.length - 1]?.[0] as Matrix | undefined;
}

function mountGrid(modelValue: Matrix = {}, rows = ["red", "blue"], cols = ["warm", "cool"]) {
  return mount(ConstraintMatrix, {
    props: { rows, cols, modelValue },
    global: { plugins: [] },
    attachTo: document.body,
  });
}

function popover(wrap: VueWrapper) {
  return wrap.findComponent({ name: "CellRulePopover" });
}

describe("ConstraintMatrix.vue", () => {
  it("renders rows × cols cells", () => {
    const wrap = mountGrid({}, ["red", "blue", "green"], ["warm", "cool"]);
    const cells = wrap.findAll('[data-test^="cell-"]');
    expect(cells).toHaveLength(3 * 2);
    expect(cells[0].attributes("aria-label")).toContain("red");
    expect(cells[0].attributes("aria-label")).toContain("warm");
    wrap.unmount();
  });

  it("renders the source / target axis tags with wildcard names", () => {
    const wrap = mount(ConstraintMatrix, {
      props: {
        rows: ["red"],
        cols: ["warm"],
        modelValue: {},
        sourceName: "colors",
        targetName: "moods",
      },
      attachTo: document.body,
    });
    expect(wrap.find('[data-test="mx-axis-src"]').text()).toMatch(/colors/i);
    expect(wrap.find('[data-test="mx-axis-tgt"]').text()).toMatch(/moods/i);
    wrap.unmount();
  });

  it("renders empty notice when no rows", () => {
    const wrap = mountGrid({}, [], ["warm"]);
    expect(wrap.text()).toContain("No source values yet");
    wrap.unmount();
  });

  it("clicking a cell opens the rule popover", async () => {
    const wrap = mountGrid({}, ["red"], ["warm"]);
    expect(popover(wrap).exists()).toBe(false);
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    expect(popover(wrap).exists()).toBe(true);
    expect(wrap.find('[data-test="cell-red-warm"]').classes()).toContain("open");
    wrap.unmount();
  });

  it("clicking the same cell twice closes the popover", async () => {
    const wrap = mountGrid({}, ["red"], ["warm"]);
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    expect(popover(wrap).exists()).toBe(false);
    wrap.unmount();
  });

  it("picking EXCLUDE writes mode=exclude", async () => {
    const wrap = mountGrid({}, ["red"], ["warm"]);
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    await popover(wrap).find("button.pop-btn.b-exclude").trigger("click");
    const last = lastEmitted(wrap);
    expect(last?.red?.warm?.mode).toBe("exclude");
    wrap.unmount();
  });

  it("picking BOOST writes mode=boost + default factor 1.5", async () => {
    const wrap = mountGrid({}, ["red"], ["warm"]);
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    await popover(wrap).find("button.pop-btn.b-boost").trigger("click");
    const last = lastEmitted(wrap);
    expect(last?.red?.warm).toEqual({ mode: "boost", factor: 1.5 });
    wrap.unmount();
  });

  it("picking REDUCE writes mode=reduce + default factor 0.5", async () => {
    const wrap = mountGrid({}, ["red"], ["warm"]);
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    await popover(wrap).find("button.pop-btn.b-reduce").trigger("click");
    const last = lastEmitted(wrap);
    expect(last?.red?.warm).toEqual({ mode: "reduce", factor: 0.5 });
    wrap.unmount();
  });

  it("picking NEUTRAL drops the cell entry (sparse)", async () => {
    const wrap = mountGrid(
      { red: { warm: { mode: "boost", factor: 1.5 } } },
      ["red"],
      ["warm"],
    );
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    await popover(wrap).find("button.pop-btn.b-neutral").trigger("click");
    const last = lastEmitted(wrap);
    expect(last?.red).toBeUndefined();
    wrap.unmount();
  });

  it("typing a factor in the popover writes the cell factor", async () => {
    const wrap = mountGrid(
      { red: { warm: { mode: "boost", factor: 2 } } },
      ["red"],
      ["warm"],
    );
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    await popover(wrap).find(".pop-num__field").setValue("3.4");
    const last = lastEmitted(wrap);
    expect(last?.red?.warm).toEqual({ mode: "boost", factor: 3.4 });
    wrap.unmount();
  });

  it("reset-to-library button is never shown — the SPA IS the library", async () => {
    // Even for a cell carrying a non-default rule, there is no library
    // to reset to. Use NEUTRAL to clear the cell instead.
    const wrap = mountGrid(
      { red: { warm: { mode: "boost", factor: 1.8 } } },
      ["red"],
      ["warm"],
    );
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    expect(popover(wrap).find(".pop-reset").exists()).toBe(false);
    wrap.unmount();
  });

  it("authored cells do NOT receive the modified-from-library outline", async () => {
    // Same reason: every authored cell is library data; nothing to mark.
    const wrap = mountGrid(
      { red: { warm: { mode: "boost", factor: 1.8 } } },
      ["red"],
      ["warm"],
    );
    expect(wrap.find('[data-test="cell-red-warm"]').classes()).not.toContain("wp-mx-cell--mod");
    wrap.unmount();
  });

  it("Escape closes the popover", async () => {
    const wrap = mountGrid({}, ["red"], ["warm"]);
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    expect(popover(wrap).exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrap.vm.$nextTick();
    expect(popover(wrap).exists()).toBe(false);
    wrap.unmount();
  });

  it("picking a state keeps the popover open (no auto-close)", async () => {
    const wrap = mountGrid({}, ["red"], ["warm"]);
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    await popover(wrap).find("button.pop-btn.b-boost").trigger("click");
    expect(popover(wrap).exists()).toBe(true);
    wrap.unmount();
  });

  it("typing in factor does not select-all-and-reset between keystrokes", async () => {
    // Regression: the popover used to call .select() after every
    // `update:factor` round-trip, clobbering the user's input. With the
    // watcher narrowed to STATE only, typing multiple digits succeeds.
    const wrap = mountGrid(
      { red: { warm: { mode: "boost", factor: 2 } } },
      ["red"],
      ["warm"],
    );
    await wrap.find('[data-test="cell-red-warm"]').trigger("click");
    const input = popover(wrap).find<HTMLInputElement>(".pop-num__field");
    await input.setValue("2");
    await input.setValue("2.4");
    await input.setValue("2.45");
    const last = lastEmitted(wrap);
    expect(last?.red?.warm.factor).toBe(2.45);
    wrap.unmount();
  });

  it("does NOT render a matrix row or column for the empty-string value", () => {
    // Caller must pre-filter rows/cols to sub-category names (matrix
    // axes are sub-categories, not values). Null option has no
    // sub_category so it never appears in `rows` or `cols`. This test
    // locks the contract: even if a stray "" sneaks into rows, no
    // row header should label it as "null" / blank.
    const wrap = mountGrid({}, ["red"], ["warm", "cool"]);
    const ths = wrap.findAll(".wp-mx-th-row");
    expect(ths.every((th) => th.text() !== "" && th.text().toLowerCase() !== "null")).toBe(true);
    wrap.unmount();
  });
});
