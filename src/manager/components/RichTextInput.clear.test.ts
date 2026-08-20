import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

/**
 * The parent writing "" must empty the editor. The echo guard on the
 * `modelValue` watcher used to drop it: `lastEmittedValue` seeds from the
 * mount value, so an editor that mounted empty — which is every canvas
 * widget, since ComfyUI restores the workflow value AFTER the widget is
 * built — considered every later "" its own echo.
 *
 * Surfaced by the assembler's Clear template button: the widget value went
 * to "" and the old template stayed on screen.
 */
describe("RichTextInput — external clear", () => {
  it("empties an editor that MOUNTED empty (the canvas widget's lifecycle)", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "", surface: "assembler", multiline: true },
    });
    await w.vm.$nextTick();
    // Value arrives after mount, the way ComfyUI restores a saved workflow.
    await w.setProps({ modelValue: "a legacy $style portrait" });
    await w.vm.$nextTick();
    expect(w.get(".wp-rt__host").text()).toContain("$style");
    await w.setProps({ modelValue: "" });
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(w.findAll(".wp-refchip").length).toBe(0);
    expect(w.get(".wp-rt__host").text().replace(/​/g, "")).toBe("");
  });

  it("empties the host when the parent sets modelValue to ''", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "hello $world", surface: "assembler", multiline: true },
    });
    await w.vm.$nextTick();
    expect(w.get(".wp-rt__host").text()).toContain("$world");
    await w.setProps({ modelValue: "" });
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(w.findAll(".wp-refchip").length).toBe(0);
    expect(w.get(".wp-rt__host").text().replace(/\u200b/g, "")).toBe("");
  });

  it("empties the host when the initial value was already the one being cleared", async () => {
    // The assembler's Clear button path: the value arrived from a workflow
    // load, the user never typed, and the widget writes "" straight back.
    const w = mount(RichTextInput, {
      props: { modelValue: "a legacy $style portrait", surface: "assembler", multiline: true },
    });
    await w.vm.$nextTick();
    await w.setProps({ modelValue: "" });
    await w.vm.$nextTick();
    await w.vm.$nextTick();
    expect(w.get(".wp-rt__host").text().replace(/\u200b/g, "")).toBe("");
  });
});
