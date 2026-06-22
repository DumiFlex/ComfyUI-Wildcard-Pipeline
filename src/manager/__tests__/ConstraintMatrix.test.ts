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

  it("orders cols into axis bands and rows into grouped sections, colored by axis", () => {
    const wrap = mount(ConstraintMatrix, {
      props: {
        rows: ["tempting", "man", "woman", "clothed"], // deliberately unordered
        cols: ["vivid", "warm", "cool"],
        modelValue: {},
        sourceGroups: { gender: ["man", "woman"], rating: ["clothed", "tempting"] },
        targetGroups: { temperature: ["warm", "cool"], saturation: ["vivid"] },
      },
      attachTo: document.body,
    });
    // Column TAG cells re-ordered by axis order: temperature(warm, cool) then
    // saturation(vivid). The axis NAME no longer lives in the tag cell.
    const cols = wrap.findAll(".wp-mx-th-col");
    expect(cols.map((c) => c.text())).toEqual(["warm", "cool", "vivid"]);
    // Axis names live in a band row, each spanning its group's tags.
    const bands = wrap.findAll(".wp-mx-th-band");
    expect(bands.map((b) => b.text()).filter((t) => t.length > 0))
      .toEqual(["temperature", "saturation"]);
    const temperature = bands.find((b) => b.text() === "temperature");
    expect(temperature?.attributes("colspan")).toBe("2");          // spans warm + cool
    expect(temperature?.attributes("style") ?? "").toContain("--ax"); // carries the hue
    // Rows re-ordered: gender(man, woman) then rating(clothed, tempting).
    const rows = wrap.findAll(".wp-mx-th-row");
    expect(rows.map((r) => r.text())).toEqual(["man", "woman", "clothed", "tempting"]);
    // Each multi-tag row group gets a pinned header chip naming the axis.
    const heads = wrap.findAll(".wp-mx-grp-head");
    expect(heads.map((h) => h.text())).toEqual(["gender", "rating"]);
    expect(heads[0].attributes("style") ?? "").toContain("--ax");
    wrap.unmount();
  });

  it("a solo grouped row axis folds its name into the tag (no header chip row)", () => {
    const wrap = mount(ConstraintMatrix, {
      props: {
        rows: ["lean", "man", "woman"],
        cols: ["warm"],
        modelValue: {},
        sourceGroups: { gender: ["man", "woman"], build: ["lean"] },
        targetGroups: {},
      },
      attachTo: document.body,
    });
    // gender (2 tags) gets a header chip; build (1 tag) does NOT.
    const heads = wrap.findAll(".wp-mx-grp-head");
    expect(heads.map((h) => h.text())).toEqual(["gender"]);
    // The solo "build" axis row carries the axis name as an eyebrow over "lean".
    const solo = wrap.find(".wp-mx-th-row.solo");
    expect(solo.exists()).toBe(true);
    expect(solo.text()).toContain("build");
    expect(solo.text()).toContain("lean");
    wrap.unmount();
  });

  it("labels the leftover ungrouped run 'uncategorized' instead of leaving it blank", () => {
    const wrap = mount(ConstraintMatrix, {
      props: {
        rows: ["romantic", "elegant", "bold"], // mood axis + ungrouped "bold"
        cols: ["vivid", "muted", "yellow"], // saturation axis + ungrouped "yellow"
        modelValue: {},
        sourceGroups: { mood: ["romantic", "elegant"] },
        targetGroups: { saturation: ["vivid", "muted"] },
      },
      attachTo: document.body,
    });
    // Row groups: the real axis then a labelled "uncategorized" bucket (not blank).
    const heads = wrap.findAll(".wp-mx-grp-head").map((h) => h.text());
    expect(heads).toEqual(["mood", "uncategorized"]);
    // Column bands: the real axis then a labelled "uncategorized" band.
    const bands = wrap.findAll(".wp-mx-th-band").map((b) => b.text()).filter((t) => t.length > 0);
    expect(bands).toEqual(["saturation", "uncategorized"]);
    // The bucket carries a non-axis (neutral) hue, not a palette colour.
    const bucketBand = wrap.findAll(".wp-mx-th-band").find((b) => b.text() === "uncategorized");
    expect(bucketBand?.classes()).toContain("wp-mx-th-band--bucket");
    wrap.unmount();
  });

  it("stays flat with no 'uncategorized' label when nothing is grouped", () => {
    const wrap = mountGrid({}, ["red", "blue"], ["warm", "cool"]);
    expect(wrap.findAll(".wp-mx-grp-head").length).toBe(0);
    expect(wrap.findAll(".wp-mx-th-band").length).toBe(0);
    expect(wrap.text().toLowerCase()).not.toContain("uncategorized");
    wrap.unmount();
  });
});
