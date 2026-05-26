import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VarPicker from "./VarPicker.vue";

describe("VarPicker", () => {
  it("renders the placeholder when modelValue is empty", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "", upstreamVars: [], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    expect(w.find('[data-test="var-picker-trigger"]').text()).toContain("(no var selected)");
  });

  it("opens the menu on trigger click + shows upstream vars", async () => {
    const w = mount(VarPicker, {
      props: { modelValue: "$seed", upstreamVars: ["$seed", "$mood"], previewSource: "1920", previewParsed: "1920", previewDefault: "0" },
    });
    await w.find('[data-test="var-picker-trigger"]').trigger("click");
    const menu = w.find('[data-test="var-picker-menu"]');
    expect(menu.exists()).toBe(true);
    expect(menu.text()).toContain("$seed");
    expect(menu.text()).toContain("$mood");
  });

  it("emits update:modelValue with the picked var", async () => {
    const w = mount(VarPicker, {
      props: { modelValue: "", upstreamVars: ["$seed", "$mood"], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    await w.find('[data-test="var-picker-trigger"]').trigger("click");
    await w.find('[data-test="var-picker-opt-$mood"]').trigger("click");
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["$mood"]);
  });

  it("shows the parsed preview in teal", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "$seed", upstreamVars: ["$seed"], previewSource: "1920x1080", previewParsed: "1920", previewDefault: "0" },
    });
    const preview = w.find('[data-test="var-picker-preview"]');
    expect(preview.classes()).not.toContain("wp-var-picker__preview--default");
    expect(preview.classes()).not.toContain("wp-var-picker__preview--idle");
    expect(preview.text()).toContain("→ 1920");
  });

  it("shows the default fallback in amber when previewParsed is null + source present", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "$seed", upstreamVars: ["$seed"], previewSource: "hello", previewParsed: null, previewDefault: "0" },
    });
    const preview = w.find('[data-test="var-picker-preview"]');
    expect(preview.classes()).toContain("wp-var-picker__preview--default");
    expect(preview.text()).toContain("→ default (0)");
  });

  it("shows the idle state when previewSource is empty (no execute yet)", () => {
    const w = mount(VarPicker, {
      props: { modelValue: "$seed", upstreamVars: ["$seed"], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    const preview = w.find('[data-test="var-picker-preview"]');
    expect(preview.classes()).toContain("wp-var-picker__preview--idle");
    expect(preview.text()).toContain("run workflow to see result");
  });

  it("shows the empty-state message when no upstream vars exist", async () => {
    const w = mount(VarPicker, {
      props: { modelValue: "", upstreamVars: [], previewSource: "", previewParsed: null, previewDefault: "0" },
    });
    await w.find('[data-test="var-picker-trigger"]').trigger("click");
    expect(w.find('[data-test="var-picker-menu"]').text()).toContain("No upstream variables");
  });
});
