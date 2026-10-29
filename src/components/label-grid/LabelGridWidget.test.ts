import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import LabelGridWidget from "./LabelGridWidget.vue";
import { defaultLabelGridConfig, type LabelGridConfig, type LabelGridRun } from "../../extension/label-grid";

const SWEEP: LabelGridRun = {
  items: 9, batchSizes: Array(9).fill(1), count: 9, labelled: true, auto: "fill", grid: [1687, 2416],
  parts: [
    { values: ["#1", "#2", "#3", "#4"], count: 9 },
    { values: ["dawn", "noon", "night"], count: 3 },
    { values: ["pastel", "vivid", "ink"], count: 3 },
  ],
};

function mk(props: Record<string, unknown> = {}) {
  return mount(LabelGridWidget, {
    props: { modelValue: defaultLabelGridConfig(), fonts: ["default", "Arial.ttf"], ...props },
  });
}
function lastEmit(w: ReturnType<typeof mk>): LabelGridConfig {
  const all = w.emitted("update:modelValue") ?? [];
  return all[all.length - 1]?.[0] as LabelGridConfig;
}

describe("LabelGridWidget", () => {
  it("edits the label text on change", async () => {
    const w = mk();
    const input = w.find('[data-test="lg-template"]');
    await input.setValue("#{index}");
    expect(lastEmit(w).label).toBe("#{index}");
  });

  it("places the label and keeps 'over image' across top and bottom", async () => {
    const w = mk();
    await w.find('[data-test="lg-side-left"]').trigger("click");
    expect(lastEmit(w).position).toBe("left");
    const over = mk({ modelValue: { ...defaultLabelGridConfig(), position: "over_top" } });
    await over.find('[data-test="lg-side-bottom"]').trigger("click");
    expect(lastEmit(over).position).toBe("over_bottom");
  });

  it("a band over the image starts see-through", async () => {
    const w = mk();
    await w.find('[data-test="lg-over"]').trigger("click");
    expect(lastEmit(w)).toMatchObject({ position: "over_top", label_color: "#00000099" });
  });

  it("explains each label token", () => {
    const tokens = mk().findAll('[data-test^="lg-token-"]');
    expect(tokens.map((t) => t.text())).toEqual(["{label}", "{frame}", "{image}", "{index}", "{count}"]);
    expect(tokens[1].attributes("aria-label")).toContain("input item");
  });

  it("hides font and colours when there is no label", () => {
    const w = mk({ modelValue: { ...defaultLabelGridConfig(), position: "none" } });
    expect(w.find('[data-test="lg-text-color"]').exists()).toBe(false);
    expect(w.find('[data-test="lg-font-size"]').exists()).toBe(false);
  });

  it("says the last run and suggests the preset that fits it", async () => {
    const w = mk();
    expect(w.find('[data-test="lg-run"]').exists()).toBe(false);
    expect(w.find('[data-test="lg-preset-auto"]').attributes("aria-pressed")).toBe("true");
    await w.setProps({ lastRun: SWEEP });
    expect(w.find('[data-test="lg-run"]').text()).toBe("9 images · labelled · grid 1687×2416");
    expect(w.find('[data-test="lg-preset-xy"]').classes()).toContain("is-suggested");
    await w.find('[data-test="lg-suggest-use"]').trigger("click");
    expect(lastEmit(w)).toMatchObject({ rows_from: "part:2", columns_from: "part:3", grid: true });
  });

  it("a preset sets the layout fields", async () => {
    const w = mk();
    await w.find('[data-test="lg-preset-strip"]').trigger("click");
    expect(lastEmit(w).arrange).toBe("strip");
    await w.find('[data-test="lg-preset-off"]').trigger("click");
    expect(lastEmit(w).grid).toBe(false);
  });

  it("grid off hides the grid fields", () => {
    const w = mk({ modelValue: { ...defaultLabelGridConfig(), grid: false } });
    expect(w.find('[data-test="lg-arrange"]').exists()).toBe(false);
    expect(w.find('[data-test="lg-preset-off"]').attributes("aria-pressed")).toBe("true");
  });

  it("typed headers open a text box; label parts fix the layout", async () => {
    const w = mk({ modelValue: { ...defaultLabelGridConfig(), rows_from: "typed" }, lastRun: SWEEP });
    await w.find('[data-test="lg-row-headers"]').setValue("a\nb");
    expect(lastEmit(w).row_headers).toBe("a\nb");
    const xy = mk({ modelValue: { ...defaultLabelGridConfig(), rows_from: "part:2" } });
    expect(xy.find('[data-test="lg-arrange"]').attributes("disabled")).toBeDefined();
  });

  it("columns show only for fill, and an empty box means near square", async () => {
    const w = mk({ modelValue: { ...defaultLabelGridConfig(), arrange: "fill", columns: 4 } });
    expect(w.find('[data-test="lg-columns"]').exists()).toBe(true);
    expect(mk().find('[data-test="lg-columns"]').exists()).toBe(false);
  });

  it("resets spacing and grid colours", async () => {
    const w = mk({ modelValue: { ...defaultLabelGridConfig(), gap: 0, background: "none" } });
    await w.find('[data-test="lg-reset-style"]').trigger("click");
    expect(lastEmit(w)).toMatchObject({ gap: 8, background: "#ffffff" });
    expect(mk().find('[data-test="lg-reset-style"]').exists()).toBe(false);
  });

  it("a wired text input replaces the panel's field", () => {
    const w = mk({ wired: ["title", "row_headers"], modelValue: { ...defaultLabelGridConfig(), rows_from: "part:2" } });
    expect(w.find('[data-test="lg-title"]').exists()).toBe(false);
    expect(w.find('[data-test="lg-title-wired"]').text()).toContain("title input");
    expect(w.find('[data-test="lg-rows-from"]').exists()).toBe(false);
    expect(w.find('[data-test="lg-rows-wired"]').exists()).toBe(true);
    expect(w.find('[data-test="lg-columns-from"]').exists()).toBe(true);
    // the wired rows win over the label part, so the layout is free again
    expect(w.find('[data-test="lg-arrange"]').attributes("disabled")).toBeUndefined();
    expect(w.find('[data-test="lg-template"]').exists()).toBe(true);
    const t = mk({ wired: ["label_text"] });
    expect(t.find('[data-test="lg-template"]').exists()).toBe(false);
    expect(t.find('[data-test="lg-template-wired"]').text()).toContain("label_text");
  });

  it("dims when muted or bypassed", () => {
    expect(mk({ nodeMode: 4 }).classes()).toContain("wp-lg--skipped");
  });
});
